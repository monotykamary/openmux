import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import fs from 'fs/promises';

import { encodeFrame, FrameReader, type ShimHeader } from '../../src/shim/protocol';
import { startShimServer } from '../../src/shim/server';

type Frame = { header: ShimHeader; payloads: Buffer[] };

function withTimeout<T>(promise: Promise<T>, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for frame'));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function createFrameQueue(socket: net.Socket) {
  const reader = new FrameReader();
  const queue: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];

  socket.on('data', (chunk) => {
    reader.feed(chunk, (header, payloads) => {
      const frame = { header, payloads };
      const waiter = waiters.shift();
      if (waiter) {
        waiter(frame);
        return;
      }
      queue.push(frame);
    });
  });

  return {
    nextFrame: (timeoutMs?: number) =>
      withTimeout(
        new Promise<Frame>((resolve) => {
          const frame = queue.shift();
          if (frame) {
            resolve(frame);
          } else {
            waiters.push(resolve);
          }
        }),
        timeoutMs
      ),
  };
}

async function nextFrameSafe(
  reader: ReturnType<typeof createFrameQueue>,
  timeoutMs: number
): Promise<Frame | undefined> {
  try {
    return await reader.nextFrame(timeoutMs);
  } catch {
    return undefined;
  }
}

async function connectClient(socketPath: string): Promise<net.Socket> {
  const socket = net.createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function sendRequest(socket: net.Socket, header: ShimHeader): Promise<void> {
  const frame = encodeFrame(header, []);
  await new Promise<void>((resolve, reject) => {
    socket.write(frame, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function collectDetachedUntilResponse(
  socket: net.Socket,
  reader: ReturnType<typeof createFrameQueue>,
  requestId: number
): Promise<{ response?: ShimHeader; detachedCount: number; closed: boolean }> {
  let detachedCount = 0;
  let closed = socket.destroyed;
  if (closed) {
    return { detachedCount, closed };
  }
  for (let i = 0; i < 6; i++) {
    if (socket.destroyed) {
      closed = true;
      return { detachedCount, closed };
    }
    const frame = await nextFrameSafe(reader, 400);
    if (!frame) {
      return { detachedCount, closed: socket.destroyed };
    }
    if (frame.header.type === 'detached') {
      detachedCount += 1;
      continue;
    }
    if (frame.header.type === 'response' && frame.header.requestId === requestId) {
      return { response: frame.header, detachedCount, closed: socket.destroyed };
    }
  }
  return { detachedCount, closed: socket.destroyed };
}

async function drainDetached(reader: ReturnType<typeof createFrameQueue>, limit = 3): Promise<number> {
  let detachedCount = 0;
  for (let i = 0; i < limit; i++) {
    const frame = await nextFrameSafe(reader, 150);
    if (!frame) {
      break;
    }
    if (frame.header.type === 'detached') {
      detachedCount += 1;
    }
  }
  return detachedCount;
}

describe('shim server', () => {
  test('hello attaches client, detaches previous, and revokes old ids', async () => {
    const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-'));
    const socketPath = join(socketDir, 'shim.sock');

    const fakePty = {
      listAll: () => [],
      subscribeToLifecycle: () => () => {},
      subscribeToAllTitleChanges: () => () => {},
    };

    const server = await startShimServer({
      socketPath,
      withPty: async (fn) => fn(fakePty),
      setHostColors: () => {},
    });

    const clientA = await connectClient(socketPath);
    const readerA = createFrameQueue(clientA);
    await sendRequest(clientA, {
      type: 'request',
      requestId: 1,
      method: 'hello',
      params: { clientId: 'client-a' },
    });
    const helloA = await readerA.nextFrame();
    expect(helloA.header.ok).toBe(true);
    expect((helloA.header.result as { pid?: number }).pid).toBeTypeOf('number');

    const clientB = await connectClient(socketPath);
    const readerB = createFrameQueue(clientB);
    await sendRequest(clientB, {
      type: 'request',
      requestId: 2,
      method: 'hello',
      params: { clientId: 'client-b' },
    });
    const detached = await readerA.nextFrame();
    expect(detached.header.type).toBe('detached');
    const helloB = await readerB.nextFrame();
    expect(helloB.header.ok).toBe(true);

    const clientARe = await connectClient(socketPath);
    const readerARe = createFrameQueue(clientARe);
    await sendRequest(clientARe, {
      type: 'request',
      requestId: 3,
      method: 'hello',
      params: { clientId: 'client-a' },
    });
    const revoked = await readerARe.nextFrame();
    expect(revoked.header.ok).toBe(false);
    expect(revoked.header.error).toBe('Client is detached');

    clientA.destroy();
    clientB.destroy();
    clientARe.destroy();
    server.close();
    await fs.rm(socketDir, { recursive: true, force: true });
  });

  test('A -> B -> A race detaches once and keeps one active client', async () => {
    const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-'));
    const socketPath = join(socketDir, 'shim.sock');

    const fakePty = {
      listAll: () => [],
      subscribeToLifecycle: () => () => {},
      subscribeToAllTitleChanges: () => () => {},
    };

    const server = await startShimServer({
      socketPath,
      withPty: async (fn) => fn(fakePty),
      setHostColors: () => {},
    });

    const clientA = await connectClient(socketPath);
    const readerA = createFrameQueue(clientA);
    await sendRequest(clientA, {
      type: 'request',
      requestId: 1,
      method: 'hello',
      params: { clientId: 'client-a' },
    });
    const helloA = await readerA.nextFrame();
    expect(helloA.header.ok).toBe(true);

    const clientB = await connectClient(socketPath);
    const readerB = createFrameQueue(clientB);

    await Promise.all([
      sendRequest(clientB, {
        type: 'request',
        requestId: 2,
        method: 'hello',
        params: { clientId: 'client-b' },
      }),
      sendRequest(clientA, {
        type: 'request',
        requestId: 3,
        method: 'hello',
        params: { clientId: 'client-a' },
      }),
    ]);

    const resultA = await collectDetachedUntilResponse(clientA, readerA, 3);
    const resultB = await collectDetachedUntilResponse(clientB, readerB, 2);

    const detachedA = resultA.detachedCount + await drainDetached(readerA);
    const detachedB = resultB.detachedCount + await drainDetached(readerB);

    expect(resultB.response?.ok).toBe(true);
    if (resultA.response) {
      if (resultA.response.ok) {
        expect(resultA.response.ok).toBe(true);
      } else {
        expect(resultA.response.error).toBe('Client is detached');
      }
    } else {
      expect(resultA.closed).toBe(true);
    }

    expect(detachedA).toBe(1);
    expect(detachedB).toBe(0);

    clientA.destroy();
    clientB.destroy();
    server.close();
    await fs.rm(socketDir, { recursive: true, force: true });
  });

  test('registers and returns session mappings', async () => {
    const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-'));
    const socketPath = join(socketDir, 'shim.sock');

    const fakePty = {
      listAll: () => [],
      subscribeToLifecycle: () => () => {},
      subscribeToAllTitleChanges: () => () => {},
    };

    const server = await startShimServer({
      socketPath,
      withPty: async (fn) => fn(fakePty),
      setHostColors: () => {},
    });

    const client = await connectClient(socketPath);
    const reader = createFrameQueue(client);
    await sendRequest(client, {
      type: 'request',
      requestId: 1,
      method: 'hello',
      params: { clientId: 'client-map' },
    });
    await reader.nextFrame();

    await sendRequest(client, {
      type: 'request',
      requestId: 2,
      method: 'registerPane',
      params: { sessionId: 'session-1', paneId: 'pane-1', ptyId: 'pty-1' },
    });
    const registerResponse = await reader.nextFrame();
    expect(registerResponse.header.ok).toBe(true);

    await sendRequest(client, {
      type: 'request',
      requestId: 3,
      method: 'getSessionMapping',
      params: { sessionId: 'session-1' },
    });
    const mappingResponse = await reader.nextFrame();
    expect(mappingResponse.header.ok).toBe(true);
    const entries = (mappingResponse.header.result as { entries: Array<{ paneId: string; ptyId: string }> }).entries;
    expect(entries).toEqual([{ paneId: 'pane-1', ptyId: 'pty-1' }]);

    client.destroy();
    server.close();
    await fs.rm(socketDir, { recursive: true, force: true });
  });
});
