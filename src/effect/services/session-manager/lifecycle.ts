/**
 * Session lifecycle operations for SessionManager
 * Handles create, load, save, and delete operations
 */

import { Effect, Ref } from "effect"
import type { SessionStorage } from "../SessionStorage"
import { SessionStorageError } from "../../errors"
import {
  SerializedSession,
  SessionMetadata,
  SessionIndex,
} from "../../models"
import { SessionId, WorkspaceId, makeSessionId } from "../../types"
import { getAutoName } from "./serialization"

export interface LifecycleDeps {
  storage: SessionStorage["Type"]
  activeSessionRef: Ref.Ref<SessionId | null>
}

/**
 * Create lifecycle operations for SessionManager
 */
export function createLifecycleOperations(deps: LifecycleDeps) {
  const { storage, activeSessionRef } = deps

  const createSession = Effect.fn("SessionManager.createSession")(
    function* (name?: string) {
      const id = makeSessionId()
      const now = Date.now()

      const metadata = SessionMetadata.make({
        id,
        name: name ?? getAutoName(process.cwd()),
        createdAt: now,
        lastSwitchedAt: now,
        autoNamed: !name,
      })

      // Create empty session
      const session = SerializedSession.make({
        metadata,
        workspaces: [],
        activeWorkspaceId: WorkspaceId.make(1),
      })

      // Save session file
      yield* storage.saveSession(session)

      // Update index
      const currentIndex = yield* storage.loadIndex()
      yield* storage.saveIndex(
        SessionIndex.make({
          sessions: [...currentIndex.sessions, metadata],
          activeSessionId: id,
        })
      )

      // Set as active
      yield* Ref.set(activeSessionRef, id)

      return metadata
    }
  )

  const loadSession = Effect.fn("SessionManager.loadSession")(function* (
    id: SessionId
  ) {
    return yield* storage.loadSession(id)
  })

  const saveSession = Effect.fn("SessionManager.saveSession")(function* (
    session: SerializedSession
  ) {
    yield* storage.saveSession(session)

    // Update index
    const currentIndex = yield* storage.loadIndex()
    const existingIdx = currentIndex.sessions.findIndex(
      (s) => s.id === session.metadata.id
    )

    const sessions =
      existingIdx >= 0
        ? currentIndex.sessions.map((s, i) =>
            i === existingIdx ? session.metadata : s
          )
        : [...currentIndex.sessions, session.metadata]

    yield* storage.saveIndex(
      SessionIndex.make({
        sessions,
        activeSessionId: currentIndex.activeSessionId,
      })
    )
  })

  const deleteSession = Effect.fn("SessionManager.deleteSession")(
    function* (id: SessionId) {
      // Delete session file
      yield* storage.deleteSession(id)

      // Update index
      const currentIndex = yield* storage.loadIndex()
      const filteredSessions = currentIndex.sessions.filter(
        (s) => s.id !== id
      )

      // If deleting active session, switch to another
      const newActiveId =
        currentIndex.activeSessionId === id
          ? filteredSessions[0]?.id ?? null
          : currentIndex.activeSessionId

      yield* storage.saveIndex(
        SessionIndex.make({
          sessions: filteredSessions,
          activeSessionId: newActiveId,
        })
      )

      // Update ref if needed
      const currentActive = yield* Ref.get(activeSessionRef)
      if (currentActive === id) {
        yield* Ref.set(activeSessionRef, newActiveId)
      }
    }
  )

  const listSessions = Effect.fn("SessionManager.listSessions")(
    function* () {
      const sessions = yield* storage.listSessions()
      // Sort by lastSwitchedAt (most recent first)
      return [...sessions].sort(
        (a, b) => b.lastSwitchedAt - a.lastSwitchedAt
      )
    }
  )

  return {
    createSession,
    loadSession,
    saveSession,
    deleteSession,
    listSessions,
  }
}
