# Effect Migration Plan for openmux

This document outlines a phased approach to migrating openmux to Effect TypeScript patterns.

## Overview

The migration follows a bottom-up approach: foundation types first, then services, then orchestration layers, and finally React integration.

```
Phase 1: Foundation     → Config, Errors, Branded Types
Phase 2: Services       → PTY, Clipboard, FileSystem
Phase 3: Session Layer  → Storage, Serializer, Manager
Phase 4: React Bridge   → Runtime, Hooks, Context Integration
```

---

## Phase 1: Foundation

**Goal:** Establish the type system foundation that all other phases build upon.

### 1.1 Configuration (`src/effect/Config.ts`)

Replace hardcoded `DEFAULT_CONFIG` with Effect.Config:

```typescript
import { Config, Context, Effect, Layer, Schema } from "effect"

// Branded types for config values
const WindowGap = Schema.Int.pipe(Schema.greaterThanOrEqualTo(0), Schema.brand("WindowGap"))
const StackRatio = Schema.Number.pipe(Schema.between(0, 1), Schema.brand("StackRatio"))

class AppConfig extends Context.Tag("@openmux/AppConfig")<
  AppConfig,
  {
    readonly windowGap: number
    readonly minPaneWidth: number
    readonly minPaneHeight: number
    readonly stackRatio: number
    readonly defaultShell: string
    readonly sessionStoragePath: string
  }
>() {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const home = yield* Config.string("HOME").pipe(
        Config.orElse(() => Config.string("USERPROFILE")),
        Config.orElse(() => Config.succeed("/tmp"))
      )
      const defaultShell = yield* Config.string("SHELL").pipe(
        Config.orElse(() => Config.succeed("/bin/bash"))
      )

      return AppConfig.of({
        windowGap: 0,
        minPaneWidth: 20,
        minPaneHeight: 5,
        stackRatio: 0.5,
        defaultShell,
        sessionStoragePath: `${home}/.config/openmux/sessions`,
      })
    })
  )

  // For tests
  static readonly testLayer = Layer.succeed(AppConfig, {
    windowGap: 0,
    minPaneWidth: 20,
    minPaneHeight: 5,
    stackRatio: 0.5,
    defaultShell: "/bin/bash",
    sessionStoragePath: "/tmp/openmux-test/sessions",
  })
}
```

### 1.2 Branded Types (`src/effect/types.ts`)

Create branded types for all IDs and domain primitives:

```typescript
import { Schema } from "effect"

// Entity IDs
export const PaneId = Schema.String.pipe(Schema.brand("PaneId"))
export type PaneId = typeof PaneId.Type

export const PtyId = Schema.String.pipe(Schema.brand("PtyId"))
export type PtyId = typeof PtyId.Type

export const WorkspaceId = Schema.Int.pipe(Schema.between(1, 9), Schema.brand("WorkspaceId"))
export type WorkspaceId = typeof WorkspaceId.Type

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

// Domain primitives
export const Cols = Schema.Int.pipe(Schema.greaterThan(0), Schema.brand("Cols"))
export type Cols = typeof Cols.Type

export const Rows = Schema.Int.pipe(Schema.greaterThan(0), Schema.brand("Rows"))
export type Rows = typeof Rows.Type
```

### 1.3 Error Types (`src/effect/errors.ts`)

Define domain errors with `Schema.TaggedError`:

