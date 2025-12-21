/**
 * Prefetch Manager - handles scrollback line prefetching for smooth scrolling
 */
import type { TerminalState, TerminalScrollState, PackedRowUpdate } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { MissingRowBuffer, PrefetchRequest } from './row-fetching';
import type { PackedRowCache } from './packed-row-cache';
import type { DirtyState } from './dirty-tracking';
import { markRowDirty, markAllRowsDirty } from './dirty-tracking';
import type { RowTextCache } from './cell-rendering';

export interface MissingRowSnapshot {
  viewportOffset: number;
  scrollbackLength: number;
  rows: number;
  count: number;
  rowIndices: Int32Array;
  offsets: Int32Array;
}

export interface PrefetchState {
  pendingPrefetch: PrefetchRequest | null;
  pendingMissingRows: MissingRowSnapshot | null;
  prefetchInProgress: boolean;
  prefetchScheduled: boolean;
}

/**
 * Create initial prefetch state
 */
export function createPrefetchState(): PrefetchState {
  return {
    pendingPrefetch: null,
    pendingMissingRows: null,
    prefetchInProgress: false,
    prefetchScheduled: false,
  };
}

/**
 * Reset prefetch state
 */
export function resetPrefetchState(state: PrefetchState): void {
  state.pendingPrefetch = null;
  state.pendingMissingRows = null;
  state.prefetchInProgress = false;
  state.prefetchScheduled = false;
}

/**
 * Create a snapshot of missing rows for later verification
 */
export function snapshotMissingRows(
  buffer: MissingRowBuffer | null,
  viewportOffset: number,
  scrollbackLength: number,
  rows: number
): MissingRowSnapshot | null {
  if (!buffer || buffer.count === 0) return null;
  const count = buffer.count;
  return {
    viewportOffset,
    scrollbackLength,
    rows,
    count,
    rowIndices: buffer.rowIndices.slice(0, count),
    offsets: buffer.offsets.slice(0, count),
  };
}

export interface ApplyPrefetchContext {
  terminalState: TerminalState | null;
  scrollState: TerminalScrollState;
  emulator: ITerminalEmulator | null;
  dirtyState: DirtyState;
  rowTextCache: RowTextCache | null;
  packedRowCache: PackedRowCache;
  transitionCache: Map<number, import('../../core/types').TerminalCell[]>;
}

/**
 * Apply prefetch snapshot and mark affected rows as dirty
 * Returns true if any rows were marked dirty
 */
export function applyPrefetchSnapshot(
  snapshot: MissingRowSnapshot | null,
  ctx: ApplyPrefetchContext
): boolean {
  const { terminalState, scrollState, emulator, dirtyState, rowTextCache, packedRowCache, transitionCache } = ctx;

  if (!snapshot || !terminalState) {
    dirtyState.dirtyAll = true;
    if (rowTextCache) rowTextCache.fill(null);
    return true;
  }

  if (
    scrollState.viewportOffset !== snapshot.viewportOffset ||
    scrollState.scrollbackLength !== snapshot.scrollbackLength ||
    terminalState.rows !== snapshot.rows
  ) {
    dirtyState.dirtyAll = true;
    markAllRowsDirty(dirtyState, terminalState.rows, rowTextCache, packedRowCache);
    return true;
  }

  if (!dirtyState.dirtyRows) {
    dirtyState.dirtyAll = true;
    markAllRowsDirty(dirtyState, terminalState.rows, rowTextCache, packedRowCache);
    return true;
  }

  let marked = false;
  for (let i = 0; i < snapshot.count; i++) {
    const rowIndex = snapshot.rowIndices[i];
    const offset = snapshot.offsets[i];

    // Try to get packed line first
    const packedGetter = emulator
      ? (emulator as { getScrollbackLinePacked?: (line: number) => PackedRowUpdate | null }).getScrollbackLinePacked
      : undefined;
    const packed = packedGetter ? packedGetter.call(emulator, offset) : null;

    if (packed && terminalState && packed.cols === terminalState.cols) {
      packedRowCache.ensureScrollbackPackedCache(terminalState.cols);
      packedRowCache.cacheScrollbackPackedRows(packed);
      markRowDirty(dirtyState, rowIndex, rowTextCache, packedRowCache);
      marked = true;
      continue;
    }

    // Fall back to cell line
    const line = emulator?.getScrollbackLine(offset) ?? transitionCache.get(offset) ?? null;
    if (line) {
      markRowDirty(dirtyState, rowIndex, rowTextCache, packedRowCache);
      marked = true;
    }
  }

  return marked;
}

export interface SchedulePrefetchOptions {
  prefetchRequest: PrefetchRequest | null;
  missingRows: MissingRowBuffer | null;
  viewportOffset: number;
  scrollbackLength: number;
  rows: number;
  executePrefetchFn: (() => void) | null;
}

/**
 * Schedule a prefetch if needed
 */
export function schedulePrefetch(
  state: PrefetchState,
  options: SchedulePrefetchOptions
): void {
  const { prefetchRequest, missingRows, viewportOffset, scrollbackLength, rows, executePrefetchFn } = options;

  if (prefetchRequest && !state.prefetchInProgress && executePrefetchFn) {
    state.pendingPrefetch = prefetchRequest;
    state.pendingMissingRows = snapshotMissingRows(missingRows, viewportOffset, scrollbackLength, rows);

    // Execute prefetch asynchronously (don't block render)
    if (!state.prefetchScheduled) {
      state.prefetchScheduled = true;
      queueMicrotask(() => {
        state.prefetchScheduled = false;
        executePrefetchFn();
      });
    }
  } else {
    state.pendingMissingRows = null;
  }
}
