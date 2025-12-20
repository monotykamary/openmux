/**
 * Terminal View module
 * Re-exports all terminal view utilities
 */

export {
  getCellColors,
  renderRow,
  PACKED_CELL_BYTE_STRIDE,
  type CellRenderingDeps,
  type CellRenderingOptions,
  type PackedRowBuffer,
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