```typescript
import { Schema } from "effect"
import { PaneId, PtyId, SessionId } from "./types"

// PTY Errors
export class PtySpawnError extends Schema.TaggedError<PtySpawnError>()(
  "PtySpawnError",
  {
    shell: Schema.String,
    cwd: Schema.String,
    cause: Schema.Defect,
  }
) {}

export class PtyNotFoundError extends Schema.TaggedError<PtyNotFoundError>()(
  "PtyNotFoundError",
  {
    ptyId: PtyId,
  }
) {}

export class PtyCwdError extends Schema.TaggedError<PtyCwdError>()(
  "PtyCwdError",
  {
    ptyId: PtyId,
    cause: Schema.Defect,
  }
) {}

// Session Errors
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionId: SessionId,
  }
) {}

export class SessionCorruptedError extends Schema.TaggedError<SessionCorruptedError>()(
  "SessionCorruptedError",
  {
    sessionId: SessionId,
    cause: Schema.Defect,
  }
) {}

export class SessionStorageError extends Schema.TaggedError<SessionStorageError>()(
  "SessionStorageError",
  {
    operation: Schema.Literal("read", "write", "delete"),
    path: Schema.String,
    cause: Schema.Defect,
  }
) {}

// Clipboard Errors
export class ClipboardError extends Schema.TaggedError<ClipboardError>()(
  "ClipboardError",
  {
    operation: Schema.Literal("read", "write"),
    cause: Schema.Defect,
  }
) {}

// Union types for error handling
export const PtyError = Schema.Union(PtySpawnError, PtyNotFoundError, PtyCwdError)
export type PtyError = typeof PtyError.Type

export const SessionError = Schema.Union(SessionNotFoundError, SessionCorruptedError, SessionStorageError)
export type SessionError = typeof SessionError.Type
```

### 1.4 Domain Models (`src/effect/models.ts`)

Define core domain models with Schema.Class:

```typescript
import { Schema } from "effect"
import { PaneId, PtyId, WorkspaceId, SessionId, Cols, Rows } from "./types"

// Rectangle for layout calculations
export class Rectangle extends Schema.Class<Rectangle>("Rectangle")({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int.pipe(Schema.greaterThan(0)),
  height: Schema.Int.pipe(Schema.greaterThan(0)),
}) {}

// Pane data
export class PaneData extends Schema.Class<PaneData>("PaneData")({
  id: PaneId,
  ptyId: Schema.optional(PtyId),
  title: Schema.optional(Schema.String),
  rectangle: Schema.optional(Rectangle),
}) {}

// PTY Session info
export class PtySession extends Schema.Class<PtySession>("PtySession")({
  id: PtyId,
  pid: Schema.Int,
  cols: Cols,
  rows: Rows,
  cwd: Schema.String,
  shell: Schema.String,
}) {}

// Serialized session for persistence
export class SerializedPaneData extends Schema.Class<SerializedPaneData>("SerializedPaneData")({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  cwd: Schema.String,
}) {}

export class SerializedWorkspace extends Schema.Class<SerializedWorkspace>("SerializedWorkspace")({
  id: WorkspaceId,
  mainPane: Schema.NullOr(SerializedPaneData),
  stackPanes: Schema.Array(SerializedPaneData),
  layoutMode: Schema.Literal("vertical", "horizontal", "stacked"),
  activeStackIndex: Schema.Int,
  zoomed: Schema.Boolean,
}) {}

export class SerializedSession extends Schema.Class<SerializedSession>("SerializedSession")({
  id: SessionId,
  name: Schema.String,
  workspaces: Schema.Array(SerializedWorkspace),
  activeWorkspaceId: WorkspaceId,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}
```

**Files to create:**
- `src/effect/Config.ts`
- `src/effect/types.ts`
- `src/effect/errors.ts`
- `src/effect/models.ts`
- `src/effect/index.ts` (barrel export)

---

## Phase 2: Services

**Goal:** Create Effect services for I/O operations with proper resource management.

### 2.1 Clipboard Service (`src/effect/services/Clipboard.ts`)

