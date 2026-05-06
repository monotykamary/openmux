import { afterEach, describe, expect, test } from 'bun:test';
import net from 'net';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

type TestHeader = {
  type: string;
  requestId?: number;
  method?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  payloadLengths?: number[];
  [key: string]: unknown;
};

class TestFrameReader {
  private buffer = Buffer.alloc(0);

  feed(chunk: Buffer, onFrame: (header: TestHeader, payloads: Buffer[]) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + frameLength) return;

      const frame = this.buffer.subarray(4, 4 + frameLength);
      this.buffer = this.buffer.subarray(4 + frameLength);
      if (frame.length < 4) continue;

      const headerLength = frame.readUInt32BE(0);
      const headerEnd = 4 + headerLength;
      const header = JSON.parse(frame.subarray(4, headerEnd).toString('utf8')) as TestHeader;
      const payloads: Buffer[] = [];
      let offset = headerEnd;

      for (const length of header.payloadLengths ?? []) {
        payloads.push(frame.subarray(offset, offset + length));
        offset += length;
      }

      onFrame(header, payloads);
    }
  }
}

let importNonce = 0;
const cleanupTasks: Array<() => Promise<void>> = [];

function encodeTestFrame(header: TestHeader, payloads: ArrayBuffer[] = []): Buffer {
  const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8');
  const payloadBuffers = payloads.map((payload) => Buffer.from(payload));
  const payloadLength = payloadBuffers.reduce((sum, payload) => sum + payload.length, 0);
  const frameLength = 4 + headerBuffer.length + payloadLength;
  const buffer = Buffer.alloc(4 + frameLength);

  buffer.writeUInt32BE(frameLength, 0);
  buffer.writeUInt32BE(headerBuffer.length, 4);
  headerBuffer.copy(buffer, 8);

  let offset = 8 + headerBuffer.length;
  for (const payload of payloadBuffers) {
    payload.copy(buffer, offset);
    offset += payload.length;
  }

  return buffer;
}

function sendResponse(socket: net.Socket, header: TestHeader, result: unknown = {}): void {
  socket.write(
    encodeTestFrame({
      type: 'response',
      requestId: header.requestId,
      ok: true,
      result,
    })
  );
}

async function createShimTestServer(
  handleRequest: (
    header: TestHeader,
    payloads: Buffer[],
    socket: net.Socket
  ) => void | Promise<void>
): Promise<{
  socketDir: string;
  socketPath: string;
  waitForNextSocketClose: () => Promise<void>;
}> {
  const socketDir = await fs.mkdtemp(join(tmpdir(), 'openmux-shim-connection-'));
  const socketPath = join(socketDir, 'shim.sock');
  const sockets = new Set<net.Socket>();
  const closeWaiters: Array<() => void> = [];

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const reader = new TestFrameReader();

    socket.on('data', (chunk) => {
      reader.feed(chunk as Buffer, (header, payloads) => {
        void handleRequest(header, payloads, socket);
      });
    });

    socket.on('close', () => {
      sockets.delete(socket);
      closeWaiters.shift()?.();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  cleanupTasks.push(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await fs.rm(socketDir, { recursive: true, force: true });
  });

  return {
    socketDir,
    socketPath,
    waitForNextSocketClose: () =>
      new Promise<void>((resolve) => {
        closeWaiters.push(resolve);
      }),
  };
}

async function importConnection(socketDir: string, socketPath: string) {
  process.env.OPENMUX_SHIM_SOCKET_DIR = socketDir;
  process.env.OPENMUX_SHIM_SOCKET_PATH = socketPath;
  return import(`../../src/shim/client/connection.ts?connectionLifecycle=${importNonce++}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.pop()?.();
  }
  delete process.env.OPENMUX_SHIM_SOCKET_DIR;
  delete process.env.OPENMUX_SHIM_SOCKET_PATH;
});

describe('shim connection lifecycle', () => {
  test('rejects pending requests when the socket closes before response', async () => {
    const server = await createShimTestServer((header, _payloads, socket) => {
      if (header.method === 'hang') {
        socket.end();
        return;
      }

      sendResponse(socket, header, { pid: process.pid });
    });
    const connection = await importConnection(server.socketDir, server.socketPath);

    const result = await Promise.race([
      connection.sendRequest('hang', {}, [], 500).then(
        () => 'resolved',
        (error: Error) => error
      ),
      delay(150).then(() => 'timed out'),
    ]);

    expect(result).not.toBe('timed out');
    expect(result).not.toBe('resolved');
    expect((result as Error).message).toContain('Shim socket closed');
  });

  test('reconnects after an ordinary socket close', async () => {
    const server = await createShimTestServer((header, _payloads, socket) => {
      if (header.method === 'closeAfterResponse') {
        sendResponse(socket, header);
        socket.end();
        return;
      }

      if (header.method === 'afterReconnect') {
        sendResponse(socket, header, { value: 'ok' });
        return;
      }

      sendResponse(socket, header, { pid: process.pid });
    });
    const connection = await importConnection(server.socketDir, server.socketPath);

    const socketClosed = server.waitForNextSocketClose();
    await connection.sendRequest('closeAfterResponse', {}, [], 500);
    await socketClosed;
    await delay(10);

    const response = await connection.sendRequest('afterReconnect', {}, [], 500);

    expect(response.header.result).toEqual({ value: 'ok' });
  });

  test('keeps explicit detached events terminal for the client', async () => {
    const server = await createShimTestServer((header, _payloads, socket) => {
      if (header.method === 'detachMe') {
        socket.write(encodeTestFrame({ type: 'detached' }));
        socket.end();
        return;
      }

      sendResponse(socket, header, { pid: process.pid });
    });
    const connection = await importConnection(server.socketDir, server.socketPath);
    let detachNotifications = 0;
    const unsubscribe = connection.onShimDetached(() => {
      detachNotifications += 1;
    });

    const detachResult = await connection.sendRequest('detachMe', {}, [], 500).catch((e) => e);
    const reconnectResult = await connection
      .sendRequest('afterDetach', {}, [], 500)
      .catch((e) => e);

    unsubscribe();

    expect(detachNotifications).toBe(1);
    expect((detachResult as Error).message).toContain('Shim client detached');
    expect((reconnectResult as Error).message).toContain('Shim client detached');
  });
});
