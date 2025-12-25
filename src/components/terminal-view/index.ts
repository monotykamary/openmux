/**
 * Terminal View module
 * Re-exports all terminal view utilities
 */

export {
  getCellColors,
  renderRow,
  type CellRenderingDeps,
  type CellRenderingOptions,
} from './cell-rendering'

export {
  renderScrollbar,
  type ScrollbarOptions,
} from './scrollbar'

export {
  fetchRowsForRendering,
  calculatePrefetchRequest,
  type RowFetchingOptions,
  type RowFetchResult,
  type PrefetchRequest,
} from './row-fetching'

export {
  guardScrollbackRender,
  type ScrollbackGuardOptions,
  type ScrollbackGuardResult,
} from './scrollback-guard'
