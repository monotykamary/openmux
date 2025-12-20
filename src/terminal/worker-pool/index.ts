/**
 * Emulator Worker Pool - Coordinates Web Workers for terminal emulation
 *
 * This module manages a pool of Web Workers that run ghostty-web WASM,
 * distributing terminal sessions across workers with session affinity.
 *
 * Features:
 * - Worker pool (default 2 workers)
 * - Session affinity (same session always routes to same worker)
 * - Async request/response correlation
 * - Update callbacks for terminal state changes
 */

import type { WorkerOutbound } from '../emulator-interface';
import type { DirtyTerminalUpdate, TerminalScrollState } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import type { SearchResult, TerminalModes } from '../emulator-interface';

import type {
  SessionState,
  PendingRequest,
  UpdateCallback,
  TitleCallback,
  ModeCallback,
  QueuedMessage,
} from './types';
import { MAX_CONSECUTIVE_ERRORS, ERROR_WINDOW_MS } from './types';

import {
  createSession as createSessionImpl,
  waitForSession as waitForSessionImpl,
  destroySession,
} from './session-manager';

import {
  write as writeImpl,
  resize as resizeImpl,
  reset as resetImpl,
} from './operations';

import {
  getScrollbackLine as getScrollbackLineImpl,
  getScrollbackLines as getScrollbackLinesImpl,
  search as searchImpl,
} from './queries';

import {
  onUpdate as onUpdateImpl,
  onTitleChange as onTitleChangeImpl,
  onModeChange as onModeChangeImpl,
  setScrollState as setScrollStateImpl,
  getScrollState as getScrollStateImpl,
} from './subscriptions';

import { routeMessage } from './message-handler';
import { restartWorker } from './recovery';

export type { UpdateCallback, TitleCallback, ModeCallback };

export class EmulatorWorkerPool {
  private workers: Worker[] = [];
  private workersReady: boolean[] = [];
  private workerErrorCounts: number[] = [];
  private workerRestartInProgress: boolean[] = [];
  private sessionToState = new Map<string, SessionState>();
  private pendingRequests = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 0;
  private initialized = false;

  // Message batching for reduced main thread blocking
  private messageQueue: QueuedMessage[] = [];
  private flushScheduled = false;

  /**
   * Initialize the worker pool
   * @param workerCount Number of workers to create (default: 2)
   */
  async initialize(workerCount = 2): Promise<void> {
    if (this.initialized) {
      return;
    }

    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      // Use string literal instead of new URL() - workaround for Bun compiled binary bug
      // See: https://github.com/oven-sh/bun/issues/16869
      const worker = new Worker('./emulator-worker.ts', { type: 'module' });
      this.workers.push(worker);
      this.workersReady.push(false);
      this.workerErrorCounts.push(0);
      this.workerRestartInProgress.push(false);

      worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
        this.queueMessage(i, event.data);
      };

      worker.onerror = (error) => {
        console.error(`Worker ${i} error:`, error);
      };

