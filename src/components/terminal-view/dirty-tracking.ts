/**
 * Dirty Tracking - manages dirty row tracking for partial rendering
 */
import type { RowTextCache } from './cell-rendering';
import type { PackedRowCache } from './packed-row-cache';
import { clearRowTextCache } from './buffer-management';

export interface DirtyState {
  dirtyRows: Uint8Array | null;
  dirtyAll: boolean;
}

/**
 * Mark all rows as dirty
 */
export function markAllRowsDirty(
  state: DirtyState,
  rowCount: number,
  rowTextCache: RowTextCache | null,
  packedRowCache: PackedRowCache
): void {
  if (rowCount <= 0) {
    state.dirtyRows = null;
    clearRowTextCache(rowTextCache);
    packedRowCache.clearPackedRowCache();
    return;
  }
  if (!state.dirtyRows || state.dirtyRows.length !== rowCount) {
    state.dirtyRows = new Uint8Array(rowCount);
  }
  state.dirtyRows.fill(1);
  clearRowTextCache(rowTextCache);
  packedRowCache.clearPackedRowCache();
}

/**
 * Mark a single row as dirty
 */
export function markRowDirty(
  state: DirtyState,
  rowIndex: number,
  rowTextCache: RowTextCache | null,
  packedRowCache: PackedRowCache,
  invalidateCache = true
): void {
  if (!state.dirtyRows || rowIndex < 0 || rowIndex >= state.dirtyRows.length) return;
  state.dirtyRows[rowIndex] = 1;
  if (invalidateCache) {
    clearRowTextCache(rowTextCache, rowIndex);
    packedRowCache.clearPackedRowCache(rowIndex);
  }
}

/**
 * Clear dirty flag for a row (mark as clean)
 */
export function markRowClean(state: DirtyState, rowIndex: number): void {
  if (!state.dirtyRows || rowIndex < 0 || rowIndex >= state.dirtyRows.length) return;
  state.dirtyRows[rowIndex] = 0;
}

/**
 * Check if a row is dirty
 */
export function isRowDirty(state: DirtyState, rowIndex: number): boolean {
  if (!state.dirtyRows || rowIndex < 0 || rowIndex >= state.dirtyRows.length) return true;
  return state.dirtyRows[rowIndex] === 1;
}

/**
 * Clear all dirty flags (mark all rows as clean)
 */
export function clearAllDirtyFlags(state: DirtyState): void {
  if (state.dirtyRows) {
    state.dirtyRows.fill(0);
  }
  state.dirtyAll = false;
}

/**
 * Check if full render is needed
 */
export function needsFullRender(state: DirtyState): boolean {
  return state.dirtyAll || !state.dirtyRows;
}

/**
 * Reset dirty state
 */
export function resetDirtyState(state: DirtyState): void {
  state.dirtyRows = null;
  state.dirtyAll = true;
}
