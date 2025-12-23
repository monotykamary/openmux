/**
 * Bridge module for gradual migration to Effect services.
 * Provides simple async functions backed by Effect services.
 *
 * Use these functions in existing code to migrate to Effect
 * without changing the entire callsite at once.
 */

// Clipboard operations
export { copyToClipboard, readFromClipboard } from "./clipboard-bridge"

// PTY operations
export {
  createPtySession,
  writeToPty,
  resizePty,
  getPtyCwd,
  destroyPty,
  destroyAllPtys,
  getTerminalState,
  onPtyExit,
  setPanePosition,
  getScrollState,
  setScrollOffset,
  scrollToBottom,
  subscribeToPty,
  subscribeToScroll,
  subscribeUnifiedToPty,
  getScrollbackLine,
  prefetchScrollbackLines,
  getEmulator,
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  getPtyTitle,
  type PtyLifecycleEvent,
  type PtyTitleChangeEvent,
} from "./pty-bridge"

// Session operations
export {
  listSessions,
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  renameSession,
  getActiveSessionId,
  setActiveSessionId,
  switchToSession,
  getSessionMetadata,
  updateAutoName,
  getSessionSummary,
  // Legacy compatibility
  createSessionLegacy,
  listSessionsLegacy,
  getActiveSessionIdLegacy,
  renameSessionLegacy,
  deleteSessionLegacy,
  // Session serialization
  saveCurrentSession,
  loadSessionData,
} from "./session-bridge"

// Aggregate view operations
export { listAllPtysWithMetadata, getPtyMetadata, type ListAllPtysOptions } from "./aggregate-bridge"

// Terminal color operations
export { getHostBackgroundColor, getHostForegroundColor } from "./color-bridge"
export {
  registerPtyPane,
  getSessionPtyMapping,
  onShimDetached,
  shutdownShim,
  waitForShimClient,
} from "./shim-bridge"

// Keyboard router operations
export {
  type KeyEvent,
  type KeyHandler,
  type OverlayType,
  registerKeyboardHandler,
  routeKeyboardEvent,
  routeKeyboardEventSync,
  getActiveOverlay,
  hasKeyboardHandler,
} from "./keyboard-router-bridge"

// App coordinator operations
export {
  clearPtyTracking,
  markPtyCreated,
  isPtyCreated,
  setSessionCwdMap,
  getSessionCwd,
  clearSessionCwdMap,
  setActiveSessionIdForShim,
  getActiveSessionIdForShim,
} from "./app-coordinator-bridge"
