/**
 * WorkerEmulator - ITerminalEmulator implementation backed by Web Worker
 *
 * This class implements the ITerminalEmulator interface by proxying
 * operations to the EmulatorWorkerPool. It maintains a local cache
 * of terminal state that gets updated via worker callbacks.
 *
 * Key differences from GhosttyEmulator:
 * - VT parsing happens in worker thread (non-blocking)
 * - State is cached locally for synchronous access
 * - Some operations (like scrollback access) are async by nature
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from '../core/types';
import type { ITerminalEmulator, TerminalModes, SearchMatch, SearchResult } from './emulator-interface';
import type { EmulatorWorkerPool } from './worker-pool';
import type { TerminalColors } from './terminal-colors';
import {
  ScrollbackCache,
  shouldClearCacheOnUpdate,
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from './worker-emulator/index';

// ============================================================================
// WorkerEmulator Class
// ============================================================================

export class WorkerEmulator implements ITerminalEmulator {
  private pool: EmulatorWorkerPool;
  private sessionId: string;
  private _cols: number;
  private _rows: number;
  private _disposed = false;
  private colors: TerminalColors;

  // Cached state from worker updates
  private cachedState: TerminalState | null = null;
  private cachedUpdate: DirtyTerminalUpdate | null = null;
  private scrollState: TerminalScrollState = createDefaultScrollState();

  // Mode state (updated via worker callbacks)
  private modes: TerminalModes = createDefaultModes();

  // Title state
  private currentTitle = '';
  private titleCallbacks = new Set<(title: string) => void>();

  // Update callbacks (fires when worker sends state update)
  private updateCallbacks = new Set<() => void>();

  // Mode change callbacks (fires when terminal modes change)
  private modeChangeCallbacks = new Set<(modes: TerminalModes, prevModes?: TerminalModes) => void>();

  // Scrollback cache (main thread side)
  // Size 1000 provides buffer for ~40 screens during fast scrolling
  private scrollbackCache = new ScrollbackCache(1000);

  // Unsubscribe functions
  private unsubUpdate: (() => void) | null = null;
  private unsubTitle: (() => void) | null = null;
  private unsubMode: (() => void) | null = null;

  constructor(
    pool: EmulatorWorkerPool,
    sessionId: string,
    cols: number,
    rows: number,
    colors: TerminalColors
  ) {
    this.pool = pool;
    this.sessionId = sessionId;
    this._cols = cols;
    this._rows = rows;
    this.colors = colors;

    // Subscribe to worker updates
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    // Subscribe to terminal updates
    this.unsubUpdate = this.pool.onUpdate(this.sessionId, (update) => {
      this.handleUpdate(update);
    });

    // Subscribe to title changes
    this.unsubTitle = this.pool.onTitleChange(this.sessionId, (title) => {
      this.currentTitle = title;
      for (const callback of this.titleCallbacks) {
        callback(title);
      }
    });

    // Subscribe to mode changes
    this.unsubMode = this.pool.onModeChange(this.sessionId, (modes) => {
      const prevModes = { ...this.modes };
      this.modes = modes;
      // Notify mode change subscribers
      for (const callback of this.modeChangeCallbacks) {
        callback(modes, prevModes);
      }
    });
  }

  private handleUpdate(update: DirtyTerminalUpdate): void {
    this.cachedUpdate = update;

    const newScrollbackLength = update.scrollState.scrollbackLength;
    const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;

    // Smart cache invalidation using ScrollbackCache
    this.scrollbackCache.handleScrollbackChange(newScrollbackLength, isAtScrollbackLimit);

    // Update scroll state
    this.scrollState = {
      ...this.scrollState,
      scrollbackLength: newScrollbackLength,
    };

    // Check if cache should be cleared on mode change
    const shouldClearCache = shouldClearCacheOnUpdate(update, this.modes);

    // Update modes
    this.modes = {
      mouseTracking: update.mouseTracking,
      cursorKeyMode: update.cursorKeyMode,
      alternateScreen: update.alternateScreen,
      inBandResize: update.inBandResize ?? false,
    };

    // If full update, cache the full state
    if (update.isFull && update.fullState) {
      this.cachedState = update.fullState;
      // Clear scrollback cache when alternate screen mode changes
      if (shouldClearCache) {
        this.scrollbackCache.clear();
      }
    } else if (this.cachedState) {
      // Apply dirty rows to cached state
      for (const [rowIndex, cells] of update.dirtyRows) {
        if (rowIndex >= 0 && rowIndex < this.cachedState.rows) {
          this.cachedState.cells[rowIndex] = cells;
        }
      }
      this.cachedState.cursor = update.cursor;
    }

    // Sync scroll state to pool
    this.pool.setScrollState(this.sessionId, this.scrollState);

    // Notify update subscribers (critical for async notification)
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  // ============================================================================
  // ITerminalEmulator Implementation
  // ============================================================================

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  write(data: string | Uint8Array): void {
    if (this._disposed) return;
    this.pool.write(this.sessionId, data);
  }

  resize(cols: number, rows: number): void {
    if (this._disposed) return;

    // Skip if dimensions haven't changed (prevents unnecessary cache clear on focus changes)
    if (cols === this._cols && rows === this._rows) {
      return;
    }

    this._cols = cols;
    this._rows = rows;
    this.pool.resize(this.sessionId, cols, rows);
    // Don't clear scrollback cache here - keep stale content visible during resize
    // to prevent flash. Cache will be cleared in handleUpdate() when worker sends
    // the full state update with reflowed content.
  }

  reset(): void {
    if (this._disposed) return;
    this.pool.reset(this.sessionId);
    this.currentTitle = '';
    this.scrollbackCache.clear();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Unsubscribe from updates
    this.unsubUpdate?.();
    this.unsubTitle?.();
    this.unsubMode?.();

    // Destroy session in worker
    this.pool.destroy(this.sessionId);

    // Clear local state
    this.cachedState = null;
    this.cachedUpdate = null;
    this.titleCallbacks.clear();
    this.updateCallbacks.clear();
    this.scrollbackCache.clear();
  }

  getScrollbackLength(): number {
    return this.scrollState.scrollbackLength;
  }

  /**
   * Get a scrollback line from cache (synchronous).
   * Returns null if not cached - use getScrollbackLineAsync for guaranteed access.
   */
  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.scrollbackCache.get(offset);
  }

  /**
   * Get a scrollback line asynchronously (fetches from worker if needed)
   */
  async getScrollbackLineAsync(offset: number): Promise<TerminalCell[] | null> {
    // Check cache first
    const cached = this.scrollbackCache.get(offset);
    if (cached) return cached;

    // Fetch from worker
    const cells = await this.pool.getScrollbackLine(this.sessionId, offset);

    if (cells) {
      // Cache the result
      this.scrollbackCache.set(offset, cells);
    }

    return cells;
  }

  /**
   * Prefetch scrollback lines into cache
   */
  async prefetchScrollbackLines(startOffset: number, count: number): Promise<void> {
    const lines = await this.pool.getScrollbackLines(this.sessionId, startOffset, count);
    this.scrollbackCache.setMany(lines);
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    // Update our scroll state
    this.scrollState = scrollState;
    this.pool.setScrollState(this.sessionId, scrollState);

    // Return cached update or create empty one
    if (this.cachedUpdate) {
      // Return and clear the cached update
      // Merge scroll states: preserve isAtScrollbackLimit from cached update (set by worker)
      // while using viewportOffset and isAtBottom from the passed scrollState
      const mergedScrollState: TerminalScrollState = {
        ...scrollState,
        isAtScrollbackLimit: this.cachedUpdate.scrollState.isAtScrollbackLimit,
      };
      const update = {
        ...this.cachedUpdate,
        scrollState: mergedScrollState,
      };
      this.cachedUpdate = null;
      return update;
    }

    // No pending update - return empty
    return createEmptyDirtyUpdate(
      this._cols,
      this._rows,
      scrollState,
      this.modes,
      this.cachedState?.cursor
    );
  }

  getTerminalState(): TerminalState {
    if (this.cachedState) {
      return { ...this.cachedState };
    }

    // Return empty state if not yet received from worker
    return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    if (this.cachedState?.cursor) {
      return {
        x: this.cachedState.cursor.x,
        y: this.cachedState.cursor.y,
        visible: this.cachedState.cursor.visible,
      };
    }
    return { x: 0, y: 0, visible: true };
  }

  getCursorKeyMode(): 'normal' | 'application' {
    return this.modes.cursorKeyMode;
  }

  isMouseTrackingEnabled(): boolean {
    return this.modes.mouseTracking;
  }

  isAlternateScreen(): boolean {
    return this.modes.alternateScreen;
  }

  getMode(mode: number): boolean {
    // For now, only support the modes we track
    switch (mode) {
      case 1: // DECCKM
        return this.modes.cursorKeyMode === 'application';
      case 1000:
      case 1002:
      case 1003:
        return this.modes.mouseTracking;
      case 2048: // DECSET 2048 - in-band resize notifications
        return this.modes.inBandResize;
      default:
        return false;
    }
  }

  getColors(): TerminalColors {
    return this.colors;
  }

  getTitle(): string {
    return this.currentTitle;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleCallbacks.add(callback);
    // Immediately call with current title if set
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => {
      this.modeChangeCallbacks.delete(callback);
    };
  }

  // ============================================================================
  // Worker-Specific Methods
  // ============================================================================

  /**
   * Get the session ID for this emulator
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Search for text in terminal (async, executed in worker)
   */
  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return this.pool.search(this.sessionId, query, options);
  }

  /**
   * Get current scroll state
   */
  getScrollState(): TerminalScrollState {
    return this.scrollState;
  }

  /**
   * Set scroll state
   */
  setScrollState(state: TerminalScrollState): void {
    this.scrollState = state;
    this.pool.setScrollState(this.sessionId, state);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new WorkerEmulator
 *
 * This function is non-blocking - session creation happens asynchronously
 * in the worker pool. The worker buffers any incoming writes until the
 * session is fully initialized.
 */
export function createWorkerEmulator(
  pool: EmulatorWorkerPool,
  cols: number,
  rows: number,
  colors: TerminalColors
): WorkerEmulator {
  const sessionId = generateSessionId();
  pool.createSession(sessionId, cols, rows, colors);
  return new WorkerEmulator(pool, sessionId, cols, rows, colors);
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
