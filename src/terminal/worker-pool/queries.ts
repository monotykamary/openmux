/**
 * Async queries for the Worker Pool
 */

import type { WorkerInbound, SearchResult } from '../emulator-interface';
import type { PackedRowUpdate } from '../../core/types';
import type { SessionState, PendingRequest } from './types';

/**
 * Get a scrollback line
 */
export async function getScrollbackLine(
  sessionId: string,
  offset: number,
  workers: Worker[],
  sessionToState: Map<string, SessionState>,
  pendingRequests: Map<number, PendingRequest<unknown>>,
  getNextRequestId: () => number
): Promise<PackedRowUpdate | null> {
  const state = sessionToState.get(sessionId);
  if (!state) return null;

  const requestId = getNextRequestId();
  const msg: WorkerInbound = {
    type: 'getScrollbackLine',
    sessionId,
    offset,
    requestId,
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as PackedRowUpdate | null),
      reject,
    });
    workers[state.workerIndex].postMessage(msg);
  });
}

/**
 * Get multiple scrollback lines
 */
export async function getScrollbackLines(
  sessionId: string,
  startOffset: number,
  count: number,
  workers: Worker[],
  sessionToState: Map<string, SessionState>,
  pendingRequests: Map<number, PendingRequest<unknown>>,
  getNextRequestId: () => number
): Promise<PackedRowUpdate | null> {
  const state = sessionToState.get(sessionId);
  if (!state) return null;

  const requestId = getNextRequestId();
  const msg: WorkerInbound = {
    type: 'getScrollbackLines',
    sessionId,
    startOffset,
    count,
    requestId,
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as PackedRowUpdate | null),
      reject,
    });
    workers[state.workerIndex].postMessage(msg);
  });
}

/**
 * Search for text in terminal
 */
export async function search(
  sessionId: string,
  query: string,
  options: { limit?: number } | undefined,
  workers: Worker[],
  sessionToState: Map<string, SessionState>,
  pendingRequests: Map<number, PendingRequest<unknown>>,
  getNextRequestId: () => number
): Promise<SearchResult> {
  const state = sessionToState.get(sessionId);
  if (!state) return { matches: [], hasMore: false };

  const requestId = getNextRequestId();
  const msg: WorkerInbound = {
    type: 'search',
    sessionId,
    query,
    requestId,
    limit: options?.limit,
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as SearchResult),
      reject,
    });
    workers[state.workerIndex].postMessage(msg);
  });
}
