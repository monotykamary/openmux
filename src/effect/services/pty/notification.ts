/**
 * Subscriber notification helpers for PTY service
 */

import type { TerminalScrollState, UnifiedTerminalUpdate } from "../../../core/types"
import type { InternalPtySession } from "./types"

/**
 * Get current scroll state from a session
 */
export function getCurrentScrollState(session: InternalPtySession): TerminalScrollState {
  const scrollbackLength = session.emulator.getScrollbackLength()
  return {
    viewportOffset: session.scrollState.viewportOffset,
    scrollbackLength,
    isAtBottom: session.scrollState.viewportOffset === 0,
  }
}

/**
 * Notify all terminal state subscribers
 * Unified subscribers get dirty deltas, legacy subscribers get full state
 */
export function notifySubscribers(session: InternalPtySession): void {
  // Notify unified subscribers first (uses dirty delta for efficiency)
  if (session.unifiedSubscribers.size > 0) {
    const scrollState = getCurrentScrollState(session)
    const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
    const unifiedUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: dirtyUpdate,
      scrollState,
    }
    for (const callback of session.unifiedSubscribers) {
      callback(unifiedUpdate)
    }
  }

  // Legacy subscribers still get full state
  if (session.subscribers.size > 0) {
    const state = session.emulator.getTerminalState()
    for (const callback of session.subscribers) {
      callback(state)
    }
  }
}

/**
 * Notify scroll subscribers (lightweight - no terminal state rebuild)
 */
export function notifyScrollSubscribers(session: InternalPtySession): void {
  // Notify unified subscribers with scroll-only update
  if (session.unifiedSubscribers.size > 0) {
    const scrollState = getCurrentScrollState(session)
    // For scroll-only updates, we can create a minimal dirty update
    const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
    const unifiedUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: dirtyUpdate,
      scrollState,
    }
    for (const callback of session.unifiedSubscribers) {
      callback(unifiedUpdate)
    }
  }

  // Legacy scroll subscribers
  for (const callback of session.scrollSubscribers) {
    callback()
  }
}
