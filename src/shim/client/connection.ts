import net from 'net';
import { Effect, Stream } from 'effect';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { Buffer } from 'buffer';

import type { TerminalScrollState, UnifiedTerminalUpdate } from '../../core/types';
import type { SerializedDirtyUpdate } from '../../terminal/emulator-interface';
import { getHostColors } from '../../terminal/terminal-colors';
import { unpackDirtyUpdate } from '../../terminal/cell-serialization';
import { encodeFrame, FrameReader, SHIM_SOCKET_DIR, SHIM_SOCKET_PATH, type ShimHeader } from '../protocol';
import { bufferToArrayBuffer } from './utils';
import { handlePtyExit, handlePtyLifecycle, handlePtyTitle, handleUnifiedUpdate } from './state';
import { runStream } from '../../effect/stream-utils';

const CLIENT_VERSION = 1;
const CLIENT_ID = `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;

type PendingRequest = {
  resolve: (value: { header: ShimHeader; payloads: Buffer[] }) => void;
  reject: (error: Error) => void;
};

const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;
let socket: net.Socket | null = null;
let reader: FrameReader | null = null;
let connecting: Promise<void> | null = null;
let spawnAttempted = false;
let shimPid: number | null = null;
let detached = false;
let socketDataStop: (() => void) | null = null;

const detachedSubscribers = new Set<() => void>();

function buildPackedUpdate(header: ShimHeader, payloads: Buffer[]): SerializedDirtyUpdate | null {
  const packedMeta = header.packed as {
    cursor: { x: number; y: number; visible: boolean };
    cols: number;
    rows: number;
    scrollbackLength: number;
    isFull: boolean;
    alternateScreen: boolean;
    mouseTracking: boolean;
    cursorKeyMode: number;
    kittyKeyboardFlags?: number;
    inBandResize: boolean;
  } | undefined;

  if (!packedMeta) {
    return null;
  }

  const dirtyRowIndices = new Uint16Array(bufferToArrayBuffer(payloads[0] ?? Buffer.alloc(0)));
  const dirtyRowData = bufferToArrayBuffer(payloads[1] ?? Buffer.alloc(0));
  const fullStateBuffer = payloads[2] ? bufferToArrayBuffer(payloads[2]) : undefined;

  return {
    dirtyRowIndices,
    dirtyRowData,
    fullStateData: fullStateBuffer,
    cursor: packedMeta.cursor,
    cols: packedMeta.cols,
    rows: packedMeta.rows,
    scrollbackLength: packedMeta.scrollbackLength,
    isFull: packedMeta.isFull,
    alternateScreen: packedMeta.alternateScreen,
    mouseTracking: packedMeta.mouseTracking,
    cursorKeyMode: packedMeta.cursorKeyMode as 0 | 1,
    kittyKeyboardFlags: packedMeta.kittyKeyboardFlags ?? 0,
    inBandResize: packedMeta.inBandResize,
  };
}

function handleFrame(header: ShimHeader, payloads: Buffer[]): void {
  if (header.type === 'response' && header.requestId !== undefined) {
    const pending = pendingRequests.get(header.requestId);
    if (pending) {
      pendingRequests.delete(header.requestId);
      if (header.ok) {
        pending.resolve({ header, payloads });
      } else {
        pending.reject(new Error(header.error ?? 'Shim request failed'));
      }
    }
    return;
  }

  if (header.type === 'ptyUpdate') {
    const ptyId = header.ptyId as string;
    const packed = buildPackedUpdate(header, payloads);
    if (!packed) {
      return;
    }

    const scrollStateHeader = header.scrollState as { viewportOffset: number; isAtBottom: boolean } | undefined;
    const scrollState: TerminalScrollState = {
      viewportOffset: scrollStateHeader?.viewportOffset ?? 0,
      scrollbackLength: packed.scrollbackLength,
      isAtBottom: scrollStateHeader?.isAtBottom ?? true,
    };

    const dirtyUpdate = unpackDirtyUpdate(packed, scrollState);
    const unifiedUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: dirtyUpdate,
      scrollState,
    };

    handleUnifiedUpdate(ptyId, unifiedUpdate);
    return;
  }

  if (header.type === 'ptyExit') {
    const ptyId = header.ptyId as string;
    const exitCode = header.exitCode as number;
    handlePtyExit(ptyId, exitCode);
    return;
  }

  if (header.type === 'ptyTitle') {
    const ptyId = header.ptyId as string;
    const title = (header.title as string) ?? '';
    handlePtyTitle(ptyId, title);
    return;
  }

  if (header.type === 'ptyLifecycle') {
    const ptyId = header.ptyId as string;
    const eventType = header.event as 'created' | 'destroyed';
    handlePtyLifecycle(ptyId, eventType);
    return;
  }

  if (header.type === 'detached') {
    markDetached();
  }
}

function createSocketDataStream(
  client: net.Socket,
  frameReader: FrameReader
): Stream.Stream<Buffer> {
  return Stream.async<Buffer>((emit) => {
    const handleData = (chunk: Buffer) => {
      void emit.single(chunk);
    };
    client.on('data', handleData);
    return Effect.sync(() => {
      client.off('data', handleData);
    });
  }).pipe(
    Stream.tap((chunk) =>
      Effect.sync(() => {
        frameReader.feed(chunk, handleFrame);
      })
    )
  );
}

async function connectSocket(): Promise<void> {
  await fs.mkdir(SHIM_SOCKET_DIR, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const client = net.createConnection(SHIM_SOCKET_PATH);
    const handleError = (error: Error) => {
      client.removeListener('connect', handleConnect);
      reject(error);
    };
    const handleConnect = () => {
      client.removeListener('error', handleError);
      socket = client;
      reader = new FrameReader();
      client.on('error', () => {
        // ignore, reconnect on demand
      });
      client.on('close', () => {
        socketDataStop?.();
        socketDataStop = null;
        socket = null;
        reader = null;
        markDetached();
      });
      socketDataStop?.();
      socketDataStop = runStream(
        createSocketDataStream(client, reader),
        { label: 'shim-client-data' }
      );
      resolve();
    };
    client.once('error', handleError);
    client.once('connect', handleConnect);
  });

  let hello: { header: ShimHeader; payloads: Buffer[] };
  try {
    hello = await sendRequest('hello', { clientId: CLIENT_ID, version: CLIENT_VERSION });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('detached')) {
      socket?.destroy();
      socket = null;
      reader = null;
      markDetached();
    }
    throw error;
  }
  const helloResult = hello.header.result as { pid?: number } | undefined;
  if (helloResult && typeof helloResult.pid === 'number') {
    shimPid = helloResult.pid;
  }

  const colors = getHostColors();
  if (colors) {
    await sendRequest('setHostColors', { colors });
  }
}

function spawnShimProcess(): void {
  if (spawnAttempted) {
    return;
  }
  spawnAttempted = true;

  const baseArgs = process.argv.slice(1).filter((arg) => arg !== '--shim');
  const executable = process.execPath || process.argv[0] || 'openmux';
  const args = [...baseArgs, '--shim'];

  if (typeof Bun !== 'undefined' && typeof Bun.spawn === 'function') {
    Bun.spawn([executable, ...args], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      detached: true,
    });
    return;
  }

  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function connectWithRetry(attempts = 25, delayMs = 120): Promise<void> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      await connectSocket();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to connect to shim');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError ?? new Error('Failed to connect to shim');
}

async function ensureConnectedWithoutSpawn(): Promise<boolean> {
  if (socket && !socket.destroyed) {
    return true;
  }
  try {
    await connectWithRetry(3, 80);
    return true;
  } catch {
    return false;
  }
}

async function ensureConnected(): Promise<void> {
  if (detached) {
    throw new Error('Shim client detached');
  }
  if (socket && !socket.destroyed) {
    return;
  }
  if (!connecting) {
    connecting = (async () => {
      try {
        await connectSocket();
      } catch (error) {
        if (detached) {
          throw error;
        }
        spawnShimProcess();
        await connectWithRetry();
      } finally {
        connecting = null;
      }
    })();
  }
  await connecting;
}

export async function sendRequestDirect(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = [],
  timeoutMs?: number
): Promise<{ header: ShimHeader; payloads: Buffer[] }> {
  if (!socket || socket.destroyed) {
    throw new Error('Shim socket not available');
  }

  const requestId = nextRequestId++;
  const header: ShimHeader = {
    type: 'request',
    requestId,
    method,
    params,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    if (timeoutMs) {
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error('Shim request timed out'));
        }
      }, timeoutMs);
    }
    socket?.write(encodeFrame(header, payloads), (err) => {
      if (err) {
        pendingRequests.delete(requestId);
        reject(err);
      }
    });
  });
}

export async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = []
): Promise<{ header: ShimHeader; payloads: Buffer[] }> {
  await ensureConnected();
  if (!socket) {
    throw new Error('Shim socket not available');
  }

  const requestId = nextRequestId++;
  const header: ShimHeader = {
    type: 'request',
    requestId,
    method,
    params,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    socket?.write(encodeFrame(header, payloads));
  });
}

export function onShimDetached(callback: () => void): () => void {
  detachedSubscribers.add(callback);
  return () => {
    detachedSubscribers.delete(callback);
  };
}

export async function shutdownShim(): Promise<void> {
  if (connecting) {
    await connecting.catch(() => {});
  }
  const connected = await ensureConnectedWithoutSpawn();
  if (connected) {
    const shutdownOk = await sendRequestDirect('shutdown', undefined, [], 500)
      .then(() => true)
      .catch(() => false);
    if (shutdownOk) {
      return;
    }
  }

  if (shimPid) {
    try {
      process.kill(shimPid);
    } catch {
      // ignore
    }
  }
}

export async function waitForShim(): Promise<void> {
  await ensureConnected();
}

function markDetached(): void {
  if (detached) return;
  detached = true;
  for (const callback of detachedSubscribers) {
    callback();
  }
}
