/**
 * Types for the Emulator Worker Pool
 */

import type {
  WorkerOutbound,
  TerminalModes,
} from '../emulator-interface';
import type { DirtyTerminalUpdate, TerminalScrollState } from '../../core/types';
import type { RowCache } from '../cell-serialization';

/**
 * Callback for terminal updates from worker
 */
export type UpdateCallback = (update: DirtyTerminalUpdate) => void;

/**
 * Callback for title changes
 */
export type TitleCallback = (title: string) => void;

/**
 * Callback for mode changes
 */
export type ModeCallback = (modes: TerminalModes) => void;

/**
 * Session state tracked by the pool
 */
export interface SessionState {
  workerIndex: number;
  updateCallback: UpdateCallback | null;
  titleCallback: TitleCallback | null;
  modeCallback: ModeCallback | null;
  scrollState: TerminalScrollState;
  rowCache: RowCache | null;
  // Buffer for updates received before callback is set
  pendingUpdate: DirtyTerminalUpdate | null;
  // Error tracking for worker recovery
  errorCount: number;
  lastErrorAt: number | null;
  // Initialization tracking for non-blocking session creation
  initializationState: 'pending' | 'ready' | 'failed';
  initializationPromise: Promise<void> | null;
}

/**
 * Pending request waiting for response
 */
export interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Promise with attached resolve/reject for non-blocking session creation
 */
export interface InitPromiseWithResolvers extends Promise<void> {
  _resolve: () => void;
  _reject: (error: Error) => void;
}

/**
 * Queued message from worker
 */
export interface QueuedMessage {
  workerIndex: number;
  msg: WorkerOutbound;
}

// Worker recovery constants
export const MAX_CONSECUTIVE_ERRORS = 3;
export const ERROR_WINDOW_MS = 5000;
