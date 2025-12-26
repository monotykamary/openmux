/**
 * App Coordinator bridge functions
 * Provides fast synchronous operations for PTY tracking and session CWD management.
 * Uses module-level state to avoid Effect runtime overhead for hot-path operations.
 */

// =============================================================================
// Module-level state for fast synchronous access
// These bypass Effect for performance-critical operations
// =============================================================================

/** Set of pane IDs that have had PTYs created (fast sync access) */
const createdPtys = new Set<string>()

/** Map of pane ID to CWD for session restoration (fast sync access) */
const sessionCwdMap = new Map<string, string>()
/** Map of pane ID to command for template restoration (fast sync access) */
const sessionCommandMap = new Map<string, string>()

/** Active session ID for shim mapping */
let activeSessionId: string | null = null

// =============================================================================
// PTY Tracking (SYNCHRONOUS for performance)
// =============================================================================

/**
 * Clear PTY creation tracking state.
 * Called when switching sessions to reset tracking.
 */
export function clearPtyTracking(): void {
  createdPtys.clear()
}

/**
 * Mark a pane as having its PTY created.
 * SYNCHRONOUS for performance - this is called in hot path during pane creation.
 */
export function markPtyCreated(paneId: string): void {
  createdPtys.add(paneId)
}

/**
 * Check if a pane's PTY has been created.
 * SYNCHRONOUS for performance - this is called in hot path during pane creation.
 */
export function isPtyCreated(paneId: string): boolean {
  return createdPtys.has(paneId)
}

// =============================================================================
// Session CWD Map (SYNCHRONOUS for performance)
// =============================================================================

/**
 * Set the session CWD map for panes being restored.
 */
export function setSessionCwdMap(cwdMap: Map<string, string>): void {
  sessionCwdMap.clear()
  for (const [key, value] of cwdMap) {
    sessionCwdMap.set(key, value)
  }
}

/**
 * Get the CWD for a pane from the session CWD map.
 * SYNCHRONOUS for performance - this is called in hot path during pane creation.
 */
export function getSessionCwd(paneId: string): string | undefined {
  return sessionCwdMap.get(paneId)
}

/**
 * Clear the session CWD map.
 */
export function clearSessionCwdMap(): void {
  sessionCwdMap.clear()
}

// =============================================================================
// Session Command Map (SYNCHRONOUS for performance)
// =============================================================================

/**
 * Set the session command map for panes being restored.
 */
export function setSessionCommandMap(commandMap: Map<string, string>): void {
  sessionCommandMap.clear()
  for (const [key, value] of commandMap) {
    sessionCommandMap.set(key, value)
  }
}

/**
 * Get the command for a pane from the session command map.
 * SYNCHRONOUS for performance - this is called in hot path during pane creation.
 */
export function getSessionCommand(paneId: string): string | undefined {
  return sessionCommandMap.get(paneId)
}

/**
 * Clear the session command map.
 */
export function clearSessionCommandMap(): void {
  sessionCommandMap.clear()
}

// =============================================================================
// Active Session Tracking (SYNCHRONOUS)
// =============================================================================

export function setActiveSessionIdForShim(sessionId: string | null): void {
  activeSessionId = sessionId
}

export function getActiveSessionIdForShim(): string | null {
  return activeSessionId
}
