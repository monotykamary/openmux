/**
 * Message handling for the Worker Pool
 */

import type {
  WorkerOutbound,
  SerializedDirtyUpdate,
  TerminalModes,
  SearchMatch,
} from '../emulator-interface';
import { unpackDirtyUpdateWithCache } from '../cell-serialization';
import type {
  SessionState,
  PendingRequest,
  InitPromiseWithResolvers,
  QueuedMessage,
  MAX_CONSECUTIVE_ERRORS,
  ERROR_WINDOW_MS,
} from './types';

/**
 * Handle 'initialized' message from worker
 */
export function handleInitialized(
  sessionId: string,
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (!state) return;

  state.initializationState = 'ready';

  // Resolve the initialization promise
  const promise = state.initializationPromise as InitPromiseWithResolvers | null;
  if (promise?._resolve) {
    promise._resolve();
  }
}

/**
 * Handle 'update' message from worker
 */
export function handleUpdate(
  sessionId: string,
  packed: SerializedDirtyUpdate,
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (!state) return;

  const { update, rowCache } = unpackDirtyUpdateWithCache(
    packed,
    state.scrollState,
    state.rowCache
  );
  state.rowCache = rowCache;

  // Update scroll state
  state.scrollState = {
    ...state.scrollState,
    scrollbackLength: update.scrollState.scrollbackLength,
  };

  if (state.updateCallback) {
    state.updateCallback(update);
  } else {
    // Buffer update until callback is registered (handles race condition during init)
    state.pendingUpdate = update;
  }
}

/**
 * Handle 'titleChange' message from worker
 */
export function handleTitleChange(
  sessionId: string,
  title: string,
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (state?.titleCallback) {
    state.titleCallback(title);
  }
}

/**
 * Handle 'modeChange' message from worker
 */
export function handleModeChange(
  sessionId: string,
  modes: TerminalModes,
  sessionToState: Map<string, SessionState>
): void {
  const state = sessionToState.get(sessionId);
  if (state?.modeCallback) {
    state.modeCallback(modes);
  }
}

/**
 * Handle 'scrollbackLine' response from worker
 */
export function handleScrollbackLine(
  requestId: number,
  cells: ArrayBuffer | null,
  pendingRequests: Map<number, PendingRequest<unknown>>
): void {
  const request = pendingRequests.get(requestId);
  if (!request) return;

  pendingRequests.delete(requestId);

  if (cells === null) {
    request.resolve(null);
  } else {
    request.resolve(cells);
  }
}

/**
 * Handle 'scrollbackLines' response from worker
 */
export function handleScrollbackLines(
  requestId: number,
  cellBuffers: ArrayBuffer[],
  offsets: number[],
  pendingRequests: Map<number, PendingRequest<unknown>>
): void {
  const request = pendingRequests.get(requestId);
  if (!request) return;

  pendingRequests.delete(requestId);

  const result = new Map<number, ArrayBuffer>();
  for (let i = 0; i < cellBuffers.length; i++) {
    result.set(offsets[i], cellBuffers[i]);
  }
  request.resolve(result);
}

/**
 * Handle 'searchResults' response from worker
 */
export function handleSearchResults(
  requestId: number,
  matches: SearchMatch[],
  hasMore: boolean,
  pendingRequests: Map<number, PendingRequest<unknown>>
): void {
  const request = pendingRequests.get(requestId);
  if (!request) return;

  pendingRequests.delete(requestId);
  request.resolve({ matches, hasMore });
}

/**
 * Handle 'error' message from worker
 */
export function handleError(
  workerIndex: number,
  sessionId: string | undefined,
  requestId: number | undefined,
  message: string,
  sessionToState: Map<string, SessionState>,
  pendingRequests: Map<number, PendingRequest<unknown>>,
  workerErrorCounts: number[],
  maxConsecutiveErrors: number,
  errorWindowMs: number,
  onWorkerNeedsRestart: (workerIndex: number) => void,
  workerRestartInProgress: boolean[]
): void {
  console.error(
    `Worker ${workerIndex} error${sessionId ? ` (session: ${sessionId})` : ''}:`,
    message
  );

  // Track errors per worker
  const now = Date.now();

  // Reset error count if last error was outside the window
  if (workerErrorCounts[workerIndex] > 0) {
    // Check if we should reset (no recent errors)
    const sessionsOnWorker = Array.from(sessionToState.values()).filter(
      (s) => s.workerIndex === workerIndex
    );
    const recentError = sessionsOnWorker.some(
      (s) => s.lastErrorAt && now - s.lastErrorAt < errorWindowMs
    );
    if (!recentError) {
      workerErrorCounts[workerIndex] = 0;
    }
  }

  workerErrorCounts[workerIndex]++;

  // Update session error tracking if we have a session
  if (sessionId) {
    const state = sessionToState.get(sessionId);
    if (state) {
      state.errorCount++;
      state.lastErrorAt = now;

      // Reject initialization promise if session was still pending
      if (state.initializationState === 'pending') {
        state.initializationState = 'failed';
        const promise = state.initializationPromise as InitPromiseWithResolvers | null;
        if (promise?._reject) {
          promise._reject(new Error(message));
        }
        sessionToState.delete(sessionId);
      }
    }
  }

  // Reject pending request if any
  if (requestId !== undefined) {
    const request = pendingRequests.get(requestId);
    if (request) {
      pendingRequests.delete(requestId);
      request.reject(new Error(message));
    }
  }

  // Check if worker needs restart
  if (
    workerErrorCounts[workerIndex] >= maxConsecutiveErrors &&
    !workerRestartInProgress[workerIndex]
  ) {
    onWorkerNeedsRestart(workerIndex);
  }
}

/**
 * Route a worker message to the appropriate handler
 */
export function routeMessage(
  workerIndex: number,
  msg: WorkerOutbound,
  sessionToState: Map<string, SessionState>,
  pendingRequests: Map<number, PendingRequest<unknown>>,
  workerErrorCounts: number[],
  maxConsecutiveErrors: number,
  errorWindowMs: number,
  onWorkerNeedsRestart: (workerIndex: number) => void,
  workerRestartInProgress: boolean[]
): void {
  switch (msg.type) {
    case 'ready':
      // Already handled during initialization
      break;

    case 'initialized':
      handleInitialized(msg.sessionId, sessionToState);
      break;

    case 'update':
      handleUpdate(msg.sessionId, msg.update, sessionToState);
      break;

    case 'titleChange':
      handleTitleChange(msg.sessionId, msg.title, sessionToState);
      break;

    case 'modeChange':
      handleModeChange(msg.sessionId, msg.modes, sessionToState);
      break;

    case 'scrollbackLine':
      handleScrollbackLine(msg.requestId, msg.cells, pendingRequests);
      break;

    case 'scrollbackLines':
      handleScrollbackLines(msg.requestId, msg.cells, msg.offsets, pendingRequests);
      break;

    case 'searchResults':
      handleSearchResults(msg.requestId, msg.matches, msg.hasMore, pendingRequests);
      break;

    case 'destroyed':
      // Session already removed from map
      break;

    case 'error':
      handleError(
        workerIndex,
        msg.sessionId,
        msg.requestId,
        msg.message,
        sessionToState,
        pendingRequests,
        workerErrorCounts,
        maxConsecutiveErrors,
        errorWindowMs,
        onWorkerNeedsRestart,
        workerRestartInProgress
      );
      break;
  }
}
