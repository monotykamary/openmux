/**
 * Active session operations for SessionManager
 * Handles getting/setting active session and switching between sessions
 */

import { Effect, Ref } from "effect"
import type { SessionStorage } from "../SessionStorage"
import { SessionNotFoundError } from "../../errors"
import {
  SerializedSession,
  SessionMetadata,
  SessionIndex,
} from "../../models"
import { SessionId } from "../../types"

export interface ActiveSessionDeps {
  storage: SessionStorage["Type"]
  activeSessionRef: Ref.Ref<SessionId | null>
}

/**
 * Create active session operations for SessionManager
 */
export function createActiveSessionOperations(deps: ActiveSessionDeps) {
  const { storage, activeSessionRef } = deps

  const getActiveSessionId = Effect.fn(
    "SessionManager.getActiveSessionId"
  )(function* () {
    return yield* Ref.get(activeSessionRef)
  })

  const setActiveSessionId = Effect.fn(
    "SessionManager.setActiveSessionId"
  )(function* (id: SessionId | null) {
    yield* Ref.set(activeSessionRef, id)

    // Update index
    const currentIndex = yield* storage.loadIndex()
    yield* storage.saveIndex(
      SessionIndex.make({
        sessions: currentIndex.sessions,
        activeSessionId: id,
      })
    )
  })

  const switchToSession = Effect.fn("SessionManager.switchToSession")(
    function* (id: SessionId) {
      const currentIndex = yield* storage.loadIndex()
      const session = currentIndex.sessions.find((s) => s.id === id)

      if (!session) {
        return yield* SessionNotFoundError.make({ sessionId: id })
      }

      // Update lastSwitchedAt
      const now = Date.now()
      const updatedMetadata = SessionMetadata.make({
        ...session,
        lastSwitchedAt: now,
      })

      const updatedSessions = currentIndex.sessions.map((s) =>
        s.id === id ? updatedMetadata : s
      )

      yield* storage.saveIndex(
        SessionIndex.make({
          sessions: updatedSessions,
          activeSessionId: id,
        })
      )

      // Update session file too
      const sessionData = yield* storage.loadSession(id)
      yield* storage.saveSession(
        SerializedSession.make({
          ...sessionData,
          metadata: updatedMetadata,
        })
      )

      yield* Ref.set(activeSessionRef, id)
    }
  )

  return {
    getActiveSessionId,
    setActiveSessionId,
    switchToSession,
  }
}
