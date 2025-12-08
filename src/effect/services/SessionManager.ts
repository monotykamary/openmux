/**
 * Session manager service for orchestrating session operations.
 */
import { Context, Effect, Layer, Ref } from "effect"
import { SessionStorage } from "./SessionStorage"
import { Pty } from "./Pty"
import {
  SessionStorageError,
  SessionNotFoundError,
  SessionCorruptedError,
} from "../errors"
import {
  SerializedSession,
  SerializedWorkspace,
  SerializedPaneData,
  SessionMetadata,
  SessionIndex,
} from "../models"
import {
  SessionId,
  WorkspaceId,
  PtyId,
  makeSessionId,
} from "../types"

// =============================================================================
// Types
// =============================================================================

type SessionError =
  | SessionStorageError
  | SessionNotFoundError
  | SessionCorruptedError

// =============================================================================
// SessionManager Service
// =============================================================================

export class SessionManager extends Context.Tag("@openmux/SessionManager")<
  SessionManager,
  {
    /** Create a new session */
    readonly createSession: (name: string) => Effect.Effect<SessionId, SessionStorageError>

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

    /** List all sessions */
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

    /** Serialize workspaces to session format */
    readonly serializeWorkspaces: (
      workspaces: ReadonlyMap<number, WorkspaceState>,
      activeWorkspaceId: number,
      getCwd: (ptyId: string) => Promise<string>
    ) => Effect.Effect<SerializedSession, SessionStorageError>

    /** Quick save - serialize and save current state */
    readonly quickSave: (
      sessionId: SessionId,
      name: string,
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
      const pty = yield* Pty

      // Track active session
      const activeSessionRef = yield* Ref.make<SessionId | null>(null)

      // Initialize active session from index
      const index = yield* storage.loadIndex()
      if (index.activeSessionId) {
        yield* Ref.set(activeSessionRef, index.activeSessionId)
      }

      const createSession = Effect.fn("SessionManager.createSession")(
        function* (name: string) {
          const id = makeSessionId()
          const now = new Date()

          // Create empty session
          const session = SerializedSession.make({
            id,
            name,
            workspaces: [],
            activeWorkspaceId: WorkspaceId.make(1),
            createdAt: now,
            updatedAt: now,
          })

          // Save session file
          yield* storage.saveSession(session)

          // Update index
          const currentIndex = yield* storage.loadIndex()
          const metadata = SessionMetadata.make({
            id,
            name,
            createdAt: now,
            updatedAt: now,
          })

          yield* storage.saveIndex(
            SessionIndex.make({
              sessions: [...currentIndex.sessions, metadata],
              activeSessionId: id,
            })
          )

          // Set as active
          yield* Ref.set(activeSessionRef, id)

          return id
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
        // Update the session with new timestamp
        const updated = SerializedSession.make({
          ...session,
          updatedAt: new Date(),
        })

        yield* storage.saveSession(updated)

        // Update index timestamp
        const currentIndex = yield* storage.loadIndex()
        const updatedSessions = currentIndex.sessions.map((s) =>
          s.id === session.id
            ? SessionMetadata.make({ ...s, updatedAt: updated.updatedAt })
            : s
        )

        yield* storage.saveIndex(
          SessionIndex.make({
            sessions: updatedSessions,
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

          // If deleting active session, clear it
          const newActiveId =
            currentIndex.activeSessionId === id
              ? null
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
            yield* Ref.set(activeSessionRef, null)
          }
        }
      )

      const renameSession = Effect.fn("SessionManager.renameSession")(
        function* (id: SessionId, newName: string) {
          // Load and update session
          const session = yield* storage.loadSession(id)
          const updated = SerializedSession.make({
            ...session,
            name: newName,
            updatedAt: new Date(),
          })

          yield* storage.saveSession(updated)

          // Update index
          const currentIndex = yield* storage.loadIndex()
          const updatedSessions = currentIndex.sessions.map((s) =>
            s.id === id
              ? SessionMetadata.make({
                  ...s,
                  name: newName,
                  updatedAt: updated.updatedAt,
                })
              : s
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
          return yield* storage.listSessions()
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

      const serializeWorkspaces = Effect.fn(
        "SessionManager.serializeWorkspaces"
      )(function* (
        workspaces: ReadonlyMap<number, WorkspaceState>,
        activeWorkspaceId: number,
        getCwd: (ptyId: string) => Promise<string>
      ) {
        const sessionId = (yield* Ref.get(activeSessionRef)) ?? makeSessionId()
        const now = new Date()

        // Collect all CWDs
        const cwdMap = new Map<string, string>()
        for (const workspace of workspaces.values()) {
          const mainPane = workspace.mainPane
          if (mainPane?.ptyId) {
            const ptyId = mainPane.ptyId
            const cwd = yield* Effect.promise(() =>
              getCwd(ptyId).catch(() => process.cwd())
            )
            cwdMap.set(ptyId, cwd)
          }
          for (const pane of workspace.stackPanes) {
            if (pane.ptyId) {
              const ptyId = pane.ptyId
              const cwd = yield* Effect.promise(() =>
                getCwd(ptyId).catch(() => process.cwd())
              )
              cwdMap.set(ptyId, cwd)
            }
          }
        }

        // Serialize workspaces
        const serializedWorkspaces: SerializedWorkspace[] = []
        for (const [id, workspace] of workspaces) {
          const mainPane = workspace.mainPane
            ? SerializedPaneData.make({
                id: workspace.mainPane.id,
                title: workspace.mainPane.title,
                cwd: workspace.mainPane.ptyId
                  ? cwdMap.get(workspace.mainPane.ptyId) ?? process.cwd()
                  : process.cwd(),
              })
            : null

          const stackPanes = workspace.stackPanes.map((pane) =>
            SerializedPaneData.make({
              id: pane.id,
              title: pane.title,
              cwd: pane.ptyId
                ? cwdMap.get(pane.ptyId) ?? process.cwd()
                : process.cwd(),
            })
          )

          serializedWorkspaces.push(
            SerializedWorkspace.make({
              id: WorkspaceId.make(id),
              mainPane,
              stackPanes,
              layoutMode: workspace.layoutMode,
              activeStackIndex: workspace.activeStackIndex,
              zoomed: workspace.zoomed,
            })
          )
        }

        return SerializedSession.make({
          id: sessionId,
          name: "Session",
          workspaces: serializedWorkspaces,
          activeWorkspaceId: WorkspaceId.make(activeWorkspaceId),
          createdAt: now,
          updatedAt: now,
        })
      })

      const quickSave = Effect.fn("SessionManager.quickSave")(function* (
        sessionId: SessionId,
        name: string,
        workspaces: ReadonlyMap<number, WorkspaceState>,
        activeWorkspaceId: number,
        getCwd: (ptyId: string) => Promise<string>
      ) {
        const session = yield* serializeWorkspaces(
          workspaces,
          activeWorkspaceId,
          getCwd
        )

        const namedSession = SerializedSession.make({
          ...session,
          id: sessionId,
          name,
        })

        yield* saveSession(namedSession)
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
        function* (name: string) {
          const id = makeSessionId()
          const now = new Date()

          const session = SerializedSession.make({
            id,
            name,
            workspaces: [],
            activeWorkspaceId: WorkspaceId.make(1),
            createdAt: now,
            updatedAt: now,
          })

          yield* Ref.update(sessionsRef, (map) => {
            const newMap = new Map(map)
            newMap.set(id, session)
            return newMap
          })

          yield* Ref.set(activeRef, id)
          return id
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
          newMap.set(session.id, session)
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

          yield* Ref.update(sessionsRef, (map) => {
            const newMap = new Map(map)
            newMap.set(
              id,
              SerializedSession.make({ ...session, name: newName })
            )
            return newMap
          })
        }
      )

      const listSessions = Effect.fn("SessionManager.listSessions")(
        function* () {
          const sessions = yield* Ref.get(sessionsRef)
          return Array.from(sessions.values()).map((s) =>
            SessionMetadata.make({
              id: s.id,
              name: s.name,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            })
          )
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

      const serializeWorkspaces = Effect.fn(
        "SessionManager.serializeWorkspaces"
      )(function* () {
        return SerializedSession.make({
          id: makeSessionId(),
          name: "Test Session",
          workspaces: [],
          activeWorkspaceId: WorkspaceId.make(1),
          createdAt: new Date(),
          updatedAt: new Date(),
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
        serializeWorkspaces: serializeWorkspaces as any,
        quickSave: quickSave as any,
      })
    })
  )
}

// =============================================================================
// Helper Types (for serialization)
// =============================================================================

interface WorkspaceState {
  mainPane: { id: string; ptyId?: string; title?: string } | null
  stackPanes: Array<{ id: string; ptyId?: string; title?: string }>
  layoutMode: "vertical" | "horizontal" | "stacked"
  activeStackIndex: number
  zoomed: boolean
}
