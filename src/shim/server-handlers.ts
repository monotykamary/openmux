/**
 * Shim Server Handlers - Main orchestrator
 * Reorganized to use modular handler packages in handlers/
 */
import type net from 'net';
import { dirname } from 'path';

import type { TerminalColors } from '../terminal/terminal-colors';
import { setHostColors as setHostColorsDefault } from '../terminal/terminal-colors';
import { SHIM_SOCKET_PATH } from './protocol';
import { createRequestHandler } from './server-requests';
import { sendResponse, sendError } from './server/frames';
import { createKittyHandlers } from './server/kitty';
import { getPtyService, hasServices } from '../effect/bridge/services-instance';
import { ServicesNotInitializedError } from '../effect/errors';

import {
  createEventSender,
  attachClient,
  detachClient,
  applyHostColors,
  type ShimHandlerContext,
  type ShimServerOptions,
} from './handlers';
import type { ShimServerState } from './server-state';

// Function declaration avoids TDZ failures when tests import this module through cycles.
async function defaultWithPty<A>(
  fn: (pty: ReturnType<typeof getPtyService>) => Promise<A | Error> | A | Error
): Promise<A | Error> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'withPty' });
  }
  const pty = getPtyService();
  return await fn(pty);
}

/**
 * Creates shim server handlers with configured context.
 * @param state - Shared server state instance
 * @param options - Optional server configuration
 * @returns Server handlers including socket path, request handler, and lifecycle methods
 */
export function createServerHandlers(state: ShimServerState, options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  const sendEvent = createEventSender(state);
  const kittyHandlers = createKittyHandlers(state, sendEvent);

  const context: ShimHandlerContext = {
    state,
    withPty,
    sendEvent,
    sendResponse,
    sendError,
    kittyHandlers,
    applyHostColors: (colors: TerminalColors) => applyHostColors(withPty, setHostColors, colors),
  };

  return {
    socketPath,
    socketDir,
    handleRequest: createRequestHandler(context),
    detachClient: (socket: net.Socket) => detachClient(context, socket),
    attachClient: (socket: net.Socket, clientId: string) =>
      attachClient(context, { socket, clientId }),
    context,
  };
}

export type { ShimHandlerContext, WithPty, ShimServerOptions } from './handlers';
