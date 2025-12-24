/**
 * Emulator utilities shared by local and remote backends.
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
