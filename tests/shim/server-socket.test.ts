import { afterEach, describe, expect, test } from 'bun:test';
import net from 'net';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { prepareShimSocketFile } from '../../src/shim/server-socket';

const cleanupTasks: Array<() => Promise<void>> = [];

async function listen(socketPath: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  cleanupTasks.push(
    () =>
      new Promise<void>((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      })
  );
  return server;
}

async function connect(socketPath: string): Promise<void> {
  const socket = net.createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.destroy();
}

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.pop()?.();
  }
});

describe('shim server socket preparation', () => {
  test('does not unlink an active shim socket', async () => {
    const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-socket-'));
    const socketPath = join(socketDir, 'shim.sock');
    cleanupTasks.push(() => fs.rm(socketDir, { recursive: true, force: true }));
    await listen(socketPath);

    const result = await prepareShimSocketFile(socketPath);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Shim socket already in use');
    await expect(connect(socketPath)).resolves.toBeUndefined();
  });

  test('removes stale shim socket files', async () => {
    const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-socket-'));
    const socketPath = join(socketDir, 'shim.sock');
    cleanupTasks.push(() => fs.rm(socketDir, { recursive: true, force: true }));
    const server = await listen(socketPath);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const result = await prepareShimSocketFile(socketPath);

    expect(result).toBeUndefined();
    await expect(fs.stat(socketPath)).rejects.toThrow();
  });
});