      // Wait for worker to be ready
      workerPromises.push(
        new Promise<void>((resolve) => {
          const handler = (event: MessageEvent<WorkerOutbound>) => {
            if (event.data.type === 'ready') {
              this.workersReady[i] = true;
              worker.removeEventListener('message', handler);
              resolve();
            }
          };
          worker.addEventListener('message', handler);
        })
      );
    }

    await Promise.all(workerPromises);
    this.initialized = true;
  }

  /**
   * Check if the pool is initialized and all workers are ready
   */
  isReady(): boolean {
    return this.initialized && this.workersReady.every(Boolean);
  }

  /**
   * Terminate all workers and clean up
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.workersReady = [];
    this.workerErrorCounts = [];
    this.workerRestartInProgress = [];
    this.sessionToState.clear();
    this.pendingRequests.clear();
    this.initialized = false;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  createSession(sessionId: string, cols: number, rows: number, colors: TerminalColors): void {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }
    createSessionImpl(
      sessionId,
      cols,
      rows,
      colors,
      this.workers,
      this.sessionToState,
      () => this.selectLeastLoadedWorker()
    );
  }

  /**
   * Select the worker with the fewest active sessions (load-aware selection)
   * Falls back to round-robin if all workers have equal load
   */
  private selectLeastLoadedWorker(): number {
    const workerCount = this.workers.length;
    if (workerCount === 0) return 0;

    // Count sessions per worker
    const sessionCounts = new Array<number>(workerCount).fill(0);
    for (const state of this.sessionToState.values()) {
      if (state.workerIndex < workerCount) {
        sessionCounts[state.workerIndex]++;
      }
    }

    // Find worker with minimum sessions
    let minIndex = 0;
    let minCount = sessionCounts[0];
    for (let i = 1; i < workerCount; i++) {
      if (sessionCounts[i] < minCount) {
        minCount = sessionCounts[i];
        minIndex = i;
      }
    }

    return minIndex;
  }

  async waitForSession(sessionId: string): Promise<void> {
    return waitForSessionImpl(sessionId, this.sessionToState);
  }

  destroy(sessionId: string): void {
    destroySession(sessionId, this.workers, this.sessionToState);
  }

  // ============================================================================
  // Terminal Operations
  // ============================================================================

  write(sessionId: string, data: string | Uint8Array): void {
    writeImpl(sessionId, data, this.workers, this.sessionToState);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    resizeImpl(sessionId, cols, rows, this.workers, this.sessionToState);
  }

  reset(sessionId: string): void {
    resetImpl(sessionId, this.workers, this.sessionToState);
  }

  // ============================================================================
  // Async Queries
  // ============================================================================

  async getScrollbackLine(sessionId: string, offset: number): Promise<ArrayBuffer | null> {
    return getScrollbackLineImpl(
      sessionId,
      offset,
      this.workers,
      this.sessionToState,
      this.pendingRequests,
      () => this.nextRequestId++
    );
  }

  async getScrollbackLines(
    sessionId: string,
    startOffset: number,
    count: number
  ): Promise<Map<number, ArrayBuffer>> {
    return getScrollbackLinesImpl(
      sessionId,
      startOffset,
      count,
      this.workers,
      this.sessionToState,
      this.pendingRequests,
      () => this.nextRequestId++
    );
  }

  async search(
    sessionId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<SearchResult> {
    return searchImpl(
      sessionId,
      query,
      options,
      this.workers,
      this.sessionToState,
      this.pendingRequests,
      () => this.nextRequestId++
    );
  }

  // ============================================================================
  // Subscriptions
  // ============================================================================

  onUpdate(sessionId: string, callback: UpdateCallback): () => void {
    return onUpdateImpl(sessionId, callback, this.sessionToState);
  }

  onTitleChange(sessionId: string, callback: TitleCallback): () => void {
    return onTitleChangeImpl(sessionId, callback, this.sessionToState);
  }

  onModeChange(sessionId: string, callback: ModeCallback): () => void {
    return onModeChangeImpl(sessionId, callback, this.sessionToState);
  }

  setScrollState(sessionId: string, scrollState: TerminalScrollState): void {
    setScrollStateImpl(sessionId, scrollState, this.sessionToState);
  }

  getScrollState(sessionId: string): TerminalScrollState | null {
    return getScrollStateImpl(sessionId, this.sessionToState);
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  private queueMessage(workerIndex: number, msg: WorkerOutbound): void {
    this.messageQueue.push({ workerIndex, msg });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flushMessageQueue());
  }

  private flushMessageQueue(): void {
    this.flushScheduled = false;
    const queue = this.messageQueue;
    this.messageQueue = [];

    for (const { workerIndex, msg } of queue) {
      routeMessage(
        workerIndex,
        msg,
        this.sessionToState,
        this.pendingRequests,
        this.workerErrorCounts,
        MAX_CONSECUTIVE_ERRORS,
        ERROR_WINDOW_MS,
        (idx) => this.handleWorkerNeedsRestart(idx),
        this.workerRestartInProgress
      );
    }
  }

  private async handleWorkerNeedsRestart(workerIndex: number): Promise<void> {
    await restartWorker(
      workerIndex,
      this.workers,
      this.workersReady,
      this.workerErrorCounts,
      this.workerRestartInProgress,
      this.sessionToState,
      (idx, msg) => this.queueMessage(idx, msg)
    );
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let poolInstance: EmulatorWorkerPool | null = null;

/**
 * Get or create the global worker pool instance
 */
export function getWorkerPool(): EmulatorWorkerPool {
  if (!poolInstance) {
    poolInstance = new EmulatorWorkerPool();
  }
  return poolInstance;
}

/**
 * Initialize the global worker pool
 */
export async function initWorkerPool(workerCount?: number): Promise<EmulatorWorkerPool> {
  const pool = getWorkerPool();
  await pool.initialize(workerCount);
  return pool;
}
