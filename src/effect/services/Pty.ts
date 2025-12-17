/**
 * PTY service for managing terminal pseudo-terminal sessions.
 * Wraps zig-pty with ghostty-web VT parsing.
 */
import { Context, Effect, Layer, Ref, HashMap, Option } from "effect"
import { spawn } from "../../../zig-pty/src/index"
import type { TerminalState, UnifiedTerminalUpdate } from "../../core/types"
import type { ITerminalEmulator } from "../../terminal/emulator-interface"
import { createWorkerEmulator } from "../../terminal/worker-emulator"
import { getWorkerPool, initWorkerPool } from "../../terminal/worker-pool"
import { GraphicsPassthrough } from "../../terminal/graphics-passthrough"
import { TerminalQueryPassthrough } from "../../terminal/terminal-query-passthrough"
import { createSyncModeParser } from "../../terminal/sync-mode-parser"
import { getCapabilityEnvironment } from "../../terminal/capabilities"
import { getHostColors, getDefaultColors } from "../../terminal/terminal-colors"
import { PtySpawnError, PtyNotFoundError, PtyCwdError } from "../errors"
import { PtyId, Cols, Rows, makePtyId } from "../types"
import { PtySession } from "../models"
import { AppConfig } from "../Config"

// Import extracted modules
import type { InternalPtySession } from "./pty/types"
import { getForegroundProcess, getGitBranch, getProcessCwd } from "./pty/helpers"
import { getCurrentScrollState, notifySubscribers, notifyScrollSubscribers } from "./pty/notification"
import { createDataHandler } from "./pty/data-handler"
import { setupQueryPassthrough } from "./pty/query-setup"
import { makeSubscriptionRegistry } from "./pty/subscription-manager"

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

      const create = Effect.fn("Pty.create")(function* (options: {
        cols: Cols
        rows: Rows
        cwd?: string
        env?: Record<string, string>
      }) {
        const id = makePtyId()
        const cols = options.cols
        const rows = options.rows
        const cwd = options.cwd ?? process.cwd()
        const shell = config.defaultShell

        // Get host colors (required for worker emulator)
        const colors = getHostColors() ?? getDefaultColors()

        // Create worker-based emulator
        const emulator = yield* Effect.tryPromise({
          try: () => createWorkerEmulator(workerPool, cols, rows, colors),
          catch: (error) =>
            PtySpawnError.make({ shell, cwd, cause: error }),
        })

        // Create graphics passthrough
        const graphicsPassthrough = new GraphicsPassthrough()

        // Create terminal query passthrough for handling terminal queries
        const queryPassthrough = new TerminalQueryPassthrough()

        // Get capability environment
        const capabilityEnv = getCapabilityEnvironment()

        // Spawn PTY
        const pty = yield* Effect.try({
          try: () =>
            spawn(shell, [], {
              name: "xterm-256color",
              cols,
              rows,
              cwd,
              env: {
                ...process.env,
                ...capabilityEnv,
                ...options.env,
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
              } as Record<string, string>,
            }),
          catch: (error) =>
            PtySpawnError.make({ shell, cwd, cause: error }),
        })

        const session: InternalPtySession = {
          id,
          pty,
          emulator,
          graphicsPassthrough,
          queryPassthrough,
          cols,
          rows,
          cwd,
          shell,
          subscribers: new Set(),
          scrollSubscribers: new Set(),
          unifiedSubscribers: new Set(),
          exitCallbacks: new Set(),
          titleSubscribers: new Set(),
          pendingNotify: false,
          scrollState: { viewportOffset: 0 },
        }

        // Subscribe to emulator title changes and propagate to subscribers
        emulator.onTitleChange((title: string) => {
          // Notify per-PTY title subscribers
          for (const callback of session.titleSubscribers) {
            callback(title)
          }
          // Notify global title subscribers (sync for non-Effect callback context)
          globalTitleRegistry.notifySync({ ptyId: id, title })
        })

        // Subscribe to emulator updates (critical for async workers)
        // This fires when write() processing completes, enabling proper notification timing
        emulator.onUpdate(() => {
          notifySubscribers(session)
        })

        // Set up query passthrough using extracted helper
        setupQueryPassthrough({
          queryPassthrough,
          emulator,
          pty,
          getSessionDimensions: () => ({ cols: session.cols, rows: session.rows }),
        })

        // Create sync mode parser for DEC Mode 2026 (synchronized output)
        const syncParser = createSyncModeParser()

        // Set up data handler using extracted helper
        const { handleData } = createDataHandler({
          session,
          pty,
          syncParser,
        })

        // Wire up PTY data handler
        pty.onData(handleData)

        // Wire up exit handler
        pty.onExit(({ exitCode }) => {
          for (const callback of session.exitCallbacks) {
            callback(exitCode)
          }
        })

        // Store session
        yield* Ref.update(sessionsRef, HashMap.set(id, session))

        // Emit lifecycle event using registry
        yield* lifecycleRegistry.notify({ type: 'created', ptyId: id })

        return id
      })

      const write = Effect.fn("Pty.write")(function* (id: PtyId, data: string) {
        const session = yield* getSessionOrFail(id)

        // Auto-scroll to bottom when user types
        if (session.scrollState.viewportOffset > 0) {
          session.scrollState.viewportOffset = 0
          // Notify both terminal state and scroll subscribers
          notifySubscribers(session)
          notifyScrollSubscribers(session)
        }

        session.pty.write(data)
      })

      const resize = Effect.fn("Pty.resize")(function* (
        id: PtyId,
        cols: Cols,
        rows: Rows
      ) {
        const session = yield* getSessionOrFail(id)

        session.pty.resize(cols, rows)
        session.cols = cols
        session.rows = rows
        session.emulator.resize(cols, rows)

        // Check if DECSET 2048 (in-band resize notifications) is enabled.
        // When enabled, the terminal must send CSI 48 resize notifications
        // instead of relying on SIGWINCH. This is used by Neovim and other
        // applications that prefer escape sequence-based resize detection.
        // Format: CSI 48 ; height ; width ; pixelHeight ; pixelWidth t
        yield* Effect.try(() => {
          const inBandResizeEnabled = session.emulator.getMode(2048)
          if (inBandResizeEnabled) {
            // Estimate cell size (typical terminal font is ~8x16 pixels)
            const cellWidth = 8
            const cellHeight = 16
            const pixelWidth = cols * cellWidth
            const pixelHeight = rows * cellHeight
            const resizeNotification = `\x1b[48;${rows};${cols};${pixelHeight};${pixelWidth}t`
            session.pty.write(resizeNotification)
          }
        }).pipe(Effect.ignore)

        notifySubscribers(session)
      })

      const getCwd = Effect.fn("Pty.getCwd")(function* (id: PtyId) {
        const session = yield* getSessionOrFail(id)

        if (session.pty.pid === undefined) {
          return session.cwd
        }

        return yield* getProcessCwd(session.pty.pid).pipe(
          Effect.catchAll(() => Effect.succeed(session.cwd))
        )
      })

      const destroy = Effect.fn("Pty.destroy")(function* (id: PtyId) {
        const sessions = yield* Ref.get(sessionsRef)
        const sessionOpt = HashMap.get(sessions, id)

        if (Option.isSome(sessionOpt)) {
          const session = sessionOpt.value

          // Clear subscribers
          for (const callback of session.subscribers) {
            callback(null as unknown as TerminalState)
          }
          session.subscribers.clear()

          // Kill PTY and dispose emulator (cleans up worker session)
          session.pty.kill()
          session.emulator.dispose()
          session.queryPassthrough.dispose()

          // Remove from map BEFORE emitting lifecycle event
          // This ensures refreshPtys() sees the updated list
          yield* Ref.update(sessionsRef, HashMap.remove(id))

          // Emit lifecycle event AFTER removal so listeners see updated state
          yield* lifecycleRegistry.notify({ type: 'destroyed', ptyId: id })
        }
      })

      const getSession = Effect.fn("Pty.getSession")(function* (id: PtyId) {
        const session = yield* getSessionOrFail(id)

        return PtySession.make({
          id: session.id,
          pid: session.pty.pid ?? 0,
          cols: Cols.make(session.cols),
          rows: Rows.make(session.rows),
          cwd: session.cwd,
          shell: session.shell,
        })
      })

      const getTerminalState = Effect.fn("Pty.getTerminalState")(function* (
        id: PtyId
      ) {
        const session = yield* getSessionOrFail(id)
        return session.emulator.getTerminalState()
      })

      const subscribe = Effect.fn("Pty.subscribe")(function* (
        id: PtyId,
        callback: (state: TerminalState) => void
      ) {
        const session = yield* getSessionOrFail(id)

        session.subscribers.add(callback)
        callback(session.emulator.getTerminalState())

        return () => {
          session.subscribers.delete(callback)
        }
      })

      const onExit = Effect.fn("Pty.onExit")(function* (
        id: PtyId,
        callback: (exitCode: number) => void
      ) {
        const session = yield* getSessionOrFail(id)

        session.exitCallbacks.add(callback)

        return () => {
          session.exitCallbacks.delete(callback)
        }
      })

      const setPanePosition = Effect.fn("Pty.setPanePosition")(function* (
        id: PtyId,
        x: number,
        y: number
      ) {
        const session = yield* getSessionOrFail(id)
        session.graphicsPassthrough.setPanePosition(x, y)
      })

      const getScrollState = Effect.fn("Pty.getScrollState")(function* (
        id: PtyId
      ) {
        const session = yield* getSessionOrFail(id)
        const scrollbackLength = session.emulator.getScrollbackLength()

        return {
          viewportOffset: session.scrollState.viewportOffset,
          scrollbackLength,
          isAtBottom: session.scrollState.viewportOffset === 0,
        }
      })

      const setScrollOffset = Effect.fn("Pty.setScrollOffset")(function* (
        id: PtyId,
        offset: number
      ) {
        const session = yield* getSessionOrFail(id)
        const maxOffset = session.emulator.getScrollbackLength()
        session.scrollState.viewportOffset = Math.max(
          0,
          Math.min(offset, maxOffset)
        )
        // Use scroll-only notification - doesn't rebuild terminal state
        notifyScrollSubscribers(session)
      })

      const subscribeToScroll = Effect.fn("Pty.subscribeToScroll")(function* (
        id: PtyId,
        callback: () => void
      ) {
        const session = yield* getSessionOrFail(id)
        session.scrollSubscribers.add(callback)

        return () => {
          session.scrollSubscribers.delete(callback)
        }
      })

      const subscribeUnified = Effect.fn("Pty.subscribeUnified")(function* (
        id: PtyId,
        callback: (update: UnifiedTerminalUpdate) => void
      ) {
        const session = yield* getSessionOrFail(id)
        session.unifiedSubscribers.add(callback)

        // Send initial full state
        const scrollState = getCurrentScrollState(session)
        const fullState = session.emulator.getTerminalState()
        const initialUpdate: UnifiedTerminalUpdate = {
          terminalUpdate: {
            dirtyRows: new Map(),
            cursor: fullState.cursor,
            scrollState,
            cols: fullState.cols,
            rows: fullState.rows,
            isFull: true,
            fullState,
            alternateScreen: fullState.alternateScreen,
            mouseTracking: fullState.mouseTracking,
            cursorKeyMode: fullState.cursorKeyMode ?? 'normal',
            inBandResize: session.emulator.getMode(2048),
          },
          scrollState,
        }
        callback(initialUpdate)

        return () => {
          session.unifiedSubscribers.delete(callback)
        }
      })

      const getEmulator = Effect.fn("Pty.getEmulator")(function* (id: PtyId) {
        const session = yield* getSessionOrFail(id)
        return session.emulator
      })

      const destroyAll = Effect.fn("Pty.destroyAll")(function* () {
        const sessions = yield* Ref.get(sessionsRef)
        const ids = Array.from(HashMap.keys(sessions))

        for (const id of ids) {
          yield* destroy(id)
        }
      })

      const listAll = Effect.fn("Pty.listAll")(function* () {
        const sessions = yield* Ref.get(sessionsRef)
        return Array.from(HashMap.keys(sessions))
      })

      const getForegroundProcessFn = Effect.fn("Pty.getForegroundProcess")(function* (
        id: PtyId
      ) {
        const session = yield* getSessionOrFail(id)
        if (session.pty.pid === undefined) {
          return undefined
        }
        return yield* getForegroundProcess(session.pty.pid)
      })

      const getGitBranchFn = Effect.fn("Pty.getGitBranch")(function* (id: PtyId) {
        const session = yield* getSessionOrFail(id)
        if (session.pty.pid === undefined) {
          return undefined
        }
        // Get the CWD first
        const cwd = yield* getProcessCwd(session.pty.pid)
        return yield* getGitBranch(cwd)
      })

      const subscribeToLifecycle = Effect.fn("Pty.subscribeToLifecycle")(function* (
        callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
      ) {
        return yield* lifecycleRegistry.subscribe(callback)
      })

      const getTitleFn = Effect.fn("Pty.getTitle")(function* (id: PtyId) {
        const session = yield* getSessionOrFail(id)
        return session.emulator.getTitle()
      })

      const subscribeToTitleChange = Effect.fn("Pty.subscribeToTitleChange")(function* (
        id: PtyId,
        callback: (title: string) => void
      ) {
        const session = yield* getSessionOrFail(id)
        session.titleSubscribers.add(callback)
        // Immediately call with current title if set
        const currentTitle = session.emulator.getTitle()
        if (currentTitle) {
          callback(currentTitle)
        }
        return () => {
          session.titleSubscribers.delete(callback)
        }
      })

      const subscribeToAllTitleChanges = Effect.fn("Pty.subscribeToAllTitleChanges")(function* (
        callback: (event: { ptyId: PtyId; title: string }) => void
      ) {
        return yield* globalTitleRegistry.subscribe(callback)
      })

      return Pty.of({
        create,
        write,
        resize,
        getCwd,
        destroy,
        getSession,
        getTerminalState,
        subscribe,
        subscribeToScroll,
        subscribeUnified,
        onExit,
        setPanePosition,
        getScrollState,
        setScrollOffset,
        getEmulator,
        destroyAll,
        listAll,
        getForegroundProcess: getForegroundProcessFn,
        getGitBranch: getGitBranchFn,
        subscribeToLifecycle,
        getTitle: getTitleFn,
        subscribeToTitleChange,
        subscribeToAllTitleChanges,
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
