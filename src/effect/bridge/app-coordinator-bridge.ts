/**
 * AppCoordinator bridge functions
 * Wraps Effect AppCoordinator service for async/await usage
 */

import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../runtime"
import { AppCoordinator } from "../services"

// =============================================================================
// PTY Tracking
// =============================================================================

/**
 * Clear PTY creation tracking state.
 * Called when switching sessions to reset tracking.
 */
export async function clearPtyTracking(): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      yield* coordinator.clearPtyTracking()
    })
  )
}

/**
 * Mark a pane as having its PTY created.
 */
export async function markPtyCreated(paneId: string): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      yield* coordinator.markPtyCreated(paneId)
    })
  )
}

/**
 * Check if a pane's PTY has been created.
 */
export async function isPtyCreated(paneId: string): Promise<boolean> {
  return runEffect(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      return yield* coordinator.isPtyCreated(paneId)
    })
  )
}

// =============================================================================
// Session CWD Map
// =============================================================================

/**
 * Set the session CWD map for panes being restored.
 */
export async function setSessionCwdMap(
  cwdMap: Map<string, string>
): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      yield* coordinator.setSessionCwdMap(cwdMap)
    })
  )
}

/**
 * Get the CWD for a pane from the session CWD map.
 */
export async function getSessionCwd(
  paneId: string
): Promise<string | undefined> {
  return runEffect(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      return yield* coordinator.getSessionCwd(paneId)
    })
  )
}

/**
 * Clear the session CWD map.
 */
export async function clearSessionCwdMap(): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const coordinator = yield* AppCoordinator
      yield* coordinator.clearSessionCwdMap()
    })
  )
}
