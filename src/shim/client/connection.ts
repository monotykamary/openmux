import net from 'net';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import type { Buffer } from 'buffer';
import * as errore from 'errore';

import { getHostColors } from '../../terminal/terminal-colors';
import {
  encodeFrame,
  FrameReader,
  SHIM_SOCKET_DIR,
  SHIM_SOCKET_PATH,
  type ShimHeader,
} from '../protocol';
import { createFrameHandler, type FrameHandlerDeps } from './frame-handler';
import { createSocketDataStream } from './socket-stream';
import { ShimConnectionError } from '../../effect/errors';

const CLIENT_VERSION = 1;
const CLIENT_ID = `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;

type PendingRequest = {
  resolve: (value: { header: ShimHeader; payloads: Buffer[] }) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

// A lost shim response should fail the caller instead of leaving UI flows waiting forever.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;
let socket: net.Socket | null = null;
let reader: FrameReader | null = null;
let connecting: Promise<void | ShimConnectionError> | null = null;
let spawnAttempted = false;
let shimPid: number | null = null;
let detached = false;
let socketDataStop: (() => void) | null = null;

const detachedSubscribers = new Set<() => void>();

function getShimSocketDir(): string {
  return process.env.OPENMUX_SHIM_SOCKET_DIR ?? SHIM_SOCKET_DIR;
}

function getShimSocketPath(): string {
  return process.env.OPENMUX_SHIM_SOCKET_PATH ?? SHIM_SOCKET_PATH;
}

function takePendingRequest(requestId: number): PendingRequest | undefined {
  const pending = pendingRequests.get(requestId);
  if (!pending) return undefined;

  pendingRequests.delete(requestId);
  if (pending.timeout) clearTimeout(pending.timeout);
  return pending;
}

function rejectPendingRequests(error: Error): void {
  for (const pending of pendingRequests.values()) {
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function clearSocketState(client?: net.Socket): void {
  // Close events can arrive late; do not let an old socket clear a newer connection.
  if (client && socket && socket !== client) return;

  socketDataStop?.();
  socketDataStop = null;
  socket = null;
  reader = null;
}

/**
 * Handles incoming response frames from the shim server.
 * Resolves pending requests based on requestId matching.
 * @param header - Response frame header
 * @param payloads - Binary payloads attached to the response
 * @returns true if the frame was handled as a response
 */
function handleResponseFrame(header: ShimHeader, payloads: Buffer[]): boolean {
  if (header.type !== 'response' || header.requestId === undefined) {
    return false;
  }

  const pending = takePendingRequest(header.requestId);
  if (!pending) return false;

  if (header.ok) {
    pending.resolve({ header, payloads });
  } else {
    pending.reject(new Error(header.error ?? 'Shim request failed'));
  }

  return true;
}

const handleFrame = createFrameHandler({
  onResponse: handleResponseFrame,
  onDetached: () => {
    markDetached();
  },
} satisfies FrameHandlerDeps);

/**
 * Connects to the shim server socket, creating directory if needed.
 * Sets up frame reader and event handlers.
 * @returns void on success, ShimConnectionError on failure
 */
async function connectSocket(): Promise<void | ShimConnectionError> {
  const mkdirResult = await errore.tryAsync<string | undefined, ShimConnectionError>({
    try: () => fs.mkdir(getShimSocketDir(), { recursive: true }),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to create socket directory: ${e}`, cause: e }),
  });
  if (mkdirResult instanceof ShimConnectionError) return mkdirResult;

  const connectResult = await errore.tryAsync<void, ShimConnectionError>({
    try: () =>
      new Promise<void>((resolve, reject) => {
        const client = net.createConnection(getShimSocketPath());
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
            clearSocketState(client);
            // A plain socket close is transport failure, not an explicit server detach.
            rejectPendingRequests(new ShimConnectionError({ reason: 'Shim socket closed' }));
          });
          socketDataStop?.();
          socketDataStop = createSocketDataStream(client, reader, handleFrame);
          resolve();
        };
        client.once('error', handleError);
        client.once('connect', handleConnect);
      }),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to connect to socket: ${e}`, cause: e }),
  });
  if (connectResult instanceof ShimConnectionError) return connectResult;

  const helloResult = await errore.tryAsync<
    { header: ShimHeader; payloads: Buffer[] },
    ShimConnectionError
  >({
    try: () => sendRequest('hello', { clientId: CLIENT_ID, version: CLIENT_VERSION }),
    catch: (e) => {
      if (e instanceof Error && e.message.toLowerCase().includes('detached')) {
        socket?.destroy();
        socket = null;
        reader = null;
        markDetached();
      }
      return new ShimConnectionError({ reason: `Hello request failed: ${e}` });
    },
  });
  if (helloResult instanceof ShimConnectionError) return helloResult;

  const helloData = helloResult.header.result as { pid?: number } | undefined;
  if (helloData && typeof helloData.pid === 'number') {
    shimPid = helloData.pid;
  }

  const colors = getHostColors();
  if (colors) {
    await sendRequest('setHostColors', { colors });
  }
}

/**
 * Spawns a new shim server process in the background.
 * Uses Bun.spawn when available, otherwise uses child_process.spawn.
 */
function spawnShimProcess(): void {
  if (spawnAttempted) return;
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

/**
 * Connects with retry logic for handling race conditions during shim startup.
 * @param attempts - Number of connection attempts (default: 25)
 * @param delayMs - Delay between attempts in milliseconds (default: 120)
 * @returns void on success, ShimConnectionError on failure
 */
async function connectWithRetry(attempts = 25, delayMs = 120): Promise<void | ShimConnectionError> {
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    const result = await connectSocket();
    if (!(result instanceof ShimConnectionError)) return;

    lastError = result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastError instanceof ShimConnectionError
    ? lastError
    : new ShimConnectionError({ reason: 'Failed to connect to shim after retries' });
}

/**
 * Ensures connection without spawning a new shim process.
 * Used during shutdown to avoid spawning while trying to shut down.
 * @returns true if connected, false otherwise
 */
async function ensureConnectedWithoutSpawn(): Promise<boolean> {
  if (socket && !socket.destroyed) return true;

  const result = await connectWithRetry(3, 80);
  return !(result instanceof ShimConnectionError);
}

/**
 * Ensures connection to the shim server, spawning if necessary.
 * Implements single-flight pattern to prevent concurrent connection attempts.
 * @returns void on success, ShimConnectionError on failure
 */
async function ensureConnected(): Promise<void | ShimConnectionError> {
  if (detached) {
    return new ShimConnectionError({ reason: 'Shim client detached' });
  }
  if (socket && !socket.destroyed) return;

  if (connecting) {
    const result = await connecting;
    return result instanceof ShimConnectionError ? result : undefined;
  }

  connecting = (async (): Promise<void | ShimConnectionError> => {
    const result = await connectSocket();
    if (result instanceof ShimConnectionError) {
      if (detached) return result;

      spawnShimProcess();
      const retryResult = await connectWithRetry();
      return retryResult;
    }
    return;
  })();

  try {
    const result = await connecting;
    return result instanceof ShimConnectionError ? result : undefined;
  } finally {
    connecting = null;
  }
}

/**
 * Sends a request to the shim server without automatic connection handling.
 * Used internally for shutdown and other low-level operations.
 * @param method - RPC method name
 * @param params - Method parameters
 * @param payloads - Binary payloads to include
 * @param timeoutMs - Optional timeout in milliseconds
 * @returns Response header and payloads, or ShimConnectionError
 */
export async function sendRequestDirect(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = [],
  timeoutMs?: number
): Promise<{ header: ShimHeader; payloads: Buffer[] } | ShimConnectionError> {
  const currentSocket = socket;
  if (!currentSocket || currentSocket.destroyed) {
    return new ShimConnectionError({ reason: 'Shim socket not available' });
  }

  const requestId = nextRequestId++;
  const header: ShimHeader = {
    type: 'request',
    requestId,
    method,
    params,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  };

  return new Promise((resolve) => {
    const timeout = timeoutMs
      ? setTimeout(() => {
          const pending = takePendingRequest(requestId);
          if (!pending) return;
          pending.reject(new ShimConnectionError({ reason: 'Shim request timed out' }));
        }, timeoutMs)
      : undefined;

    pendingRequests.set(requestId, {
      resolve,
      reject: (error) =>
        resolve(
          error instanceof ShimConnectionError
            ? error
            : new ShimConnectionError({ reason: error.message })
        ),
      timeout,
    });

    currentSocket.write(encodeFrame(header, payloads), (err) => {
      if (!err) return;
      const pending = takePendingRequest(requestId);
      pending?.reject(new ShimConnectionError({ reason: err.message, cause: err }));
    });
  });
}

/**
 * Sends a request to the shim server with automatic connection handling.
 * Ensures connection before sending, spawns shim if needed.
 * @param method - RPC method name
 * @param params - Method parameters
 * @param payloads - Binary payloads to include
 * @returns Response header and payloads
 * @throws ShimConnectionError if connection fails
 */
export async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  payloads: ArrayBuffer[] = [],
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<{ header: ShimHeader; payloads: Buffer[] }> {
  const connectResult = await ensureConnected();
  if (connectResult instanceof ShimConnectionError) throw connectResult;
  const currentSocket = socket;
  if (!currentSocket || currentSocket.destroyed) {
    throw new ShimConnectionError({ reason: 'Shim socket not available' });
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
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            const pending = takePendingRequest(requestId);
            if (!pending) return;
            pending.reject(new ShimConnectionError({ reason: 'Shim request timed out' }));
          }, timeoutMs)
        : undefined;

    pendingRequests.set(requestId, { resolve, reject, timeout });
    currentSocket.write(encodeFrame(header, payloads), (err) => {
      if (!err) return;
      const pending = takePendingRequest(requestId);
      pending?.reject(new ShimConnectionError({ reason: err.message, cause: err }));
    });
  });
}

/**
 * Registers a callback for shim detach events.
 * Called when this client loses the single-client lock.
 * @param callback - Function to call when detached
 * @returns Unsubscribe function
 */
export function onShimDetached(callback: () => void): () => void {
  detachedSubscribers.add(callback);
  return () => {
    detachedSubscribers.delete(callback);
  };
}

/**
 * Shuts down the shim server gracefully.
 * Attempts to send shutdown request, falls back to SIGTERM.
 */
export async function shutdownShim(): Promise<void> {
  if (connecting) {
    await connecting.catch((e) => {
      console.warn('[shim-client] Connection cleanup failed during shutdown:', e);
    });
  }

  const connected = await ensureConnectedWithoutSpawn();
  if (connected) {
    const shutdownResult = await sendRequestDirect('shutdown', undefined, [], 500);
    if (!(shutdownResult instanceof ShimConnectionError)) return;
  }

  if (!shimPid) return;

  try {
    process.kill(shimPid);
  } catch {
    // Ignore kill errors
  }
}

/**
 * Waits for connection to the shim server.
 * @returns void on success, ShimConnectionError on failure
 */
export async function waitForShim(): Promise<void | ShimConnectionError> {
  const result = await ensureConnected();
  if (result instanceof ShimConnectionError) {
    return result;
  }
}

/**
 * Marks this client as detached and notifies all subscribers.
 * Called when the shim server revokes our client lock.
 */
function markDetached(): void {
  if (detached) return;
  detached = true;
  // Detach is a terminal protocol event for this client, so all in-flight work must fail.
  rejectPendingRequests(new ShimConnectionError({ reason: 'Shim client detached' }));
  for (const callback of detachedSubscribers) {
    callback();
  }
}

export { handlePtyNotification } from './frame-handler';
