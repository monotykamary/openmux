/**
 * PTY Session Factory - creates new PTY sessions with all required components
 */
import { Effect } from "effect"
import { spawnAsync } from "../../../../zig-pty/ts/index"
import { createGhosttyVTEmulator } from "../../../terminal/ghostty-vt/emulator"
import { GraphicsPassthrough } from "../../../terminal/graphics-passthrough"
import { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"
import { createSyncModeParser } from "../../../terminal/sync-mode-parser"
import { getCapabilityEnvironment } from "../../../terminal/capabilities"
import { PtySpawnError } from "../../errors"
import type { PtyId, Cols, Rows} from "../../types";
import { makePtyId } from "../../types"
import type { InternalPtySession } from "./types"
import type { TerminalColors } from "../../../terminal/terminal-colors"
import { notifySubscribers } from "./notification"
import { createDataHandler } from "./data-handler"
import { setupQueryPassthrough } from "./query-setup"


export interface SessionFactoryDeps {
  colors: TerminalColors
  defaultShell: string
  onLifecycleEvent: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => Effect.Effect<void>
  onTitleChange: (ptyId: PtyId, title: string) => void
  onExit?: (ptyId: PtyId, exitCode: number) => void
}

export interface CreateSessionOptions {
  cols: Cols
  rows: Rows
  cwd?: string
  env?: Record<string, string>
}

/**
 * Creates a new PTY session with emulator, graphics passthrough, and query handling
 */
export function createSession(
  deps: SessionFactoryDeps,
  options: CreateSessionOptions
): Effect.Effect<{ id: PtyId; session: InternalPtySession }, PtySpawnError> {
  return Effect.gen(function* () {
    const id = makePtyId()
    const cols = options.cols
    const rows = options.rows
    const cwd = options.cwd ?? process.cwd()
    const shell = deps.defaultShell

    // Create native emulator (libghostty-vt)
    const emulator = yield* Effect.try({
      try: () => createGhosttyVTEmulator(cols, rows, deps.colors),
      catch: (error) =>
        PtySpawnError.make({ shell, cwd, cause: error }),
    })
    emulator.setUpdateEnabled?.(false)

    // Create graphics passthrough
    const graphicsPassthrough = new GraphicsPassthrough()

    // Create terminal query passthrough for handling terminal queries
    const queryPassthrough = new TerminalQueryPassthrough()

    // Get capability environment
    const capabilityEnv = getCapabilityEnvironment()

    // Spawn PTY asynchronously (fork happens off main thread)
    const pty = yield* Effect.tryPromise({
      try: () =>
        spawnAsync(shell, [], {
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
      closing: false,
      subscribers: new Set(),
      scrollSubscribers: new Set(),
      unifiedSubscribers: new Set(),
      exitCallbacks: new Set(),
      titleSubscribers: new Set(),
      pendingNotify: false,
      scrollState: { viewportOffset: 0, lastScrollbackLength: 0 },
    }

    // Subscribe to emulator title changes and propagate to subscribers
    emulator.onTitleChange((title: string) => {
      // Notify per-PTY title subscribers
      for (const callback of session.titleSubscribers) {
        callback(title)
      }
      // Notify global title subscribers
      deps.onTitleChange(id, title)
    })

    // Subscribe to emulator updates (drives unified subscribers)
    emulator.onUpdate(() => {
      notifySubscribers(session)
    })

    // Set up query passthrough
    setupQueryPassthrough({
      queryPassthrough,
      emulator,
      pty,
      getSessionDimensions: () => ({ cols: session.cols, rows: session.rows }),
    })

    // Create sync mode parser for DEC Mode 2026 (synchronized output)
    const syncParser = createSyncModeParser()

    // Set up data handler
    const { handleData } = createDataHandler({
      session,
      syncParser,
    })

    // Wire up PTY data handler
    pty.onData(handleData)

    // Wire up mode change handler for DECSET 2048 (in-band resize notifications)
    emulator.onModeChange((modes, prevModes) => {
      if (modes.inBandResize && !prevModes?.inBandResize) {
        // Mode just got enabled - send initial size notification
        const cellWidth = 8
        const cellHeight = 16
        const pixelWidth = session.cols * cellWidth
        const pixelHeight = session.rows * cellHeight
        const resizeNotification = `\x1b[48;${session.rows};${session.cols};${pixelHeight};${pixelWidth}t`
        pty.write(resizeNotification)
      }
    })

    // Wire up exit handler
    pty.onExit(({ exitCode }) => {
      if (session.closing) {
        return
      }
      for (const callback of session.exitCallbacks) {
        callback(exitCode)
      }
      deps.onExit?.(id, exitCode)
    })

    return { id, session }
  })
}