```typescript
import { Context, Effect, Layer } from "effect"
import { ClipboardError } from "../errors"

class Clipboard extends Context.Tag("@openmux/Clipboard")<
  Clipboard,
  {
    readonly write: (text: string) => Effect.Effect<void, ClipboardError>
    readonly read: () => Effect.Effect<string, ClipboardError>
  }
>() {
  static readonly layer = Layer.sync(Clipboard, () => {
    const platform = process.platform

    const write = (text: string) =>
      Effect.tryPromise({
        try: async () => {
          if (platform === "darwin") {
            const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
            proc.stdin.write(text)
            proc.stdin.end()
            await proc.exited
          } else if (platform === "linux") {
            // Try xclip, fallback to xsel
            try {
              const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" })
              proc.stdin.write(text)
              proc.stdin.end()
              await proc.exited
            } catch {
              const proc = Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: "pipe" })
              proc.stdin.write(text)
              proc.stdin.end()
              await proc.exited
            }
          }
        },
        catch: (error) => ClipboardError.make({ operation: "write", cause: error }),
      }).pipe(Effect.timeout("5 seconds"), Effect.catchTag("TimeoutException", () =>
        ClipboardError.make({ operation: "write", cause: new Error("Clipboard operation timed out") })
      ))

    const read = () =>
      Effect.tryPromise({
        try: async () => {
          if (platform === "darwin") {
            const result = await Bun.$`pbpaste`.quiet()
            return result.text()
          } else if (platform === "linux") {
            try {
              const result = await Bun.$`xclip -selection clipboard -o`.quiet()
              return result.text()
            } catch {
              const result = await Bun.$`xsel --clipboard --output`.quiet()
              return result.text()
            }
          }
          return ""
        },
        catch: (error) => ClipboardError.make({ operation: "read", cause: error }),
      }).pipe(Effect.timeout("5 seconds"), Effect.catchTag("TimeoutException", () =>
        ClipboardError.make({ operation: "read", cause: new Error("Clipboard operation timed out") })
      ))

    return Clipboard.of({ write, read })
  })
}
```

### 2.2 FileSystem Service (`src/effect/services/FileSystem.ts`)

Abstraction over Bun's file operations:

```typescript
import { Context, Effect, Layer, Schema } from "effect"
import { SessionStorageError } from "../errors"

class FileSystem extends Context.Tag("@openmux/FileSystem")<
  FileSystem,
  {
    readonly readJson: <A>(path: string, schema: Schema.Schema<A>) => Effect.Effect<A, SessionStorageError>
    readonly writeJson: <A>(path: string, schema: Schema.Schema<A>, data: A) => Effect.Effect<void, SessionStorageError>
    readonly exists: (path: string) => Effect.Effect<boolean>
    readonly ensureDir: (path: string) => Effect.Effect<void, SessionStorageError>
    readonly delete: (path: string) => Effect.Effect<void, SessionStorageError>
    readonly list: (path: string) => Effect.Effect<string[], SessionStorageError>
  }
>() {
  static readonly layer = Layer.sync(FileSystem, () => {
    const readJson = <A>(path: string, schema: Schema.Schema<A>) =>
      Effect.gen(function* () {
        const file = Bun.file(path)
        const fileExists = yield* Effect.promise(() => file.exists())

        if (!fileExists) {
          return yield* SessionStorageError.make({
            operation: "read",
            path,
            cause: new Error("File not found")
          })
        }

        const content = yield* Effect.tryPromise({
          try: () => file.text(),
          catch: (error) => SessionStorageError.make({ operation: "read", path, cause: error }),
        })

        const parsed = yield* Effect.try({
          try: () => JSON.parse(content),
          catch: (error) => SessionStorageError.make({ operation: "read", path, cause: error }),
        })

        return yield* Schema.decodeUnknown(schema)(parsed).pipe(
          Effect.mapError((error) => SessionStorageError.make({
            operation: "read",
            path,
            cause: error
          }))
        )
      })

    const writeJson = <A>(path: string, schema: Schema.Schema<A>, data: A) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encode(schema)(data).pipe(
          Effect.mapError((error) => SessionStorageError.make({
            operation: "write",
            path,
            cause: error
          }))
        )

        yield* Effect.tryPromise({
          try: () => Bun.write(path, JSON.stringify(encoded, null, 2)),
          catch: (error) => SessionStorageError.make({ operation: "write", path, cause: error }),
        })
      })

    const exists = (path: string) =>
      Effect.promise(() => Bun.file(path).exists())

    const ensureDir = (path: string) =>
      Effect.tryPromise({
        try: async () => {
          await Bun.$`mkdir -p ${path}`.quiet()
        },
        catch: (error) => SessionStorageError.make({ operation: "write", path, cause: error }),
      })

    const del = (path: string) =>
      Effect.tryPromise({
        try: () => Bun.file(path).unlink(),
        catch: (error) => SessionStorageError.make({ operation: "delete", path, cause: error }),
      })

    const list = (path: string) =>
      Effect.tryPromise({
        try: async () => {
          const glob = new Bun.Glob("*")
          const files: string[] = []
          for await (const file of glob.scan(path)) {
            files.push(file)
          }
          return files
        },
        catch: (error) => SessionStorageError.make({ operation: "read", path, cause: error }),
      })

    return FileSystem.of({ readJson, writeJson, exists, ensureDir, delete: del, list })
  })
}
```

