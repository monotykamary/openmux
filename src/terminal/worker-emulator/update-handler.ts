/**
 * Update Handler - processes terminal updates from workers
 */
import type { TerminalState, TerminalScrollState, DirtyTerminalUpdate, PackedRowUpdate } from '../../core/types';
import type { TerminalModes } from '../emulator-interface';
import type { ScrollbackCache } from './scrollback-cache';
import { shouldClearCacheOnUpdate } from './scrollback-cache';

export interface UpdateHandlerState {
  cachedState: TerminalState | null;
  cachedUpdate: DirtyTerminalUpdate | null;
  scrollState: TerminalScrollState;
  modes: TerminalModes;
  scrollbackCache: ScrollbackCache<unknown>;
  scrollbackPackedCache: ScrollbackCache<unknown>;
  livePackedCache: Array<PackedRowUpdate | null>;
  livePackedCols: number;
  scrollbackPackedCols: number;
  applyPackedRowsToLiveCache: (packedRows: PackedRowUpdate) => void;
}

export interface UpdateCallbacks {
  updateCallbacks: Set<() => void>;
  syncScrollStateToPool: (scrollState: TerminalScrollState) => void;
}

/**
 * Handle an update from the worker
 */
export function handleTerminalUpdate(
  state: UpdateHandlerState,
  callbacks: UpdateCallbacks,
  update: DirtyTerminalUpdate
): void {
  state.cachedUpdate = update;

  const newScrollbackLength = update.scrollState.scrollbackLength;
  const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;

  // Smart cache invalidation using ScrollbackCache
  state.scrollbackCache.handleScrollbackChange(newScrollbackLength, isAtScrollbackLimit);
  state.scrollbackPackedCache.handleScrollbackChange(newScrollbackLength, isAtScrollbackLimit);

  // Update scroll state
  state.scrollState = {
    ...state.scrollState,
    scrollbackLength: newScrollbackLength,
  };

  // Check if cache should be cleared on mode change
  const shouldClearCache = shouldClearCacheOnUpdate(update, state.modes);

  // Update modes
  state.modes = {
    mouseTracking: update.mouseTracking,
    cursorKeyMode: update.cursorKeyMode,
    alternateScreen: update.alternateScreen,
    inBandResize: update.inBandResize ?? false,
  };

  // If full update, cache the full state
  if (update.isFull && update.fullState) {
    state.cachedState = update.fullState;
    state.livePackedCols = update.fullState.cols;
    state.livePackedCache = new Array(update.fullState.rows).fill(null);
    // Clear scrollback cache when alternate screen mode changes
    if (shouldClearCache) {
      state.scrollbackCache.clear();
      state.scrollbackPackedCache.clear();
    }
  } else {
    if (update.packedRows) {
      state.applyPackedRowsToLiveCache(update.packedRows);
    }

    if (state.cachedState) {
      if (update.dirtyRows.size > 0) {
        // Apply dirty rows to cached state (non-worker emulators)
        for (const [rowIndex, cells] of update.dirtyRows) {
          if (rowIndex >= 0 && rowIndex < state.cachedState.rows) {
            state.cachedState.cells[rowIndex] = cells;
          }
        }
      }
      state.cachedState.cursor = update.cursor;
      state.cachedState.alternateScreen = update.alternateScreen;
      state.cachedState.mouseTracking = update.mouseTracking;
      state.cachedState.cursorKeyMode = update.cursorKeyMode;
    }
  }

  // Sync scroll state to pool
  callbacks.syncScrollStateToPool(state.scrollState);

  // Notify update subscribers (critical for async notification)
  for (const callback of callbacks.updateCallbacks) {
    callback();
  }
}

/**
 * Clear all caches (used on reset)
 */
export function clearAllCaches(state: UpdateHandlerState): void {
  state.scrollbackCache.clear();
  state.scrollbackPackedCache.clear();
  state.livePackedCache = [];
  state.livePackedCols = 0;
  state.scrollbackPackedCols = 0;
}

/**
 * Clear state on dispose
 */
export function clearUpdateHandlerState(state: UpdateHandlerState): void {
  state.cachedState = null;
  state.cachedUpdate = null;
  clearAllCaches(state);
}
