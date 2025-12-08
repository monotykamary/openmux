/**
 * Session storage service for persisting sessions to disk.
 */
import { Context, Effect, Layer } from "effect"
import { FileSystem } from "./FileSystem"
import { AppConfig } from "../Config"
import {
  SessionStorageError,
  SessionNotFoundError,
  SessionCorruptedError,
} from "../errors"
import {
  SerializedSession,
  SessionMetadata,
  SessionIndex,
} from "../models"
import { SessionId } from "../types"

// =============================================================================
// SessionStorage Service
// =============================================================================

export class SessionStorage extends Context.Tag("@openmux/SessionStorage")<
  SessionStorage,
  {
    /** Load the session index */
    readonly loadIndex: () => Effect.Effect<SessionIndex, SessionStorageError>

    /** Save the session index */
    readonly saveIndex: (
      index: SessionIndex
    ) => Effect.Effect<void, SessionStorageError>

    /** Load a session by ID */
    readonly loadSession: (
      id: SessionId
    ) => Effect.Effect<
      SerializedSession,
      SessionNotFoundError | SessionCorruptedError
    >

    /** Save a session */
    readonly saveSession: (
      session: SerializedSession
    ) => Effect.Effect<void, SessionStorageError>

    /** Delete a session */
    readonly deleteSession: (
      id: SessionId
    ) => Effect.Effect<void, SessionStorageError>

    /** List all session metadata */
    readonly listSessions: () => Effect.Effect<
      readonly SessionMetadata[],
      SessionStorageError
    >

    /** Check if a session exists */
    readonly sessionExists: (id: SessionId) => Effect.Effect<boolean>
  }
>() {
  /** Production layer */
  static readonly layer = Layer.effect(
    SessionStorage,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      const config = yield* AppConfig

      const storagePath = config.sessionStoragePath
      const indexPath = `${storagePath}/index.json`
      const sessionPath = (id: SessionId) => `${storagePath}/${id}.json`

      // Ensure storage directory exists on initialization
      yield* fs.ensureDir(storagePath)

      const loadIndex = Effect.fn("SessionStorage.loadIndex")(function* () {
        const exists = yield* fs.exists(indexPath)

        if (!exists) {
          return SessionIndex.empty()
        }

        return yield* fs.readJson(indexPath, SessionIndex).pipe(
          Effect.catchTag("SessionStorageError", () =>
            Effect.succeed(SessionIndex.empty())
          )
        )
      })

      const saveIndex = Effect.fn("SessionStorage.saveIndex")(function* (
        index: SessionIndex
      ) {
        yield* fs.writeJson(indexPath, SessionIndex, index)
      })

      const loadSession = Effect.fn("SessionStorage.loadSession")(function* (
        id: SessionId
      ) {
        const path = sessionPath(id)
        const exists = yield* fs.exists(path)

        if (!exists) {
          return yield* SessionNotFoundError.make({ sessionId: id })
        }

        return yield* fs.readJson(path, SerializedSession).pipe(
          Effect.catchTag("SessionStorageError", (error) =>
            SessionCorruptedError.make({ sessionId: id, cause: error })
          )
        )
      })

      const saveSession = Effect.fn("SessionStorage.saveSession")(function* (
        session: SerializedSession
      ) {
        yield* fs.writeJson(sessionPath(session.id), SerializedSession, session)
      })

      const deleteSession = Effect.fn("SessionStorage.deleteSession")(
        function* (id: SessionId) {
          yield* fs.remove(sessionPath(id))
        }
      )

      const listSessions = Effect.fn("SessionStorage.listSessions")(
        function* () {
          const index = yield* loadIndex()
          return index.sessions
        }
      )

      const sessionExists = Effect.fn("SessionStorage.sessionExists")(
        function* (id: SessionId) {
          return yield* fs.exists(sessionPath(id))
        }
      )

      return SessionStorage.of({
        loadIndex,
        saveIndex,
        loadSession,
        saveSession,
        deleteSession,
        listSessions,
        sessionExists,
      })
    })
  )

  /** Test layer - in-memory session storage */
  static readonly testLayer = Layer.effect(
    SessionStorage,
    Effect.gen(function* () {
      const fs = yield* FileSystem

      // Use in-memory FileSystem from test layer
      const indexPath = "/tmp/openmux-test/sessions/index.json"
      const sessionPath = (id: SessionId) =>
        `/tmp/openmux-test/sessions/${id}.json`

      const loadIndex = Effect.fn("SessionStorage.loadIndex")(function* () {
        const exists = yield* fs.exists(indexPath)

        if (!exists) {
          return SessionIndex.empty()
        }

        return yield* fs.readJson(indexPath, SessionIndex).pipe(
          Effect.catchTag("SessionStorageError", () =>
            Effect.succeed(SessionIndex.empty())
          )
        )
      })

      const saveIndex = Effect.fn("SessionStorage.saveIndex")(function* (
        index: SessionIndex
      ) {
        yield* fs.writeJson(indexPath, SessionIndex, index)
      })

      const loadSession = Effect.fn("SessionStorage.loadSession")(function* (
        id: SessionId
      ) {
        const path = sessionPath(id)
        const exists = yield* fs.exists(path)

        if (!exists) {
          return yield* SessionNotFoundError.make({ sessionId: id })
        }

        return yield* fs.readJson(path, SerializedSession).pipe(
          Effect.catchTag("SessionStorageError", (error) =>
            SessionCorruptedError.make({ sessionId: id, cause: error })
          )
        )
      })

      const saveSession = Effect.fn("SessionStorage.saveSession")(function* (
        session: SerializedSession
      ) {
        yield* fs.writeJson(sessionPath(session.id), SerializedSession, session)
      })

      const deleteSession = Effect.fn("SessionStorage.deleteSession")(
        function* (id: SessionId) {
          yield* fs.remove(sessionPath(id))
        }
      )

      const listSessions = Effect.fn("SessionStorage.listSessions")(
        function* () {
          const index = yield* loadIndex()
          return index.sessions
        }
      )

      const sessionExists = Effect.fn("SessionStorage.sessionExists")(
        function* (id: SessionId) {
          return yield* fs.exists(sessionPath(id))
        }
      )

      return SessionStorage.of({
        loadIndex,
        saveIndex,
        loadSession,
        saveSession,
        deleteSession,
        listSessions,
        sessionExists,
      })
    })
  ).pipe(Layer.provide(FileSystem.testLayer))
}