### 2.3 PTY Service (`src/effect/services/Pty.ts`)

The most complex service - manages PTY lifecycle:

```typescript
import { Context, Effect, Layer, Stream, Ref, HashMap } from "effect"
import { spawn } from "zig-pty"
import { PtySpawnError, PtyNotFoundError, PtyCwdError } from "../errors"
import { PtyId, Cols, Rows } from "../types"
import { PtySession } from "../models"
import { AppConfig } from "../Config"

// Terminal state emitted by PTY
interface TerminalState {
  cells: Cell[][]
  cursorX: number
  cursorY: number
  // ... other state
}

class Pty extends Context.Tag("@openmux/Pty")<
  Pty,
  {
    readonly spawn: (options: {
      cols: Cols
      rows: Rows
      cwd?: string
    }) => Effect.Effect<PtyId, PtySpawnError>

    readonly write: (id: PtyId, data: string) => Effect.Effect<void, PtyNotFoundError>

    readonly resize: (id: PtyId, cols: Cols, rows: Rows) => Effect.Effect<void, PtyNotFoundError>

    readonly getCwd: (id: PtyId) => Effect.Effect<string, PtyCwdError>

    readonly destroy: (id: PtyId) => Effect.Effect<void>

    readonly subscribe: (id: PtyId) => Stream.Stream<TerminalState, PtyNotFoundError>

    readonly getSession: (id: PtyId) => Effect.Effect<PtySession, PtyNotFoundError>
  }
>() {
  static readonly layer = Layer.scoped(
    Pty,
    Effect.gen(function* () {
      const config = yield* AppConfig

      // Internal state: Map of PtyId -> session data
      const sessions = yield* Ref.make(HashMap.empty<PtyId, InternalPtySession>())

      // Cleanup all PTYs on scope close
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const current = yield* Ref.get(sessions)
          yield* Effect.forEach(
            HashMap.values(current),
            (session) => Effect.sync(() => session.pty.kill()),
            { discard: true }
          )
        })
      )

      const spawnPty = Effect.fn("Pty.spawn")(function* (options: {
        cols: Cols
        rows: Rows
        cwd?: string
      }) {
        const id = PtyId.make(`pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
        const cwd = options.cwd ?? process.cwd()

        const pty = yield* Effect.try({
          try: () => spawn(config.defaultShell, [], {
            cols: options.cols,
            rows: options.rows,
            cwd,
            env: process.env,
          }),
          catch: (error) => PtySpawnError.make({
            shell: config.defaultShell,
            cwd,
            cause: error
          }),
        })

        // Create emulator, subscribers, etc.
        const session: InternalPtySession = {
          id,
          pty,
          cols: options.cols,
          rows: options.rows,
          cwd,
          shell: config.defaultShell,
          // ... emulator, subscribers
        }

        yield* Ref.update(sessions, HashMap.set(id, session))

        return id
      })

      const write = Effect.fn("Pty.write")(function* (id: PtyId, data: string) {
        const current = yield* Ref.get(sessions)
        const session = HashMap.get(current, id)

        if (session._tag === "None") {
          return yield* PtyNotFoundError.make({ ptyId: id })
        }

        yield* Effect.sync(() => session.value.pty.write(data))
      })

      // ... other methods

      return Pty.of({
        spawn: spawnPty,
        write,
        resize: /* ... */,
        getCwd: /* ... */,
        destroy: /* ... */,
        subscribe: /* ... */,
        getSession: /* ... */,
      })
    })
  )
}
```

**Files to create:**
- `src/effect/services/Clipboard.ts`
- `src/effect/services/FileSystem.ts`
- `src/effect/services/Pty.ts`
- `src/effect/services/index.ts`

---

## Phase 3: Session Layer

**Goal:** Migrate session persistence and management to Effect.

### 3.1 Session Storage (`src/effect/services/SessionStorage.ts`)

```typescript
import { Context, Effect, Layer } from "effect"
import { FileSystem } from "./FileSystem"
import { AppConfig } from "../Config"
import { SessionStorageError, SessionNotFoundError, SessionCorruptedError } from "../errors"
import { SerializedSession, SessionIndex } from "../models"
import { SessionId } from "../types"

