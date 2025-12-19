/**
 * PTY service for managing terminal pseudo-terminal sessions.
 * Wraps zig-pty with ghostty-web VT parsing.
 */
import { Context, Effect, Layer, Ref, HashMap, Option } from "effect"
import type { TerminalState, UnifiedTerminalUpdate } from "../../core/types"
import type { ITerminalEmulator } from "../../terminal/emulator-interface"
import { getWorkerPool, initWorkerPool } from "../../terminal/worker-pool"
import { getHostColors, getDefaultColors } from "../../terminal/terminal-colors"
import { PtySpawnError, PtyNotFoundError, PtyCwdError } from "../errors"
import { PtyId, Cols, Rows, makePtyId } from "../types"
import { PtySession } from "../models"
import { AppConfig } from "../Config"

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

      // Initialize worker pool for terminal emulation
      yield* Effect.promise(() => initWorkerPool(2))
      const workerPool = getWorkerPool()

      // Get host colors (required for worker emulator)
      const colors = getHostColors() ?? getDefaultColors()

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

      // Create session factory
      const create = Effect.fn("Pty.create")(function* (options: {
        cols: Cols
        rows: Rows
        cwd?: string
        env?: Record<string, string>
      }) {
        const { id, session } = yield* createSession(
          {
            workerPool,
            colors,
            defaultShell: config.defaultShell,
            onLifecycleEvent: (event) => lifecycleRegistry.notify(event),
            onTitleChange: (ptyId, title) => globalTitleRegistry.notifySync({ ptyId, title }),
          },
          options
        )

        // Store session
        yield* Ref.update(sessionsRef, HashMap.set(id, session))

        // Emit lifecycle event
        yield* lifecycleRegistry.notify({ type: 'created', ptyId: id })

        return id
      })

      // Create operations using factory
      const operations = createOperations({
        sessionsRef,
        getSessionOrFail,
        lifecycleRegistry,
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
