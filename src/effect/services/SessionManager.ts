/**
 * Session manager service for orchestrating session operations.
 * Compatible with legacy core/types.ts interfaces.
 */
import { Context, Effect, Layer, Ref } from "effect"
import { SessionStorage } from "./SessionStorage"
import { SessionStorageError, SessionNotFoundError } from "../errors"
import {
  SerializedSession,
  SessionMetadata,
  SessionIndex,
} from "../models"
import {
  SessionId,
  WorkspaceId,
  makeSessionId,
} from "../types"

// Import extracted modules
import type { SessionError, WorkspaceState } from "./session-manager/types"
import {
  getAutoName,
  collectCwdMap,
  serializeSession,
} from "./session-manager/serialization"

// =============================================================================
// SessionManager Service
// =============================================================================

export class SessionManager extends Context.Tag("@openmux/SessionManager")<
  SessionManager,
  {
    /** Create a new session */
    readonly createSession: (name?: string) => Effect.Effect<SessionMetadata, SessionStorageError>

    /** Load a session by ID */
    readonly loadSession: (
      id: SessionId
    ) => Effect.Effect<SerializedSession, SessionError>

    /** Save the current session state */
    readonly saveSession: (
      session: SerializedSession
    ) => Effect.Effect<void, SessionStorageError>

    /** Delete a session */
    readonly deleteSession: (
      id: SessionId
    ) => Effect.Effect<void, SessionStorageError>

    /** Rename a session */
    readonly renameSession: (
      id: SessionId,
      newName: string
    ) => Effect.Effect<void, SessionError>

    /** List all sessions sorted by lastSwitchedAt (most recent first) */
    readonly listSessions: () => Effect.Effect<
      readonly SessionMetadata[],
      SessionStorageError
    >

    /** Get the active session ID */
    readonly getActiveSessionId: () => Effect.Effect<SessionId | null>

    /** Set the active session ID */
    readonly setActiveSessionId: (
      id: SessionId | null
    ) => Effect.Effect<void, SessionStorageError>

    /** Switch to a session (updates lastSwitchedAt) */
    readonly switchToSession: (
      id: SessionId
    ) => Effect.Effect<void, SessionError>

    /** Get session metadata by ID */
    readonly getSessionMetadata: (
      id: SessionId
    ) => Effect.Effect<SessionMetadata | null, SessionStorageError>

    /** Update auto-name for a session based on cwd */
    readonly updateAutoName: (
      id: SessionId,
      cwd: string
    ) => Effect.Effect<void, SessionError>

    /** Get session summary (workspace/pane counts) */
    readonly getSessionSummary: (
      id: SessionId
    ) => Effect.Effect<{ workspaceCount: number; paneCount: number } | null, SessionError>

    /** Serialize workspaces to session format */
    readonly serializeWorkspaces: (
      metadata: SessionMetadata,
      workspaces: ReadonlyMap<number, WorkspaceState>,
      activeWorkspaceId: number,
      getCwd: (ptyId: string) => Promise<string>
    ) => Effect.Effect<SerializedSession, never>

    /** Quick save - serialize and save current state */
    readonly quickSave: (
      metadata: SessionMetadata,
      workspaces: ReadonlyMap<number, WorkspaceState>,
      activeWorkspaceId: number,
      getCwd: (ptyId: string) => Promise<string>
    ) => Effect.Effect<void, SessionStorageError>
  }