// Session index schema
const SessionIndex = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({
    id: SessionId,
    name: Schema.String,
    createdAt: Schema.Date,
    updatedAt: Schema.Date,
  })),
  activeSessionId: Schema.NullOr(SessionId),
})

class SessionStorage extends Context.Tag("@openmux/SessionStorage")<
  SessionStorage,
  {
    readonly loadIndex: () => Effect.Effect<SessionIndex, SessionStorageError>
    readonly saveIndex: (index: SessionIndex) => Effect.Effect<void, SessionStorageError>
    readonly loadSession: (id: SessionId) => Effect.Effect<SerializedSession, SessionNotFoundError | SessionCorruptedError>
    readonly saveSession: (session: SerializedSession) => Effect.Effect<void, SessionStorageError>
    readonly deleteSession: (id: SessionId) => Effect.Effect<void, SessionStorageError>
    readonly listSessions: () => Effect.Effect<SessionMetadata[], SessionStorageError>
  }
>() {
  static readonly layer = Layer.effect(
    SessionStorage,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      const config = yield* AppConfig

      const indexPath = `${config.sessionStoragePath}/index.json`
      const sessionPath = (id: SessionId) => `${config.sessionStoragePath}/${id}.json`

      // Ensure storage directory exists
      yield* fs.ensureDir(config.sessionStoragePath)

      const loadIndex = Effect.fn("SessionStorage.loadIndex")(function* () {
        const exists = yield* fs.exists(indexPath)
        if (!exists) {
          return { sessions: [], activeSessionId: null }
        }
        return yield* fs.readJson(indexPath, SessionIndex)
      })

      const saveIndex = Effect.fn("SessionStorage.saveIndex")(function* (index: SessionIndex) {
        yield* fs.writeJson(indexPath, SessionIndex, index)
      })

      const loadSession = Effect.fn("SessionStorage.loadSession")(function* (id: SessionId) {
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

      const saveSession = Effect.fn("SessionStorage.saveSession")(function* (session: SerializedSession) {
        yield* fs.writeJson(sessionPath(session.id), SerializedSession, session)
      })

      const deleteSession = Effect.fn("SessionStorage.deleteSession")(function* (id: SessionId) {
        yield* fs.delete(sessionPath(id))
      })

      const listSessions = Effect.fn("SessionStorage.listSessions")(function* () {
        const index = yield* loadIndex()
        return index.sessions
      })

      return SessionStorage.of({
        loadIndex,
        saveIndex,
        loadSession,
        saveSession,
        deleteSession,
        listSessions,
      })
    })
  )
}
```

### 3.2 Session Manager (`src/effect/services/SessionManager.ts`)

Orchestrates session operations:

```typescript
import { Context, Effect, Layer, Ref } from "effect"
import { SessionStorage } from "./SessionStorage"
import { Pty } from "./Pty"
import { SerializedSession } from "../models"
import { SessionId, WorkspaceId } from "../types"

class SessionManager extends Context.Tag("@openmux/SessionManager")<
  SessionManager,
  {
    readonly createSession: (name: string) => Effect.Effect<SessionId>
    readonly loadSession: (id: SessionId) => Effect.Effect<SerializedSession, SessionError>
    readonly saveCurrentSession: () => Effect.Effect<void, SessionError>
    readonly switchSession: (id: SessionId) => Effect.Effect<void, SessionError>
    readonly deleteSession: (id: SessionId) => Effect.Effect<void, SessionError>
    readonly renameSession: (id: SessionId, name: string) => Effect.Effect<void, SessionError>
  }
