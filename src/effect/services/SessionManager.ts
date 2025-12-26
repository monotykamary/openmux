/**
 * Session manager service for orchestrating session operations.
 * Compatible with legacy core/types.ts interfaces.
 */
import { Context, Effect, Layer, Ref } from "effect"
import { SessionStorage } from "./SessionStorage"
import type { SessionStorageError} from "../errors";
import { SessionNotFoundError } from "../errors"
import {
  SerializedSession,
  SessionMetadata,
} from "../models"
import type {
  SessionId} from "../types";
import {
  WorkspaceId,
  makeSessionId,
} from "../types"

// Import extracted modules
import type { SessionError, WorkspaceState } from "./session-manager/types"
import {
  createLifecycleOperations,
  createMetadataOperations,
  createActiveSessionOperations,
  createQuickSaveOperations,
} from "./session-manager"

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

      // Create operation groups using extracted factories
      const lifecycle = createLifecycleOperations({ storage, activeSessionRef })
      const metadata = createMetadataOperations({ storage })
      const activeSession = createActiveSessionOperations({ storage, activeSessionRef })
      const quickSaveOps = createQuickSaveOperations({ saveSession: lifecycle.saveSession })

      return SessionManager.of({
        createSession: lifecycle.createSession,
        loadSession: lifecycle.loadSession,
        saveSession: lifecycle.saveSession,
        deleteSession: lifecycle.deleteSession,
        listSessions: lifecycle.listSessions,
        renameSession: metadata.renameSession,
        getSessionMetadata: metadata.getSessionMetadata,
        updateAutoName: metadata.updateAutoName,
        getSessionSummary: metadata.getSessionSummary,
        getActiveSessionId: activeSession.getActiveSessionId,
        setActiveSessionId: activeSession.setActiveSessionId,
        switchToSession: activeSession.switchToSession,
        serializeWorkspaces: quickSaveOps.serializeWorkspaces,
        quickSave: quickSaveOps.quickSave,
      })
    })
  )

  /** Test layer - in-memory session storage for testing */
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

      const updateAutoName = (
        _id: SessionId,
        _cwd: string
      ): Effect.Effect<void, SessionStorageError | SessionNotFoundError> =>
        Effect.void

      const getSessionSummary = (
        id: SessionId
      ): Effect.Effect<{ workspaceCount: number; paneCount: number } | null, SessionStorageError | SessionNotFoundError> =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef)
          const session = sessions.get(id)
          if (!session) return null
          return { workspaceCount: session.workspaces.length, paneCount: 0 }
        })

      const serializeWorkspaces = (
        metadata: SessionMetadata,
        _workspaces: ReadonlyMap<number, WorkspaceState>,
        _activeWorkspaceId: number,
        _getCwd: (ptyId: string) => Promise<string>
      ): Effect.Effect<SerializedSession, never> =>
        Effect.succeed(
          SerializedSession.make({
            metadata,
            workspaces: [],
            activeWorkspaceId: WorkspaceId.make(1),
          })
        )

      const quickSave = (
        _metadata: SessionMetadata,
        _workspaces: ReadonlyMap<number, WorkspaceState>,
        _activeWorkspaceId: number,
        _getCwd: (ptyId: string) => Promise<string>
      ): Effect.Effect<void, SessionStorageError> =>
        Effect.void

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
}