>() {
  /** Production layer */
  static readonly layer = Layer.effect(
    SessionManager,
    Effect.gen(function* () {
      const storage = yield* SessionStorage

      // Track active session
      const activeSessionRef = yield* Ref.make<SessionId | null>(null)

      // Initialize active session from index
      const index = yield* storage.loadIndex()
      if (index.activeSessionId) {
        yield* Ref.set(activeSessionRef, index.activeSessionId)
      }

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

      const renameSession = Effect.fn("SessionManager.renameSession")(
        function* (id: SessionId, newName: string) {
          // Load and update session
          const session = yield* storage.loadSession(id)
          const updatedMetadata = SessionMetadata.make({
            ...session.metadata,
            name: newName,
            autoNamed: false,
          })
          const updated = SerializedSession.make({
            ...session,
            metadata: updatedMetadata,
          })

          yield* storage.saveSession(updated)

          // Update index
          const currentIndex = yield* storage.loadIndex()
          const updatedSessions = currentIndex.sessions.map((s) =>
            s.id === id ? updatedMetadata : s
          )

          yield* storage.saveIndex(
            SessionIndex.make({
              sessions: updatedSessions,
              activeSessionId: currentIndex.activeSessionId,
            })
          )
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

      const getSessionMetadata = Effect.fn("SessionManager.getSessionMetadata")(
        function* (id: SessionId) {
          const index = yield* storage.loadIndex()
          return index.sessions.find((s) => s.id === id) ?? null
        }
      )

      const updateAutoName = Effect.fn("SessionManager.updateAutoName")(
        function* (id: SessionId, cwd: string) {
          const index = yield* storage.loadIndex()
          const session = index.sessions.find((s) => s.id === id)

          if (session && session.autoNamed) {
            const newName = getAutoName(cwd)
            if (newName !== session.name) {
              const updated = SessionMetadata.make({ ...session, name: newName })
              const updatedSessions = index.sessions.map((s) =>
                s.id === id ? updated : s
              )
              yield* storage.saveIndex(
                SessionIndex.make({
                  sessions: updatedSessions,
                  activeSessionId: index.activeSessionId,
                })
              )
            }
          }
        }
      )

      const getSessionSummary = Effect.fn("SessionManager.getSessionSummary")(
        function* (id: SessionId) {
          const exists = yield* storage.sessionExists(id)
          if (!exists) return null

          const session = yield* storage.loadSession(id).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )
          if (!session) return null

          let paneCount = 0
          let workspaceCount = 0

          for (const ws of session.workspaces) {
            if (ws.mainPane || ws.stackPanes.length > 0) {
              workspaceCount++
              if (ws.mainPane) paneCount++
              paneCount += ws.stackPanes.length
            }
          }

          return { workspaceCount, paneCount }
        }
      )

      const serializeWorkspaces = Effect.fn(
        "SessionManager.serializeWorkspaces"
      )(function* (
        metadata: SessionMetadata,
        workspaces: ReadonlyMap<number, WorkspaceState>,
        activeWorkspaceId: number,
        getCwd: (ptyId: string) => Promise<string>
      ) {
        // Collect all CWDs using extracted helper
        const cwdMap = yield* collectCwdMap(workspaces, getCwd)
        // Serialize using extracted helper
        return serializeSession(metadata, workspaces, activeWorkspaceId, cwdMap)
      })

      const quickSave = Effect.fn("SessionManager.quickSave")(function* (
        metadata: SessionMetadata,
        workspaces: ReadonlyMap<number, WorkspaceState>,
        activeWorkspaceId: number,
        getCwd: (ptyId: string) => Promise<string>
      ) {
        const session = yield* serializeWorkspaces(
          metadata,
          workspaces,
          activeWorkspaceId,
          getCwd
        )
        yield* saveSession(session)
      })

      return SessionManager.of({
        createSession,
        loadSession,
        saveSession,
        deleteSession,
        renameSession,
        listSessions,
        getActiveSessionId,
        setActiveSessionId,
        switchToSession,
        getSessionMetadata,
        updateAutoName,
        getSessionSummary,
        serializeWorkspaces,
        quickSave,
      })
    })
  )

  /** Test layer */
  static readonly testLayer = Layer.effect(
    SessionManager,
    Effect.gen(function* () {
      const sessionsRef = yield* Ref.make(new Map<SessionId, SerializedSession>())
      const activeRef = yield* Ref.make<SessionId | null>(null)

      const createSession = Effect.fn("SessionManager.createSession")(
        function* (name?: string) {
          const id = makeSessionId()
          const now = Date.now()

          const metadata = SessionMetadata.make({
            id,
            name: name ?? "test-session",
            createdAt: now,
            lastSwitchedAt: now,
            autoNamed: !name,
          })

          const session = SerializedSession.make({
            metadata,
            workspaces: [],
            activeWorkspaceId: WorkspaceId.make(1),
          })

          yield* Ref.update(sessionsRef, (map) => {
            const newMap = new Map(map)
            newMap.set(id, session)
            return newMap
          })

          yield* Ref.set(activeRef, id)
          return metadata
        }
      )

      const loadSession = Effect.fn("SessionManager.loadSession")(function* (
        id: SessionId
      ) {
        const sessions = yield* Ref.get(sessionsRef)
        const session = sessions.get(id)
        if (!session) {
          return yield* SessionNotFoundError.make({ sessionId: id })
        }
        return session
      })

      const saveSession = Effect.fn("SessionManager.saveSession")(function* (
        session: SerializedSession
      ) {
        yield* Ref.update(sessionsRef, (map) => {
          const newMap = new Map(map)
          newMap.set(session.metadata.id, session)
          return newMap
        })
      })

      const deleteSession = Effect.fn("SessionManager.deleteSession")(
        function* (id: SessionId) {
          yield* Ref.update(sessionsRef, (map) => {
            const newMap = new Map(map)
            newMap.delete(id)
            return newMap
          })
        }
      )

      const renameSession = Effect.fn("SessionManager.renameSession")(
        function* (id: SessionId, newName: string) {
          const sessions = yield* Ref.get(sessionsRef)
          const session = sessions.get(id)
          if (!session) {
            return yield* SessionNotFoundError.make({ sessionId: id })
          }

          const updated = SerializedSession.make({
            ...session,
            metadata: SessionMetadata.make({
              ...session.metadata,
              name: newName,
              autoNamed: false,
            }),
          })

          yield* Ref.update(sessionsRef, (map) => {
            const newMap = new Map(map)
            newMap.set(id, updated)
            return newMap
          })
        }
      )

      const listSessions = Effect.fn("SessionManager.listSessions")(
        function* () {
          const sessions = yield* Ref.get(sessionsRef)
          return Array.from(sessions.values())
            .map((s) => s.metadata)
            .sort((a, b) => b.lastSwitchedAt - a.lastSwitchedAt)
        }
      )

      const getActiveSessionId = Effect.fn(
        "SessionManager.getActiveSessionId"
      )(function* () {
        return yield* Ref.get(activeRef)
      })

      const setActiveSessionId = Effect.fn(
        "SessionManager.setActiveSessionId"
      )(function* (id: SessionId | null) {
        yield* Ref.set(activeRef, id)
      })

      const switchToSession = Effect.fn("SessionManager.switchToSession")(
        function* (id: SessionId) {
          const sessions = yield* Ref.get(sessionsRef)
          const session = sessions.get(id)
          if (!session) {
            return yield* SessionNotFoundError.make({ sessionId: id })
          }
          yield* Ref.set(activeRef, id)
        }
      )

      const getSessionMetadata = Effect.fn("SessionManager.getSessionMetadata")(
        function* (id: SessionId) {
          const sessions = yield* Ref.get(sessionsRef)
          const session = sessions.get(id)
          return session?.metadata ?? null
        }
      )

      const updateAutoName = Effect.fn("SessionManager.updateAutoName")(
        function* (_id: SessionId, _cwd: string) {
          // No-op in test
        }
      )

      const getSessionSummary = Effect.fn("SessionManager.getSessionSummary")(
        function* (id: SessionId) {
          const sessions = yield* Ref.get(sessionsRef)
          const session = sessions.get(id)
          if (!session) return null
          return { workspaceCount: session.workspaces.length, paneCount: 0 }
        }
      )

      const serializeWorkspaces = Effect.fn(
        "SessionManager.serializeWorkspaces"
      )(function* (metadata: SessionMetadata) {
        return SerializedSession.make({
          metadata,
          workspaces: [],
          activeWorkspaceId: WorkspaceId.make(1),
        })
      })

      const quickSave = Effect.fn("SessionManager.quickSave")(function* () {
        // No-op in test
      })

      return SessionManager.of({
        createSession,
        loadSession,
        saveSession,
        deleteSession,
        renameSession,
        listSessions,
        getActiveSessionId,
        setActiveSessionId,
        switchToSession,
        getSessionMetadata,
        updateAutoName: updateAutoName as any,
        getSessionSummary: getSessionSummary as any,
        serializeWorkspaces: serializeWorkspaces as any,
        quickSave: quickSave as any,
      })
    })
  )
}