>() {
  static readonly layer = Layer.effect(
    SessionManager,
    Effect.gen(function* () {
      const storage = yield* SessionStorage
      const pty = yield* Pty

      // Current session state
      const currentSessionRef = yield* Ref.make<SessionId | null>(null)

      const createSession = Effect.fn("SessionManager.createSession")(function* (name: string) {
        const id = SessionId.make(`session-${Date.now()}`)
        const now = new Date()

        const session = SerializedSession.make({
          id,
          name,
          workspaces: [],
          activeWorkspaceId: WorkspaceId.make(1),
          createdAt: now,
          updatedAt: now,
        })

        yield* storage.saveSession(session)

        // Update index
        const index = yield* storage.loadIndex()
        yield* storage.saveIndex({
          ...index,
          sessions: [...index.sessions, { id, name, createdAt: now, updatedAt: now }],
          activeSessionId: id,
        })

        yield* Ref.set(currentSessionRef, id)

        return id
      })

      // ... other methods

      return SessionManager.of({
        createSession,
        loadSession: /* ... */,
        saveCurrentSession: /* ... */,
        switchSession: /* ... */,
        deleteSession: /* ... */,
        renameSession: /* ... */,
      })
    })
  )
}
```

**Files to create:**
- `src/effect/services/SessionStorage.ts`
- `src/effect/services/SessionManager.ts`

---

## Phase 4: React Integration

**Goal:** Bridge Effect services with React contexts.

### 4.1 Effect Runtime (`src/effect/runtime.ts`)

Create a singleton runtime for the app:

```typescript
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppConfig } from "./Config"
import { Clipboard } from "./services/Clipboard"
import { FileSystem } from "./services/FileSystem"
import { Pty } from "./services/Pty"
import { SessionStorage } from "./services/SessionStorage"
import { SessionManager } from "./services/SessionManager"

// Compose all layers
const AppLayer = SessionManager.layer.pipe(
  Layer.provideMerge(SessionStorage.layer),
  Layer.provideMerge(Pty.layer),
  Layer.provideMerge(FileSystem.layer),
  Layer.provideMerge(Clipboard.layer),
  Layer.provideMerge(AppConfig.layer),
)

// Create managed runtime
export const AppRuntime = ManagedRuntime.make(AppLayer)

// Helper to run effects
export const runEffect = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  AppRuntime.runPromise(effect)

export const runEffectSync = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  AppRuntime.runSync(effect)
```

### 4.2 React Hooks (`src/effect/hooks.ts`)

```typescript
import { useEffect, useState, useCallback } from "react"
import { Effect, Stream } from "effect"
import { AppRuntime, runEffect } from "./runtime"

// Run an effect and return result
export function useEffect_<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  deps: unknown[]
): { data: A | null; error: E | null; loading: boolean } {
  const [state, setState] = useState<{
    data: A | null
    error: E | null
    loading: boolean
  }>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false

    runEffect(effect)
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, error, loading: false })
      })

    return () => {
      cancelled = true
    }
  }, deps)

  return state
}

