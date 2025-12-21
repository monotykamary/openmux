/**
 * PTY Subscription - handles subscribing to PTY updates for TerminalView
 */
import type { TerminalCell, UnifiedTerminalUpdate } from '../../core/types';
import {
  subscribeUnifiedToPty,
  getEmulator,
  prefetchScrollbackLines,
} from '../../effect/bridge';
import { updateTransitionCache } from './row-fetching';
import type { TerminalViewState } from './terminal-view-state';

export interface PtySubscriptionCallbacks {
  requestRenderFrame: () => void;
}

export interface PtySubscriptionResult {
  cleanup: () => void;
}

export async function setupPtySubscription(
  ptyId: string,
  state: TerminalViewState,
  callbacks: PtySubscriptionCallbacks,
  getMounted: () => boolean
): Promise<PtySubscriptionResult> {
  let unsubscribe: (() => void) | null = null;
  let cachedRows: TerminalCell[][] = [];

  // Get emulator for scrollback access
  const em = await getEmulator(ptyId);
  if (!getMounted()) return { cleanup: () => {} };
  state.emulator = em;

  // Set up prefetch function
  state.executePrefetchFn = async () => {
    if (!state.pendingPrefetch || state.prefetchInProgress || !getMounted()) return;

    const { ptyId: prefetchPtyId, start, count } = state.pendingPrefetch;
    const missingSnapshot = state.pendingMissingRows;
    state.pendingPrefetch = null;
    state.pendingMissingRows = null;
    state.prefetchInProgress = true;

    try {
      await prefetchScrollbackLines(prefetchPtyId, start, count);
      if (getMounted()) {
        if (state.applyPrefetchSnapshot(missingSnapshot)) {
          callbacks.requestRenderFrame();
        }
      }
    } finally {
      state.prefetchInProgress = false;
      if (state.pendingPrefetch && getMounted()) {
        state.executePrefetchFn?.();
      }
    }
  };

  // Subscribe to unified updates
  unsubscribe = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
    if (!getMounted()) return;
    handleUnifiedUpdate(state, update, cachedRows, callbacks);
  });

  // Trigger initial render
  callbacks.requestRenderFrame();

  return {
    cleanup: () => {
      unsubscribe?.();
    },
  };
}

function handleUnifiedUpdate(
  state: TerminalViewState,
  update: UnifiedTerminalUpdate,
  cachedRows: TerminalCell[][],
  callbacks: PtySubscriptionCallbacks
): void {
  const { terminalUpdate } = update;
  const prevViewportOffset = state.scrollState.viewportOffset;
  const prevCursorRow = state.terminalState?.cursor.y ?? null;
  const prevCursorVisible = state.terminalState?.cursor.visible ?? true;
  const oldScrollbackLength = state.scrollState.scrollbackLength;
  const newScrollbackLength = update.scrollState.scrollbackLength;
  const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
  const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

  // Update transition cache based on scrollback changes
  updateTransitionCache(
    state.transitionCache,
    state.terminalState,
    oldScrollbackLength,
    newScrollbackLength,
    state.scrollState.viewportOffset,
    isAtScrollbackLimit
  );

  // Cache packed rows transitioning to scrollback
  if (scrollbackDelta > 0 && state.scrollState.viewportOffset > 0 && state.packedRowCache.packedRowCache) {
    const decodeCols = state.terminalState?.cols ?? terminalUpdate.cols;
    for (let i = 0; i < scrollbackDelta; i++) {
      const entry = state.packedRowCache.packedRowCache[i];
      if (!entry || entry.capacityCols < decodeCols) continue;
      const row = state.packedRowCache.decodePackedRowEntry(entry, decodeCols);
      state.transitionCache.set(oldScrollbackLength + i, row);
    }
  }

  // Update terminal state
  if (terminalUpdate.isFull && terminalUpdate.fullState) {
    state.terminalState = terminalUpdate.fullState;
    cachedRows.length = 0;
    cachedRows.push(...terminalUpdate.fullState.cells);
    state.transitionCache.clear();
    state.packedRowCache.clearScrollbackPackedCache();
    state.dirtyAll = true;
    state.markAllRowsDirty(terminalUpdate.fullState.rows);
  } else {
    const existingState = state.terminalState;
    if (existingState) {
      if (terminalUpdate.dirtyRows.size > 0) {
        for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
          cachedRows[rowIdx] = newRow;
          state.markRowDirty(rowIdx);
        }
      } else if (terminalUpdate.packedRows) {
        for (let i = 0; i < terminalUpdate.packedRows.rowIndices.length; i++) {
          const rowIdx = terminalUpdate.packedRows.rowIndices[i];
          if (rowIdx < 0 || rowIdx >= existingState.rows) continue;
          state.markRowDirty(rowIdx);
        }
      }
      state.terminalState = {
        ...existingState,
        cells: cachedRows,
        cursor: terminalUpdate.cursor,
        alternateScreen: terminalUpdate.alternateScreen,
        mouseTracking: terminalUpdate.mouseTracking,
        cursorKeyMode: terminalUpdate.cursorKeyMode,
      };
    }
  }

  // Apply packed row updates
  if (terminalUpdate.packedRows) {
    if (
      state.packedRowCache.packedRowCache &&
      state.packedRowCache.packedRowCacheDirty &&
      state.packedRowCache.packedRowCacheCols === terminalUpdate.packedRows.cols
    ) {
      state.packedRowCache.applyPackedRowUpdate(
        terminalUpdate.packedRows,
        state.packedRowCache.packedRowCache.length
      );
    } else {
      state.pendingPackedRows = terminalUpdate.packedRows;
    }
  }

  // Mark cursor rows dirty
  if (state.terminalState) {
    if (!state.dirtyRows || state.dirtyRows.length !== state.terminalState.rows) {
      state.dirtyAll = true;
      state.markAllRowsDirty(state.terminalState.rows);
    } else {
      const nextCursorRow = state.terminalState.cursor.y ?? null;
      const nextCursorVisible = state.terminalState.cursor.visible ?? true;
      if (prevCursorRow !== null) state.markRowDirty(prevCursorRow, false);
      if (nextCursorRow !== null) state.markRowDirty(nextCursorRow, false);
      if (prevCursorVisible !== nextCursorVisible) {
        if (prevCursorRow !== null) state.markRowDirty(prevCursorRow, false);
        if (nextCursorRow !== null) state.markRowDirty(nextCursorRow, false);
      }
    }
  }

  // Update scroll state
  state.scrollState = update.scrollState;

  // Handle scrollback changes
  const scrollbackChanged = scrollbackDelta !== 0 ||
    (scrollbackDelta === 0 && isAtScrollbackLimit && oldScrollbackLength > 0);
  if (scrollbackChanged) {
    state.packedRowCache.clearScrollbackPackedCache();
  }
  if (prevViewportOffset > 0 && scrollbackChanged) {
    state.dirtyAll = true;
    if (state.terminalState) {
      state.markAllRowsDirty(state.terminalState.rows);
    }
  }

  // Handle viewport changes
  if (state.scrollState.viewportOffset !== prevViewportOffset) {
    state.dirtyAll = true;
    if (state.terminalState) {
      state.markAllRowsDirty(state.terminalState.rows);
    }
  }

  callbacks.requestRenderFrame();
}
