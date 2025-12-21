import { Effect } from "effect"
import { runEffect } from "../../runtime"
import { Pty } from "../../services"
import { PtyId } from "../../types"
import type { TerminalState, UnifiedTerminalUpdate, TerminalCell } from "../../../core/types"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"

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
 * Prefetch scrollback lines into the emulator's cache.
 * Used to load scrollback lines before they're needed for rendering.
 * For WorkerEmulator, this fetches lines from the worker thread.
 */
export async function prefetchScrollbackLines(
  ptyId: string,
  startOffset: number,
  count: number
): Promise<void> {
  try {
    await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const emulator = yield* pty.getEmulator(PtyId.make(ptyId))
        if ('prefetchScrollbackLines' in emulator && typeof emulator.prefetchScrollbackLines === 'function') {
          yield* Effect.promise(() => (emulator as {
            prefetchScrollbackLines: (start: number, count: number) => Promise<void>
          }).prefetchScrollbackLines(startOffset, count))
        }
      })
    )
  } catch {
    // Ignore errors - prefetch is best-effort
  }
}

/**
 * Get the terminal emulator instance for direct access.
 * Primarily used for scrollback rendering in TerminalView.
 * Should be called once and cached for sync access in render loops.
 */
export async function getEmulator(
  ptyId: string
): Promise<ITerminalEmulator | null> {
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
