/**
 * PTY service for managing terminal pseudo-terminal sessions.
 * Wraps zig-pty with ghostty-web VT parsing.
 */
import { Context, Effect, Layer, Stream, Queue, Ref, HashMap, Option } from "effect"
import { spawn, type IPty } from "../../../zig-pty/src/index"
import type { TerminalState, UnifiedTerminalUpdate, TerminalScrollState } from "../../core/types"
import { GhosttyEmulator } from "../../terminal/ghostty-emulator"
import { GraphicsPassthrough } from "../../terminal/graphics-passthrough"
import { TerminalQueryPassthrough } from "../../terminal/terminal-query-passthrough"
import { createSyncModeParser, type SyncModeParser } from "../../terminal/sync-mode-parser"
import { getCapabilityEnvironment } from "../../terminal/capabilities"
import { getHostColors } from "../../terminal/terminal-colors"
import { PtySpawnError, PtyNotFoundError, PtyCwdError } from "../errors"
import { PtyId, Cols, Rows, makePtyId } from "../types"
import { PtySession } from "../models"
import { AppConfig } from "../Config"

// =============================================================================
// Internal Types
// =============================================================================

interface InternalPtySession {
  id: PtyId
  pty: IPty
  emulator: GhosttyEmulator
  graphicsPassthrough: GraphicsPassthrough
  queryPassthrough: TerminalQueryPassthrough
  cols: number
  rows: number
  cwd: string
  shell: string
  subscribers: Set<(state: TerminalState) => void>
  scrollSubscribers: Set<() => void>
  /** Unified subscribers receive both terminal and scroll updates in one callback */
  unifiedSubscribers: Set<(update: UnifiedTerminalUpdate) => void>
  exitCallbacks: Set<(exitCode: number) => void>
  pendingNotify: boolean
  scrollState: {
    viewportOffset: number
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Get the current working directory of a process by PID */
const getProcessCwd = (pid: number): Effect.Effect<string, PtyCwdError> =>
  Effect.tryPromise({
    try: async () => {
      const platform = process.platform

      if (platform === "darwin") {
        const proc = Bun.spawn(
          ["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"],
          { stdout: "pipe", stderr: "pipe" }
        )
        const output = await new Response(proc.stdout).text()
        await proc.exited

        const lines = output.split("\n")
        for (const line of lines) {
          if (line.startsWith("n/")) {
            return line.slice(1)
          }
        }
        throw new Error("Could not parse lsof output")
      } else if (platform === "linux") {
        const proc = Bun.spawn(["readlink", "-f", `/proc/${pid}/cwd`], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const output = await new Response(proc.stdout).text()
        await proc.exited
        const result = output.trim()
        if (!result) throw new Error("Empty readlink result")
        return result
      }

      throw new Error(`Unsupported platform: ${platform}`)
    },
    catch: (error) =>
      PtyCwdError.make({
        ptyId: PtyId.make(`pid-${pid}`),
        cause: error,
      }),
  })

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
    readonly getEmulator: (id: PtyId) => Effect.Effect<GhosttyEmulator, PtyNotFoundError>

    /** Destroy all sessions */
    readonly destroyAll: () => Effect.Effect<void>
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

      // Helper to get current scroll state
      const getCurrentScrollState = (session: InternalPtySession): TerminalScrollState => {
        const scrollbackLength = session.emulator.getScrollbackLength()
        return {
          viewportOffset: session.scrollState.viewportOffset,
          scrollbackLength,
          isAtBottom: session.scrollState.viewportOffset === 0,
        }
      }

      // Helper to notify subscribers (for terminal state changes)
      const notifySubscribers = (session: InternalPtySession) => {
        // Notify unified subscribers first (uses dirty delta for efficiency)
        if (session.unifiedSubscribers.size > 0) {
          const scrollState = getCurrentScrollState(session)
          const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
          const unifiedUpdate: UnifiedTerminalUpdate = {
            terminalUpdate: dirtyUpdate,
            scrollState,
          }
          for (const callback of session.unifiedSubscribers) {
            callback(unifiedUpdate)
          }
        }

        // Legacy subscribers still get full state
        if (session.subscribers.size > 0) {
          const state = session.emulator.getTerminalState()
          for (const callback of session.subscribers) {
            callback(state)
          }
        }
      }

      // Helper to notify scroll subscribers (lightweight - no state rebuild)
      const notifyScrollSubscribers = (session: InternalPtySession) => {
        // Notify unified subscribers with scroll-only update
        if (session.unifiedSubscribers.size > 0) {
          const scrollState = getCurrentScrollState(session)
          // For scroll-only updates, we can create a minimal dirty update
          const dirtyUpdate = session.emulator.getDirtyUpdate(scrollState)
          const unifiedUpdate: UnifiedTerminalUpdate = {
            terminalUpdate: dirtyUpdate,
            scrollState,
          }
          for (const callback of session.unifiedSubscribers) {
            callback(unifiedUpdate)
          }
        }

        // Legacy scroll subscribers
        for (const callback of session.scrollSubscribers) {
          callback()
        }
      }

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

        // Get host colors if available
        const colors = getHostColors() ?? undefined

        // Create ghostty emulator
        const emulator = yield* Effect.try({
          try: () => new GhosttyEmulator({ cols, rows, colors }),
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
          pendingNotify: false,
          scrollState: { viewportOffset: 0 },
        }

        // Set up query passthrough - writes responses back to PTY
        queryPassthrough.setPtyWriter((response: string) => {
          pty.write(response)
        })
        queryPassthrough.setCursorGetter(() => {
          const cursor = emulator.getCursor()
          return { x: cursor.x, y: cursor.y }
        })
        queryPassthrough.setColorsGetter(() => {
          const termColors = emulator.getColors()
          return {
            foreground: termColors.foreground,
            background: termColors.background,
          }
        })
        // Set mode getter to query DEC private modes from emulator
        queryPassthrough.setModeGetter((mode: number) => {
          // Query the mode from ghostty emulator
          // Returns true if set, false if reset
          try {
            return emulator.getMode(mode)
          } catch {
            return null
          }
        })
        // Set terminal version for XTVERSION responses
        queryPassthrough.setTerminalVersion('0.1.16')
        // Set size getter for XTWINOPS queries
        queryPassthrough.setSizeGetter(() => {
          // Estimate cell size (typical terminal font is ~8x16 pixels)
          const cellWidth = 8;
          const cellHeight = 16;
          return {
            cols: session.cols,
            rows: session.rows,
            pixelWidth: session.cols * cellWidth,
            pixelHeight: session.rows * cellHeight,
            cellWidth,
            cellHeight,
          }
        })

        // Pending data buffer for batched writes
        let pendingData = ''

        // Sync mode parser for DEC Mode 2026 (synchronized output)
        // Buffers content between sync start/end for atomic frame rendering
        const syncParser = createSyncModeParser()

        // Timeout to prevent infinite buffering if sync mode is never closed
        let syncTimeout: ReturnType<typeof setTimeout> | null = null
        const SYNC_TIMEOUT_MS = 100 // Safety flush after 100ms

        // Track DECSET 2048 state for initial notification (in-band resize mode)
        // When mode 2048 is enabled, apps like Neovim expect CSI 48 notifications
        // instead of relying on SIGWINCH signals for resize detection
        let lastInBandResizeMode = false
        // Track if pending data might contain DECSET 2048 enable sequence
        let pendingMightEnable2048 = false

        // Helper to schedule notification (extracted for reuse)
        // Uses queueMicrotask for tighter timing - runs before next event loop tick
        const scheduleNotify = () => {
          if (!session.pendingNotify) {
            session.pendingNotify = true
            queueMicrotask(() => {
              // Capture whether we need to check for DECSET 2048 mode transition
              const checkFor2048 = pendingMightEnable2048
              pendingMightEnable2048 = false

              // Write all pending data at once
              if (pendingData.length > 0) {
                // Capture scrollback length before write to detect new lines
                const scrollbackBefore = session.emulator.getScrollbackLength()

                session.emulator.write(pendingData)
                pendingData = ''

                // If user is scrolled back, adjust offset to maintain view position
                // when new lines are added to scrollback (prevents content from shifting up)
                if (session.scrollState.viewportOffset > 0) {
                  const scrollbackAfter = session.emulator.getScrollbackLength()
                  const scrollbackDelta = scrollbackAfter - scrollbackBefore
                  if (scrollbackDelta > 0) {
                    session.scrollState.viewportOffset += scrollbackDelta
                  }
                }
              }

              // Check for DECSET 2048 mode transition AFTER data is written to emulator
              // Per the spec, when mode 2048 is enabled, we must immediately send
              // a report of the current terminal size (CSI 48 notification)
              if (checkFor2048) {
                try {
                  const currentInBandMode = session.emulator.getMode(2048)
                  if (currentInBandMode && !lastInBandResizeMode) {
                    // Mode just got enabled - send initial size notification
                    const cellWidth = 8
                    const cellHeight = 16
                    const pixelWidth = session.cols * cellWidth
                    const pixelHeight = session.rows * cellHeight
                    const resizeNotification = `\x1b[48;${session.rows};${session.cols};${pixelHeight};${pixelWidth}t`
                    pty.write(resizeNotification)
                  }
                  lastInBandResizeMode = currentInBandMode
                } catch {
                  // Mode query may fail, ignore
                }
              }

              notifySubscribers(session)
              session.pendingNotify = false
            })
          }
        }

        // Wire up PTY data handler - batch both writes AND notifications
        pty.onData((data: string) => {
          // Check if this data contains DECSET 2048 (CSI ? 2048 h) - in-band resize enable
          // We need to detect mode transitions to send the initial size report
          const decset2048Pattern = /\x1b\[\?2048h/
          if (decset2048Pattern.test(data)) {
            pendingMightEnable2048 = true
          }

          // First, handle terminal queries (cursor position, device attributes, colors, etc.)
          // This must happen before graphics passthrough to intercept queries
          const afterQueries = session.queryPassthrough.process(data)

          // Then handle graphics passthrough (Kitty graphics, Sixel)
          const textData = session.graphicsPassthrough.process(afterQueries)

          // Process through sync mode parser to respect frame boundaries
          // This buffers content between CSI ? 2026 h and CSI ? 2026 l
          const { readySegments, isBuffering } = syncParser.process(textData)

          // Handle sync buffering timeout (safety valve)
          if (isBuffering) {
            if (!syncTimeout) {
              syncTimeout = setTimeout(() => {
                // Safety flush - sync mode took too long (app may have crashed)
                const flushed = syncParser.flush()
                if (flushed.length > 0) {
                  pendingData += flushed
                  scheduleNotify()
                }
                syncTimeout = null
              }, SYNC_TIMEOUT_MS)
            }
          } else if (syncTimeout) {
            clearTimeout(syncTimeout)
            syncTimeout = null
          }

          // Add ready segments to pending data
          for (const segment of readySegments) {
            if (segment.length > 0) {
              pendingData += segment
            }
          }

          // Only schedule notification if we have data and aren't buffering
          // When buffering, we wait for the complete frame before notifying
          if (!isBuffering && pendingData.length > 0) {
            scheduleNotify()
          }
        })

        // Wire up exit handler
        pty.onExit(({ exitCode }) => {
          for (const callback of session.exitCallbacks) {
            callback(exitCode)
          }
        })

        // Store session
        yield* Ref.update(sessionsRef, HashMap.set(id, session))

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
        try {
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
        } catch {
          // Mode query may fail on some emulator configurations, ignore
        }

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

          // Kill PTY and dispose emulator and query passthrough
          session.pty.kill()
          session.emulator.dispose()
          session.queryPassthrough.dispose()

          // Remove from map
          yield* Ref.update(sessionsRef, HashMap.remove(id))
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
  })
}
