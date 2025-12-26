/**
 * PTY service for managing terminal pseudo-terminal sessions.
 * Wraps zig-pty with native libghostty-vt parsing.
 */
import { Context, Effect, Layer, Ref, HashMap, Option, Runtime } from "effect"
import type { TerminalState, UnifiedTerminalUpdate } from "../../core/types"
import type { ITerminalEmulator } from "../../terminal/emulator-interface"
import { getHostColors, getDefaultColors } from "../../terminal/terminal-colors"
import type { PtySpawnError, PtyCwdError } from "../errors";
import { PtyNotFoundError } from "../errors"
import { PtyId, Cols, Rows, makePtyId } from "../types"
import { PtySession } from "../models"
import { AppConfig } from "../Config"
import * as ShimClient from "../../shim/client"

// Import extracted modules
import type { InternalPtySession } from "./pty/types"
import { makeSubscriptionRegistry } from "./pty/subscription-manager"
import { createSession } from "./pty/session-factory"
import { createOperations } from "./pty/operations"
import { createSubscriptions } from "./pty/subscriptions"

// =============================================================================
// PTY Service
// =============================================================================

export class Pty extends Context.Tag("@openmux/Pty")<
  Pty,
  {
    /** Create a new PTY session */
    readonly create: (options: {
      cols: Cols
      rows: Rows
      cwd?: string
      env?: Record<string, string>
    }) => Effect.Effect<PtyId, PtySpawnError>

    /** Write data to a PTY */
    readonly write: (id: PtyId, data: string) => Effect.Effect<void, PtyNotFoundError>

    /** Resize a PTY */
    readonly resize: (
      id: PtyId,
      cols: Cols,
      rows: Rows
    ) => Effect.Effect<void, PtyNotFoundError>

    /** Get current working directory of a PTY's shell process */
    readonly getCwd: (id: PtyId) => Effect.Effect<string, PtyNotFoundError | PtyCwdError>

    /** Destroy a PTY session */
    readonly destroy: (id: PtyId) => Effect.Effect<void>

    /** Get session info */
    readonly getSession: (id: PtyId) => Effect.Effect<PtySession, PtyNotFoundError>

    /** Get terminal state */
    readonly getTerminalState: (id: PtyId) => Effect.Effect<TerminalState, PtyNotFoundError>

    /** Subscribe to terminal state updates */
    readonly subscribe: (
      id: PtyId,
      callback: (state: TerminalState) => void
    ) => Effect.Effect<() => void, PtyNotFoundError>

    /** Subscribe to scroll state changes (lightweight - no state rebuild) */
    readonly subscribeToScroll: (
      id: PtyId,
      callback: () => void
    ) => Effect.Effect<() => void, PtyNotFoundError>

    /**
     * Subscribe to unified updates (terminal + scroll combined).
     * More efficient than separate subscriptions - eliminates race conditions
     * and reduces render cycles.
     */
    readonly subscribeUnified: (
      id: PtyId,
      callback: (update: UnifiedTerminalUpdate) => void
    ) => Effect.Effect<() => void, PtyNotFoundError>

    /** Subscribe to PTY exit events */
    readonly onExit: (
      id: PtyId,
      callback: (exitCode: number) => void
    ) => Effect.Effect<() => void, PtyNotFoundError>

    /** Set pane position for graphics passthrough */
    readonly setPanePosition: (
      id: PtyId,
      x: number,
      y: number
    ) => Effect.Effect<void, PtyNotFoundError>

    /** Get scroll state */
    readonly getScrollState: (id: PtyId) => Effect.Effect<
      { viewportOffset: number; scrollbackLength: number; isAtBottom: boolean },
      PtyNotFoundError
    >

    /** Set scroll offset */
    readonly setScrollOffset: (
      id: PtyId,
      offset: number
    ) => Effect.Effect<void, PtyNotFoundError>

    /** Enable or disable terminal update notifications (visibility gating) */
    readonly setUpdateEnabled: (
      id: PtyId,
      enabled: boolean
    ) => Effect.Effect<void, PtyNotFoundError>

    /** Get emulator for direct access (e.g., scrollback lines) */
    readonly getEmulator: (id: PtyId) => Effect.Effect<ITerminalEmulator, PtyNotFoundError>

    /** Destroy all sessions */
    readonly destroyAll: () => Effect.Effect<void>

    /** List all active PTY IDs */
    readonly listAll: () => Effect.Effect<PtyId[]>

    /** Get foreground process name for a PTY */
    readonly getForegroundProcess: (id: PtyId) => Effect.Effect<string | undefined, PtyNotFoundError>

    /** Get git branch for a PTY's current directory */
    readonly getGitBranch: (id: PtyId) => Effect.Effect<string | undefined, PtyNotFoundError | PtyCwdError>

    /** Subscribe to PTY lifecycle events (created/destroyed) */
    readonly subscribeToLifecycle: (
      callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
    ) => Effect.Effect<() => void>

    /** Get current terminal title for a PTY */
    readonly getTitle: (id: PtyId) => Effect.Effect<string, PtyNotFoundError>

    /** Subscribe to terminal title changes for a PTY */
    readonly subscribeToTitleChange: (
      id: PtyId,
      callback: (title: string) => void
    ) => Effect.Effect<() => void, PtyNotFoundError>

    /** Subscribe to title changes across ALL PTYs (for aggregate view) */
    readonly subscribeToAllTitleChanges: (
      callback: (event: { ptyId: PtyId; title: string }) => void
    ) => Effect.Effect<() => void>
  }
