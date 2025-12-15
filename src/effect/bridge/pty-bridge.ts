/**
 * PTY bridge functions
 * Wraps Effect Pty service for async/await usage
 */

import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../runtime"
import { Pty } from "../services"
import { PtyId, Cols, Rows } from "../types"
import type { TerminalState, UnifiedTerminalUpdate, TerminalCell } from "../../core/types"
import type { GhosttyEmulator } from "../../terminal/ghostty-emulator"

/**
 * Create a PTY session using Effect service.
 */
export async function createPtySession(options: {
  cols: number
  rows: number
  cwd?: string
}): Promise<string> {
  return runEffect(
    Effect.gen(function* () {
      const pty = yield* Pty
      const ptyId = yield* pty.create({
        cols: Cols.make(options.cols),
        rows: Rows.make(options.rows),
        cwd: options.cwd,
      })
      return ptyId
    })
  )
}

/**
 * Write data to a PTY session.
 */
export async function writeToPty(ptyId: string, data: string): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.write(PtyId.make(ptyId), data)
    })
  )
}

/**
 * Resize a PTY session.
 */
export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number
): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.resize(PtyId.make(ptyId), Cols.make(cols), Rows.make(rows))
    })
  )
}

/**
 * Get the current working directory of a PTY session.
 */
export async function getPtyCwd(ptyId: string): Promise<string> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getCwd(PtyId.make(ptyId))
      })
    )
  } catch {
    return process.cwd()
  }
}

/**
 * Destroy a PTY session.
 */
export async function destroyPty(ptyId: string): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.destroy(PtyId.make(ptyId))
    })
  )
}

/**
 * Destroy all PTY sessions.
 */
export async function destroyAllPtys(): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.destroyAll()
    })
  )
}

/**
 * Get terminal state for a PTY session.
 */
export async function getTerminalState(ptyId: string): Promise<TerminalState | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getTerminalState(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}

/**
 * Register an exit callback for a PTY session.
 * Returns an unsubscribe function.
 */
export async function onPtyExit(
  ptyId: string,
  callback: (exitCode: number) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.onExit(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Set pane position for graphics passthrough.
 */
export async function setPanePosition(
  ptyId: string,
  x: number,
  y: number
): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.setPanePosition(PtyId.make(ptyId), x, y)
    })
  )
}

/**
 * Get scroll state for a PTY session.
 */
export async function getScrollState(
  ptyId: string
): Promise<{ viewportOffset: number; scrollbackLength: number; isAtBottom: boolean } | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getScrollState(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}

/**
 * Set scroll offset for a PTY session.
 */
export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.setScrollOffset(PtyId.make(ptyId), offset)
    })
  )
}

/**
 * Scroll terminal to bottom (live content).
 */
export async function scrollToBottom(ptyId: string): Promise<void> {
  await setScrollOffset(ptyId, 0)
}

/**
 * Subscribe to terminal state updates.
 * Returns an unsubscribe function.
 */
export async function subscribeToPty(
  ptyId: string,
  callback: (state: TerminalState) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribe(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Subscribe to scroll state changes (lightweight - no terminal state rebuild).
 * Returns an unsubscribe function.
 */
export async function subscribeToScroll(
  ptyId: string,
  callback: () => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeToScroll(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Subscribe to unified terminal + scroll updates.
 * More efficient than separate subscriptions - eliminates race conditions
 * and reduces render cycles by delivering both state changes in one callback.
 * Returns an unsubscribe function.
 */
export async function subscribeUnifiedToPty(
  ptyId: string,
  callback: (update: UnifiedTerminalUpdate) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeUnified(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Get a scrollback line from the terminal emulator.
 * Returns null if the line doesn't exist or the PTY is not found.
 */
export async function getScrollbackLine(
  ptyId: string,
  lineIndex: number
): Promise<TerminalCell[] | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const emulator = yield* pty.getEmulator(PtyId.make(ptyId))
        return emulator.getScrollbackLine(lineIndex)
      })
    )
  } catch {
    return null
  }
}

/**
 * Get the terminal emulator instance for direct access.
 * Primarily used for scrollback rendering in TerminalView.
 * Should be called once and cached for sync access in render loops.
 */
export async function getEmulator(
  ptyId: string
): Promise<GhosttyEmulator | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getEmulator(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}
