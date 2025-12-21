export {
  createPtySession,
  destroyPty,
  destroyAllPtys,
  onPtyExit,
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  getPtyTitle,
  type PtyLifecycleEvent,
  type PtyTitleChangeEvent,
} from './pty-bridge/lifecycle'

export {
  writeToPty,
  resizePty,
  setPanePosition,
  getPtyCwd,
} from './pty-bridge/io'

export {
  getScrollState,
  setScrollOffset,
  scrollToBottom,
  subscribeToScroll,
} from './pty-bridge/scroll'

export {
  getTerminalState,
  subscribeToPty,
  subscribeUnifiedToPty,
  getScrollbackLine,
  prefetchScrollbackLines,
  getEmulator,
} from './pty-bridge/state'
