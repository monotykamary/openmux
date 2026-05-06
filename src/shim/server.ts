import net from 'net';
import fs from 'fs/promises';
import * as errore from 'errore';

import { FrameReader } from './protocol';
import { createServerHandlers, type ShimServerOptions } from './server-handlers';
import { createShimServerState, resetShimServerState } from './server-state';
import { ShimConnectionError } from '../effect/errors';

const shimState = createShimServerState();

/**
 * Ensures the socket directory exists, creating it if necessary.
 * @param socketDir - Path to the socket directory
 * @returns void on success, ShimConnectionError on failure
 */
async function ensureSocketDir(socketDir: string): Promise<void | ShimConnectionError> {
  const result = await errore.tryAsync<string | undefined, ShimConnectionError>({
    try: () => fs.mkdir(socketDir, { recursive: true }),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to create socket directory: ${e}`, cause: e }),
  });
  if (result instanceof ShimConnectionError) return result;
}

/**
 * Removes the socket file if it exists, ignoring errors.
 * @param socketPath - Path to the socket file to remove
 */
async function removeSocketFile(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch {
    // intentionally ignored: socket file may not exist on first run
  }
}

/**
 * Starts the shim server listening on a Unix socket.
 * Creates server handlers and manages client connections with single-client lock semantics.
 * @param options - Optional server configuration including socket path and PTY provider
 * @returns net.Server on success, ShimConnectionError on failure
 */
export async function startShimServer(
  options?: ShimServerOptions
): Promise<net.Server | ShimConnectionError> {
  resetShimServerState(shimState);

  const handlers = createServerHandlers(shimState, options);

  const dirResult = await ensureSocketDir(handlers.socketDir);
  if (dirResult instanceof ShimConnectionError) return dirResult;

  await removeSocketFile(handlers.socketPath);

  const server = net.createServer((socket) => {
    const frameReader = new FrameReader();

    socket.on('data', (chunk) => {
      frameReader.feed(chunk as Buffer, (header, payloads) => {
        if (header.type !== 'request') return;
        handlers.handleRequest(socket, header, payloads).catch((e) => {
          console.warn('[shim] Request handler failed:', e);
        });
      });
    });

    socket.on('close', () => {
      shimState.clientIds.delete(socket);
      handlers.detachClient(socket).catch((e) => {
        console.warn('[shim] Detach on close failed:', e);
      });
    });

    socket.on('error', () => {
      shimState.clientIds.delete(socket);
      handlers.detachClient(socket).catch((e) => {
        console.warn('[shim] Detach on error failed:', e);
      });
    });
  });

  const listenResult = await errore.tryAsync<void, ShimConnectionError>({
    try: () =>
      new Promise((resolve, reject) => {
        server.listen(handlers.socketPath, () => resolve());
        server.once('error', reject);
      }),
    catch: (e) => new ShimConnectionError({ reason: `Failed to start server: ${e}`, cause: e }),
  });

  if (listenResult instanceof ShimConnectionError) return listenResult;

  return server;
}
