import net from 'net';
import fs from 'fs/promises';

import { ShimConnectionError } from '../effect/errors';

async function socketAcceptsConnections(
  socketPath: string
): Promise<boolean | ShimConnectionError> {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    const timeout = setTimeout(() => {
      cleanup();
      client.destroy();
      resolve(new ShimConnectionError({ reason: `Timed out checking shim socket: ${socketPath}` }));
    }, 250);

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeAllListeners('connect');
      client.removeAllListeners('error');
    };

    client.once('connect', () => {
      cleanup();
      client.end();
      resolve(true);
    });

    client.once('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      client.destroy();
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        resolve(false);
        return;
      }
      resolve(
        new ShimConnectionError({
          reason: `Failed to check shim socket ${socketPath}: ${error.message}`,
          cause: error,
        })
      );
    });
  });
}

/** Removes a stale socket file without replacing an active shim server. */
export async function prepareShimSocketFile(
  socketPath: string
): Promise<void | ShimConnectionError> {
  // Only unlink stale files. Removing an active Unix socket path orphans the running server.
  const activeSocket = await socketAcceptsConnections(socketPath);
  if (activeSocket instanceof ShimConnectionError) return activeSocket;
  if (activeSocket) {
    return new ShimConnectionError({ reason: `Shim socket already in use: ${socketPath}` });
  }

  try {
    await fs.unlink(socketPath);
  } catch {
    // Ignore missing file
  }
}
