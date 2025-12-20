/**
 * Session management for the Worker Pool
 */

import type { WorkerInbound, WorkerTerminalColors } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { extractRgb } from '../terminal-colors';
import type { SessionState, InitPromiseWithResolvers } from './types';

/**
 * Create a new terminal session
 *
 * This method is non-blocking - it returns immediately after sending the
 * initialization message to the worker. The worker will buffer any incoming
 * writes until initialization completes.
 */
export function createSession(
  sessionId: string,
  cols: number,
  rows: number,
  colors: TerminalColors,
  workers: Worker[],
  sessionToState: Map<string, SessionState>,
  getNextWorkerIndex: () => number
): void {
  if (sessionToState.has(sessionId)) {
    throw new Error(`Session ${sessionId} already exists`);
  }

  // Select worker (round-robin)
  const workerIndex = getNextWorkerIndex();

  // Convert TerminalColors to WorkerTerminalColors
  const workerColors: WorkerTerminalColors = {
    foreground: extractRgb(colors.foreground),
    background: extractRgb(colors.background),
    palette: colors.palette.map(extractRgb),
  };

  // Create initialization promise (resolved by handleWorkerMessage)
  let resolveInit: () => void;
  let rejectInit: (error: Error) => void;
  const initPromise = new Promise<void>((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });

  // Store resolve/reject functions for use by message handler
  // We attach them to the promise object for access in handleInitialized/handleError
  (initPromise as InitPromiseWithResolvers)._resolve = resolveInit!;
  (initPromise as InitPromiseWithResolvers)._reject = rejectInit!;

  // Track session state with pending initialization
  sessionToState.set(sessionId, {
    workerIndex,
    updateCallback: null,
    titleCallback: null,
    modeCallback: null,
    scrollState: {
      viewportOffset: 0,
      scrollbackLength: 0,
      isAtBottom: true,
    },
    rowCache: null,
    pendingUpdate: null,
    errorCount: 0,
    lastErrorAt: null,
    initializationState: 'pending',
    initializationPromise: initPromise,
  });

  // Send init message (fire and forget - don't block)
  const msg: WorkerInbound = {
    type: 'init',
    sessionId,
    cols,
    rows,
    colors: workerColors,
  };
  workers[workerIndex].postMessage(msg);

  // Return immediately - worker buffers writes until session is ready
}

/**
 * Wait for a session to complete initialization
 * Use this if you need to ensure the session is fully ready before proceeding.
 */
export async function waitForSession(
  sessionId: string,
  sessionToState: Map<string, SessionState>
): Promise<void> {
  const state = sessionToState.get(sessionId);
  if (!state) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (state.initializationState === 'ready') {
    return;
  }
  if (state.initializationState === 'failed') {
    throw new Error('Session initialization failed');
  }
  if (state.initializationPromise) {
    await state.initializationPromise;
  }
}

/**
 * Destroy a session
 */
export function destroySession(
  sessionId: string,
  workers: Worker[],
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (!state) return;

  const msg: WorkerInbound = { type: 'destroy', sessionId };
  workers[state.workerIndex].postMessage(msg);
  sessionToState.delete(sessionId);
}