// Create a callback that runs an effect
export function useEffectCallback<Args extends unknown[], A, E>(
  fn: (...args: Args) => Effect.Effect<A, E, AppServices>
): (...args: Args) => Promise<A> {
  return useCallback((...args: Args) => runEffect(fn(...args)), [fn])
}
```

### 4.3 Updated TerminalContext (`src/contexts/TerminalContext.tsx`)

Integrate Effect services with existing context:

```typescript
import { useEffect, useCallback } from "react"
import { Effect } from "effect"
import { runEffect } from "../effect/runtime"
import { Pty, Clipboard } from "../effect/services"

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  // Initialize Effect runtime on mount
  useEffect(() => {
    const init = Effect.gen(function* () {
      // Any initialization that needs Effect services
      yield* Effect.log("Terminal context initialized")
    })

    runEffect(init).catch(console.error)
  }, [])

  // PTY operations using Effect
  const createPty = useCallback(async (paneId: string, cols: number, rows: number) => {
    return runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const ptyId = yield* pty.spawn({
          cols: Cols.make(cols),
          rows: Rows.make(rows)
        })
        return ptyId
      })
    )
  }, [])

  const writeToPty = useCallback(async (ptyId: string, data: string) => {
    return runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        yield* pty.write(PtyId.make(ptyId), data)
      })
    )
  }, [])

  const copyToClipboard = useCallback(async (text: string) => {
    return runEffect(
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        yield* clipboard.write(text)
      })
    )
  }, [])

  // ... rest of context
}
```

**Files to create:**
- `src/effect/runtime.ts`
- `src/effect/hooks.ts`
- Update `src/contexts/TerminalContext.tsx`
- Update `src/contexts/SessionContext.tsx`

---

## Phase 0: Testing Setup

**Goal:** Set up `@effect/vitest` before any migration work begins.

### 0.1 Install Testing Dependencies

```bash
bun add -d vitest @effect/vitest
```

### 0.2 Create Vitest Config (`vitest.config.ts`)

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    environment: "node",
    testTimeout: 10000,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@opentui/react",
  },
})
```

### 0.3 Add Test Scripts to package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 0.4 Create Test Directory Structure

```
tests/
├── effect/
│   ├── services/
│   │   ├── Clipboard.test.ts
│   │   ├── FileSystem.test.ts
│   │   ├── Pty.test.ts
│   │   ├── SessionStorage.test.ts
│   │   └── SessionManager.test.ts
│   ├── Config.test.ts
│   └── models.test.ts
└── integration/
    └── session-lifecycle.test.ts
```

### 0.5 Example Test File Structure

Each service gets a corresponding test file with test layers:

```typescript
// tests/effect/services/Clipboard.test.ts
import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Clipboard } from "../../../src/effect/services/Clipboard"

describe("Clipboard", () => {
  describe("write", () => {
    it.effect("writes text to clipboard", () =>
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        yield* clipboard.write("test text")
        // No error means success
      }).pipe(Effect.provide(Clipboard.layer))
    )

    it.effect("handles timeout", () =>
      Effect.gen(function* () {
        // Test with mock that times out
      }).pipe(Effect.provide(Clipboard.testLayer))
    )
  })

  describe("read", () => {
    it.effect("reads text from clipboard", () =>
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        const text = yield* clipboard.read()
        expect(typeof text).toBe("string")
      }).pipe(Effect.provide(Clipboard.layer))
    )
  })
})
```

### 0.6 Test Layer Pattern

Every service should have a `testLayer` for unit testing:

```typescript
class Clipboard extends Context.Tag("@openmux/Clipboard")<...>() {
  // Production implementation
  static readonly layer = Layer.sync(Clipboard, () => {
    // Real platform-specific implementation
  })

  // Test implementation - in-memory, deterministic
  static readonly testLayer = Layer.sync(Clipboard, () => {
    let buffer = ""

    const write = (text: string) =>
      Effect.sync(() => { buffer = text })

    const read = () =>
      Effect.succeed(buffer)

    return Clipboard.of({ write, read })
  })
}
```

### 0.7 Integration Test Layer

For integration tests, compose real services with mocked I/O:

```typescript
// tests/integration/layers.ts
import { Layer } from "effect"
import { AppConfig } from "../../src/effect/Config"
import { FileSystem } from "../../src/effect/services/FileSystem"
import { Pty } from "../../src/effect/services/Pty"
import { SessionStorage } from "../../src/effect/services/SessionStorage"
import { SessionManager } from "../../src/effect/services/SessionManager"

// Integration layer: real business logic, mocked I/O
export const IntegrationTestLayer = SessionManager.layer.pipe(
  Layer.provideMerge(SessionStorage.layer),
  Layer.provideMerge(Pty.testLayer),        // Mock PTY
  Layer.provideMerge(FileSystem.testLayer), // In-memory FS
  Layer.provideMerge(AppConfig.testLayer),  // Test config
)
```

