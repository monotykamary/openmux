/**
 * AppCoordinator service
 * Replaces globalThis state coordination patterns
 */

import { Context, Effect, Layer, Ref } from "effect"

// =============================================================================
// Service Definition
// =============================================================================

export class AppCoordinator extends Context.Tag("@openmux/AppCoordinator")<
  AppCoordinator,
  {
    // =========================================================================
    // PTY Tracking
    // =========================================================================

    /**
     * Clear PTY creation tracking state.
     * Called when switching sessions to reset tracking.
     */
    readonly clearPtyTracking: () => Effect.Effect<void>

    /**
     * Mark a pane as having its PTY created.
     */
    readonly markPtyCreated: (paneId: string) => Effect.Effect<void>

    /**
     * Check if a pane's PTY has been created.
     */
    readonly isPtyCreated: (paneId: string) => Effect.Effect<boolean>

    // =========================================================================
    // Session CWD Map
    // =========================================================================

    /**
     * Set the session CWD map for panes being restored.
     * This stores CWDs for panes that haven't had PTYs created yet.
     */
    readonly setSessionCwdMap: (
      cwdMap: Map<string, string>
    ) => Effect.Effect<void>

    /**
     * Get the CWD for a pane from the session CWD map.
     */
    readonly getSessionCwd: (
      paneId: string
    ) => Effect.Effect<string | undefined>

    /**
     * Clear the session CWD map.
     */
    readonly clearSessionCwdMap: () => Effect.Effect<void>
  }
>() {
  static readonly layer = Layer.effect(
    AppCoordinator,
    Effect.gen(function* () {
      // Set of pane IDs that have had PTYs created
      const createdPtysRef = yield* Ref.make<Set<string>>(new Set())

      // Map of pane ID to CWD for session restoration
      const sessionCwdMapRef = yield* Ref.make<Map<string, string>>(new Map())

      // PTY Tracking
      const clearPtyTracking = Effect.fn("AppCoordinator.clearPtyTracking")(
        function* () {
          yield* Ref.set(createdPtysRef, new Set())
        }
      )

      const markPtyCreated = Effect.fn("AppCoordinator.markPtyCreated")(
        function* (paneId: string) {
          yield* Ref.update(createdPtysRef, (set) => {
            const newSet = new Set(set)
            newSet.add(paneId)
            return newSet
          })
        }
      )

      const isPtyCreated = Effect.fn("AppCoordinator.isPtyCreated")(
        function* (paneId: string) {
          const set = yield* Ref.get(createdPtysRef)
          return set.has(paneId)
        }
      )

      // Session CWD Map
      const setSessionCwdMap = Effect.fn("AppCoordinator.setSessionCwdMap")(
        function* (cwdMap: Map<string, string>) {
          yield* Ref.set(sessionCwdMapRef, cwdMap)
        }
      )

      const getSessionCwd = Effect.fn("AppCoordinator.getSessionCwd")(
        function* (paneId: string) {
          const map = yield* Ref.get(sessionCwdMapRef)
          return map.get(paneId)
        }
      )

      const clearSessionCwdMap = Effect.fn("AppCoordinator.clearSessionCwdMap")(
        function* () {
          yield* Ref.set(sessionCwdMapRef, new Map())
        }
      )

      return AppCoordinator.of({
        clearPtyTracking,
        markPtyCreated,
        isPtyCreated,
        setSessionCwdMap,
        getSessionCwd,
        clearSessionCwdMap,
      })
    })
  )
}
