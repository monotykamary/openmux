/**
 * PTY service for managing terminal pseudo-terminal sessions.
 * Wraps bun-pty with ghostty-web VT parsing.
 */
import { Context, Effect, Layer, Stream, Queue, Ref, HashMap, Option } from "effect"
import { spawn, type IPty } from "bun-pty"
import type { TerminalState } from "../../core/types"
import { GhosttyEmulator } from "../../terminal/ghostty-emulator"
import { GraphicsPassthrough } from "../../terminal/graphics-passthrough"
import { DsrPassthrough } from "../../terminal/dsr-passthrough"
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
  dsrPassthrough: DsrPassthrough
  cols: number
  rows: number
  cwd: string
  shell: string
  subscribers: Set<(state: TerminalState) => void>
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

      // Helper to notify subscribers
      const notifySubscribers = (session: InternalPtySession) => {
        const state = session.emulator.getTerminalState()
        for (const callback of session.subscribers) {
          callback(state)
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

        // Create DSR passthrough for cursor position queries
        const dsrPassthrough = new DsrPassthrough()

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
          dsrPassthrough,
          cols,
          rows,
          cwd,
          shell,
          subscribers: new Set(),
          exitCallbacks: new Set(),
          pendingNotify: false,
          scrollState: { viewportOffset: 0 },
        }

        // Set up DSR passthrough - writes responses back to PTY
        dsrPassthrough.setPtyWriter((response: string) => {
          pty.write(response)
        })
        dsrPassthrough.setCursorGetter(() => {
          const cursor = emulator.getCursor()
          return { x: cursor.x, y: cursor.y }
        })
        dsrPassthrough.setColorsGetter(() => {
          const termColors = emulator.getColors()
          return {
            foreground: termColors.foreground,
            background: termColors.background,
          }
        })
        // Set mode getter to query DEC private modes from emulator
        dsrPassthrough.setModeGetter((mode: number) => {
          // Query the mode from ghostty emulator
          // Returns true if set, false if reset
          try {
            return emulator.getMode(mode)
          } catch {
            return null
          }
        })
        // Set terminal version for XTVERSION responses
        dsrPassthrough.setTerminalVersion('0.1.16')

        // Pending data buffer for batched writes
        let pendingData = ''

        // Wire up PTY data handler - batch both writes AND notifications
        pty.onData((data: string) => {
          // First, handle DSR queries (cursor position, device status)
          // This must happen before graphics passthrough to intercept queries
          const afterDsr = session.dsrPassthrough.process(data)

          // Then handle graphics passthrough (Kitty graphics, Sixel)
          const textData = session.graphicsPassthrough.process(afterDsr)
          if (textData.length > 0) {
            pendingData += textData
          }

          // Batch writes and notifications together
          if (!session.pendingNotify) {
            session.pendingNotify = true
            setImmediate(() => {
              // Write all pending data at once
              if (pendingData.length > 0) {
                session.emulator.write(pendingData)
                pendingData = ''
              }
              notifySubscribers(session)
              session.pendingNotify = false
            })
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
          notifySubscribers(session)
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

          // Kill PTY and dispose emulator and DSR passthrough
          session.pty.kill()
          session.emulator.dispose()
          session.dsrPassthrough.dispose()

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
        notifySubscribers(session)
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