>() {
  /** Production layer */
  static readonly layer = Layer.effect(
    Pty,
    Effect.gen(function* () {
      const config = yield* AppConfig

      // Internal session storage
      const sessionsRef = yield* Ref.make(
        HashMap.empty<PtyId, InternalPtySession>()
      )

      // Lifecycle event types
      type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: PtyId }
      type TitleChangeEvent = { ptyId: PtyId; title: string }

      // Effect-based subscription registries with synchronous cleanup support
      const lifecycleRegistry = yield* makeSubscriptionRegistry<LifecycleEvent>()
      const globalTitleRegistry = yield* makeSubscriptionRegistry<TitleChangeEvent>()

      // Helper to get a session or fail
      const getSessionOrFail = (id: PtyId) =>
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef)
          const session = HashMap.get(sessions, id)
          if (Option.isNone(session)) {
            return yield* PtyNotFoundError.make({ ptyId: id })
          }
          return session.value
        })

      // Create operations using factory
      const operations = createOperations({
        sessionsRef,
        getSessionOrFail,
        lifecycleRegistry,
      })

      const runtime = yield* Effect.runtime()
      const runFork = Runtime.runFork(runtime)
      const handleExit = (ptyId: PtyId, _exitCode: number) => {
        runFork(operations.destroy(ptyId))
      }

      // Create session factory
      const create = Effect.fn("Pty.create")(function* (options: {
        cols: Cols
        rows: Rows
        cwd?: string
        env?: Record<string, string>
      }) {
        const colors = getHostColors() ?? getDefaultColors()
        const { id, session } = yield* createSession(
          {
            colors,
            defaultShell: config.defaultShell,
            onLifecycleEvent: (event) => lifecycleRegistry.notify(event),
            onTitleChange: (ptyId, title) => globalTitleRegistry.notifySync({ ptyId, title }),
            onExit: handleExit,
          },
          options
        )

        // Store session
        yield* Ref.update(sessionsRef, HashMap.set(id, session))

        // Emit lifecycle event
        yield* lifecycleRegistry.notify({ type: 'created', ptyId: id })

        return id
      })

      // Create subscriptions using factory
      const subscriptions = createSubscriptions({
        getSessionOrFail,
        lifecycleRegistry,
        globalTitleRegistry,
      })

      return Pty.of({
        create,
        write: operations.write,
        resize: operations.resize,
        getCwd: operations.getCwd,
        destroy: operations.destroy,
        getSession: operations.getSession,
        getTerminalState: operations.getTerminalState,
        subscribe: subscriptions.subscribe,
        subscribeToScroll: subscriptions.subscribeToScroll,
        subscribeUnified: subscriptions.subscribeUnified,
        onExit: subscriptions.onExit,
        setPanePosition: operations.setPanePosition,
        getScrollState: operations.getScrollState,
        setScrollOffset: operations.setScrollOffset,
        setUpdateEnabled: operations.setUpdateEnabled,
        getEmulator: operations.getEmulator,
        destroyAll: operations.destroyAll,
        listAll: operations.listAll,
        getForegroundProcess: subscriptions.getForegroundProcess,
        getGitBranch: subscriptions.getGitBranch,
        subscribeToLifecycle: subscriptions.subscribeToLifecycle,
        getTitle: operations.getTitle,
        subscribeToTitleChange: subscriptions.subscribeToTitleChange,
        subscribeToAllTitleChanges: subscriptions.subscribeToAllTitleChanges,
      })
    })
  )

  /** Shim layer - proxies PTY operations through the background shim process */
  static readonly shimLayer = Layer.effect(
    Pty,
    Effect.gen(function* () {
      yield* Effect.promise(() => ShimClient.waitForShim())

      return Pty.of({
        create: (options) =>
          Effect.promise(async () => {
            const ptyId = await ShimClient.createPty({
              cols: options.cols as number,
              rows: options.rows as number,
              cwd: options.cwd,
            })
            return PtyId.make(ptyId)
          }),
        write: (id, data) =>
          Effect.promise(() => ShimClient.writePty(String(id), data)),
        resize: (id, cols, rows) =>
          Effect.promise(() => ShimClient.resizePty(String(id), cols as number, rows as number)),
        getCwd: (id) =>
          Effect.promise(() => ShimClient.getPtyCwd(String(id))),
        destroy: (id) =>
          Effect.promise(() => ShimClient.destroyPty(String(id))),
        getSession: (id) =>
          Effect.gen(function* () {
            const session = yield* Effect.promise(() => ShimClient.getSessionInfo(String(id)))
            if (!session) {
              return yield* PtyNotFoundError.make({ ptyId: id })
            }
            return PtySession.make({
              id: PtyId.make(session.id),
              pid: session.pid,
              cols: Cols.make(session.cols),
              rows: Rows.make(session.rows),
              cwd: session.cwd,
              shell: session.shell,
            })
          }),
        getTerminalState: (id) =>
          Effect.gen(function* () {
            const state = yield* Effect.promise(() => ShimClient.getTerminalState(String(id)))
            if (!state) {
              return yield* PtyNotFoundError.make({ ptyId: id })
            }
            return state
          }),
        subscribe: (id, callback) =>
          Effect.sync(() => ShimClient.subscribeState(String(id), callback)),
        subscribeToScroll: (id, callback) =>
          Effect.sync(() => ShimClient.subscribeScroll(String(id), callback)),
        subscribeUnified: (id, callback) =>
          Effect.sync(() => ShimClient.subscribeUnified(String(id), callback)),
        onExit: (id, callback) =>
          Effect.sync(() => ShimClient.subscribeExit(String(id), callback)),
        setPanePosition: (id, x, y) =>
          Effect.promise(() => ShimClient.setPanePosition(String(id), x, y)),
        getScrollState: (id) =>
          Effect.gen(function* () {
            const state = yield* Effect.promise(() => ShimClient.getScrollState(String(id)))
            if (!state) {
              return yield* PtyNotFoundError.make({ ptyId: id })
            }
            return state
          }),
        setScrollOffset: (id, offset) =>
          Effect.promise(() => ShimClient.setScrollOffset(String(id), offset)),
        setUpdateEnabled: (id, enabled) =>
          Effect.promise(() => ShimClient.setUpdateEnabled(String(id), enabled)),
        getEmulator: (id) =>
          Effect.sync(() => ShimClient.getEmulator(String(id))),
        destroyAll: () =>
          Effect.promise(() => ShimClient.destroyAllPtys()),
        listAll: () =>
          Effect.promise(async () => {
            const ids = await ShimClient.listAllPtys()
            return ids.map((value) => PtyId.make(value))
          }),
        getForegroundProcess: (id) =>
          Effect.promise(() => ShimClient.getForegroundProcess(String(id))),
        getGitBranch: (id) =>
          Effect.promise(() => ShimClient.getGitBranch(String(id))),
        subscribeToLifecycle: (callback) =>
          Effect.sync(() =>
            ShimClient.subscribeToLifecycle((event) => {
              callback({ type: event.type, ptyId: PtyId.make(event.ptyId) })
            })
          ),
        getTitle: (id) =>
          Effect.promise(() => ShimClient.getTitle(String(id))),
        subscribeToTitleChange: (id, callback) =>
          Effect.sync(() => ShimClient.subscribeToTitle(String(id), callback)),
        subscribeToAllTitleChanges: (callback) =>
          Effect.sync(() =>
            ShimClient.subscribeToAllTitles((event) => {
              callback({ ptyId: PtyId.make(event.ptyId), title: event.title })
            })
          ),
      })
    })
  )

  /** Test layer - mock PTY for testing */
  static readonly testLayer = Layer.succeed(Pty, {
    create: () => Effect.succeed(makePtyId()),
    write: () => Effect.void,
    resize: () => Effect.void,
    getCwd: () => Effect.succeed("/test/cwd"),
    destroy: () => Effect.void,
    getSession: (id) =>
      Effect.succeed(
        PtySession.make({
          id,
          pid: 12345,
          cols: Cols.make(80),
          rows: Rows.make(24),
          cwd: "/test/cwd",
          shell: "/bin/bash",
        })
      ),
    getTerminalState: () =>
      Effect.succeed({
        cells: [],
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
      } as unknown as TerminalState),
    subscribe: () => Effect.succeed(() => {}),
    subscribeToScroll: () => Effect.succeed(() => {}),
    subscribeUnified: () => Effect.succeed(() => {}),
    onExit: () => Effect.succeed(() => {}),
    setPanePosition: () => Effect.void,
    getScrollState: () =>
      Effect.succeed({
        viewportOffset: 0,
        scrollbackLength: 0,
        isAtBottom: true,
      }),
    setScrollOffset: () => Effect.void,
    setUpdateEnabled: () => Effect.void,
    getEmulator: () => Effect.die(new Error("No emulator in test layer")),
    destroyAll: () => Effect.void,
    listAll: () => Effect.succeed([]),
    getForegroundProcess: () => Effect.succeed(undefined),
    getGitBranch: () => Effect.succeed(undefined),
    subscribeToLifecycle: () => Effect.succeed(() => {}),
    getTitle: () => Effect.succeed(""),
    subscribeToTitleChange: () => Effect.succeed(() => {}),
    subscribeToAllTitleChanges: () => Effect.succeed(() => {}),
  })
}
