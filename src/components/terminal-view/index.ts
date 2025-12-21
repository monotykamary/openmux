/**
 * Terminal View module
 * Re-exports all terminal view utilities
 */

export {
  getCellColors,
  packRowForBatch,
  drawPackedRowBatch,
  renderRow,
  PACKED_CELL_BYTE_STRIDE,
  type CellRenderingDeps,
  type CellRenderingOptions,
  type PackedRowBuffer,
  type PackedRowBatchBuffer,
  type RowTextCache,
  type RowRenderCache,
} from './cell-rendering'

export {
  renderScrollbar,
  type ScrollbarOptions,
} from './scrollbar'

export {
  fetchRowsForRendering,
  calculatePrefetchRequest,
  updateTransitionCache,
  type RowFetchingOptions,
  type RowFetchResult,
  type MissingRowBuffer,
  type PrefetchRequest,
} from './row-fetching'

export {
  ensureFrameBuffer,
  ensurePackedRowBuffer,
  ensurePackedRowBatchBuffer,
  ensureRowTextCache,
  ensureMissingRowsBuffer,
  clearRowTextCache,
  cleanupBuffers,
  type FrameBufferState,
  type PackedBufferState,
  type CacheState,
} from './buffer-management'

export {
  markAllRowsDirty,
  markRowDirty,
  markRowClean,
  isRowDirty,
  clearAllDirtyFlags,
  needsFullRender,
  resetDirtyState,
  type DirtyState,
} from './dirty-tracking'

export {
  createPrefetchState,
  resetPrefetchState,
  snapshotMissingRows,
  applyPrefetchSnapshot,
  schedulePrefetch,
  type PrefetchState,
  type ApplyPrefetchContext,
  type SchedulePrefetchOptions,
} from './prefetch-manager'

export {
  drawHighlightedCell,
  drawCursorCell,
  drawRowHighlights,
  rowNeedsHighlights,
  hasRowHighlights,
  type HighlightTarget,
  type HighlightRanges,
  type HighlightColors,
} from './highlight-rendering'

export {
  TerminalViewState,
  type MissingRowSnapshot,
} from './terminal-view-state'

export {
  renderTerminal,
  type RenderContext,
  type RenderDeps,
  type SearchState,
} from './terminal-renderer'

export {
  setupPtySubscription,
  type PtySubscriptionCallbacks,
  type PtySubscriptionResult,
} from './pty-subscription'
