/**
 * Worker Emulator module
 * Re-exports all worker emulator utilities
 */

export {
  ScrollbackCache,
  shouldClearCacheOnUpdate,
} from './scrollback-cache'

export {
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from './state-factory'

export {
  handleTerminalUpdate,
  clearAllCaches,
  clearUpdateHandlerState,
  type UpdateHandlerState,
  type UpdateCallbacks,
} from './update-handler'

export {
  getScrollbackLine,
  getScrollbackLinePacked,
  getLine,
  getScrollbackLineAsync,
  prefetchScrollbackLines,
  type ScrollbackState,
} from './scrollback'

export {
  getDirtyUpdate,
  getTerminalState,
  type TerminalStateState,
} from './state'

export {
  applyPackedRowsToLiveCache,
  applyPackedRowsToScrollbackCache,
  decodePackedRow,
  type LivePackedState,
  type ScrollbackPackedState,
} from './packed-rows'