### 0.8 Schema Validation Tests

Test domain models and schemas:

```typescript
// tests/effect/models.test.ts
import { Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { PaneId, WorkspaceId, SerializedSession } from "../../src/effect/models"

describe("Domain Models", () => {
  describe("WorkspaceId", () => {
    it("accepts valid workspace IDs (1-9)", () => {
      expect(Schema.decodeUnknownSync(WorkspaceId)(1)).toBe(1)
      expect(Schema.decodeUnknownSync(WorkspaceId)(9)).toBe(9)
    })

    it("rejects invalid workspace IDs", () => {
      expect(() => Schema.decodeUnknownSync(WorkspaceId)(0)).toThrow()
      expect(() => Schema.decodeUnknownSync(WorkspaceId)(10)).toThrow()
    })
  })

  describe("SerializedSession", () => {
    it("decodes valid session JSON", () => {
      const json = {
        id: "session-123",
        name: "Test Session",
        workspaces: [],
        activeWorkspaceId: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }

      const session = Schema.decodeUnknownSync(SerializedSession)(json)
      expect(session.id).toBe("session-123")
      expect(session.name).toBe("Test Session")
    })

    it("rejects invalid session JSON", () => {
      const json = { id: "session-123" } // Missing required fields
      expect(() => Schema.decodeUnknownSync(SerializedSession)(json)).toThrow()
    })
  })
})
```

---

## Migration Order

```
Phase 0: Testing Setup
├── Install vitest + @effect/vitest
├── Create vitest.config.ts
├── Add test scripts to package.json
└── Create test directory structure

Phase 1: Foundation
├── Create src/effect/ directory structure
├── Define Config service
├── Define branded types
├── Define error types
└── Define domain models

Phase 2: Services
├── Implement Clipboard service
├── Implement FileSystem service
├── Implement Pty service (most complex)
└── Write tests for services

Phase 3: Session Layer
├── Implement SessionStorage service
├── Implement SessionManager service
├── Migrate session-serializer.ts
└── Write integration tests

Phase 4: React Integration
├── Create Effect runtime
├── Create React hooks
├── Update TerminalContext
├── Update SessionContext
└── End-to-end testing
```

---

## Testing Strategy

Each service should have a `testLayer` for unit testing:

```typescript
// In Pty.ts
class Pty extends Context.Tag("@openmux/Pty")<...>() {
  static readonly layer = /* production implementation */

  static readonly testLayer = Layer.succeed(Pty, {
    spawn: () => Effect.succeed(PtyId.make("test-pty-1")),
    write: () => Effect.void,
    resize: () => Effect.void,
    getCwd: () => Effect.succeed("/test/cwd"),
    destroy: () => Effect.void,
    subscribe: () => Stream.empty,
    getSession: () => Effect.succeed(/* mock session */),
  })
}

// In tests
import { Effect, Layer } from "effect"
import { Pty, SessionManager } from "../effect/services"

const TestLayer = SessionManager.layer.pipe(
  Layer.provide(Pty.testLayer),
  // ... other test layers
)

test("session manager creates session", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.createSession("Test Session")
    }).pipe(Effect.provide(TestLayer))
  )

  expect(result).toMatch(/^session-/)
})
```

---

## Rollback Strategy

The migration is incremental. Each phase can be completed independently:

1. **Phase 1** is pure types - no runtime changes
2. **Phase 2** services can coexist with existing code
3. **Phase 3** can use Effect services internally while exposing same API
4. **Phase 4** gradually replaces callbacks with Effect

If issues arise, revert to the previous phase's implementation.

---

## Benefits After Migration

1. **Type-safe errors**: All failure modes explicitly typed
2. **Resource safety**: PTY cleanup guaranteed via Effect.Resource
3. **Testability**: Swap layers for testing without mocks
4. **Observability**: Built-in logging and tracing
5. **Timeout protection**: All I/O operations have timeouts
6. **Retry logic**: Easy to add retry policies
7. **Concurrency**: Effect.Semaphore prevents race conditions
8. **Schema validation**: Data validated at boundaries
