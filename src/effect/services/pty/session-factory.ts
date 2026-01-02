/**
 * PTY Session Factory - creates new PTY sessions with all required components
 */
import { Effect } from "effect"
import { spawnAsync } from "../../../../native/zig-pty/ts/index"
import { createGhosttyVTEmulator } from "../../../terminal/ghostty-vt/emulator"
import { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"
import { createSyncModeParser } from "../../../terminal/sync-mode-parser"
import { getCapabilityEnvironment } from "../../../terminal/capabilities"
import { createCommandParser } from "../../../terminal/command-parser"
import { PtySpawnError } from "../../errors"
import type { PtyId, Cols, Rows} from "../../types";
import { makePtyId } from "../../types"
import type { InternalPtySession } from "./types"
import type { TerminalColors } from "../../../terminal/terminal-colors"
import { tracePtyEvent } from "../../../terminal/pty-trace"
import { notifySubscribers } from "./notification"
import { createDataHandler } from "./data-handler"
import { setupQueryPassthrough } from "./query-setup"
import { prepareShellIntegration } from "./shell-integration"

const DEFAULT_CELL_WIDTH = 8
const DEFAULT_CELL_HEIGHT = 16


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
  pixelWidth?: number
  pixelHeight?: number
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
    const hasPixels = typeof options.pixelWidth === "number"
      && options.pixelWidth > 0
      && typeof options.pixelHeight === "number"
      && options.pixelHeight > 0
    const pixelWidth = hasPixels ? options.pixelWidth : undefined
    const pixelHeight = hasPixels ? options.pixelHeight : undefined
    const cellWidth = hasPixels ? Math.max(1, Math.floor((pixelWidth ?? 0) / cols)) : DEFAULT_CELL_WIDTH
    const cellHeight = hasPixels ? Math.max(1, Math.floor((pixelHeight ?? 0) / rows)) : DEFAULT_CELL_HEIGHT
    const cwd = options.cwd ?? process.cwd()
    const shell = deps.defaultShell
    const shellName = shell.split('/').pop() ?? ''

    // Create native emulator (libghostty-vt)
    const emulator = yield* Effect.try({
      try: () => createGhosttyVTEmulator(cols, rows, deps.colors),
      catch: (error) =>
        PtySpawnError.make({ shell, cwd, cause: error }),
    })
    emulator.setUpdateEnabled?.(false)

    // Create terminal query passthrough for handling terminal queries
    const queryPassthrough = new TerminalQueryPassthrough()

    // Get capability environment
    const capabilityEnv = getCapabilityEnvironment()

    // Spawn PTY asynchronously (fork happens off main thread)
    const baseEnv = {
      ...process.env,
      ...capabilityEnv,
      ...options.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>

    const shellLaunch = prepareShellIntegration(shell, baseEnv)
    const pty = yield* Effect.tryPromise({
      try: () =>
        spawnAsync(shell, shellLaunch.args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env: shellLaunch.env,
        }),
      catch: (error) =>
        PtySpawnError.make({ shell, cwd, cause: error }),
    })

    if (hasPixels && "resizeWithPixels" in pty) {
      yield* Effect.try({
        try: () => {
          pty.resizeWithPixels(cols, rows, pixelWidth!, pixelHeight!)
        },
        catch: () => new Error("resizeWithPixels failed"),
      }).pipe(
        Effect.catchAll(() => Effect.void)
      )
    }

    const session: InternalPtySession = {
      id,
      pty,
      emulator,
      queryPassthrough,
      kittyRelayDispose: undefined,
      cols,
      rows,
      cellWidth,
      cellHeight,
      pixelWidth: hasPixels ? pixelWidth! : cols * DEFAULT_CELL_WIDTH,
      pixelHeight: hasPixels ? pixelHeight! : rows * DEFAULT_CELL_HEIGHT,
      cwd,
      shell,
      closing: false,
      subscribers: new Set(),
      scrollSubscribers: new Set(),
      unifiedSubscribers: new Set(),
      exitCallbacks: new Set(),
      titleSubscribers: new Set(),
      lastCommand: null,
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

    emulator.setPixelSize?.(session.pixelWidth, session.pixelHeight)

    // Set up query passthrough
    const kittyRelayDispose = setupQueryPassthrough({
      queryPassthrough,
      emulator,
      pty,
      ptyId: id,
      getSessionDimensions: () => ({ cols: session.cols, rows: session.rows }),
      getPixelDimensions: () => ({
        pixelWidth: session.pixelWidth,
        pixelHeight: session.pixelHeight,
        cellWidth: session.cellWidth,
        cellHeight: session.cellHeight,
      }),
    })
    if (kittyRelayDispose) {
      session.kittyRelayDispose = kittyRelayDispose
    }

    // Create sync mode parser for DEC Mode 2026 (synchronized output)
    const syncParser = createSyncModeParser()

    const commandParser = createCommandParser({
      shellName,
      onCommand: (command: string) => {
        session.lastCommand = command
      },
    })

    // Set up data handler
    const { handleData } = createDataHandler({
      session,
      syncParser,
      commandParser,
    })

    // Wire up PTY data handler
    pty.onData(handleData)

    // Wire up mode change handler for DECSET 2048 (in-band resize notifications)
    emulator.onModeChange((modes, prevModes) => {
      if (modes.inBandResize && !prevModes?.inBandResize) {
        // Mode just got enabled - send initial size notification
        const resizeNotification =
          `\x1b[48;${session.rows};${session.cols};${session.pixelHeight};${session.pixelWidth}t`
        pty.write(resizeNotification)
      }
    })

    // Wire up exit handler
    pty.onExit(({ exitCode }) => {
      if (session.closing) {
        return
      }
      tracePtyEvent("pty-exit", { ptyId: id, exitCode })
      for (const callback of session.exitCallbacks) {
        callback(exitCode)
      }
      deps.onExit?.(id, exitCode)
    })

    return { id, session }
  })
}
