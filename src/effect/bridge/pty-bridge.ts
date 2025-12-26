/**
 * PTY bridge functions
 * Wraps Effect Pty service for async/await usage
 */

import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../runtime"
import { Pty } from "../services"
import { PtyId, Cols, Rows } from "../types"
import type { TerminalState, UnifiedTerminalUpdate } from "../../core/types"
import type { ITerminalEmulator } from "../../terminal/emulator-interface"

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
 * Get the foreground process name for a PTY session.
 */
export async function getPtyForegroundProcess(ptyId: string): Promise<string | undefined> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getForegroundProcess(PtyId.make(ptyId))
      })
    )
  } catch {
    return undefined
  }
}

/**
 * Destroy a PTY session.
 * This is fire-and-forget - deferred to next macrotask to avoid blocking animations.
 * Using setTimeout(0) instead of queueMicrotask because microtasks run before
 * the browser yields to rendering, so they can still cause frame drops.
 */
export function destroyPty(ptyId: string): void {
  // Defer to macrotask (setTimeout) for truly non-blocking behavior
  // Microtasks still block the current frame, macrotasks run after rendering
  setTimeout(() => {
    runEffectIgnore(
      Effect.gen(function* () {
        const pty = yield* Pty
        yield* pty.destroy(PtyId.make(ptyId))
      })
    )
  }, 0)
}

/**
 * Destroy all PTY sessions.
 * This is fire-and-forget - deferred to next macrotask to avoid blocking animations.
 */
export function destroyAllPtys(): void {
  setTimeout(() => {
    runEffectIgnore(
      Effect.gen(function* () {
        const pty = yield* Pty
        yield* pty.destroyAll()
      })
    )
  }, 0)
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

/**
 * Enable or disable terminal update notifications (visibility gating).
 */
export async function setPtyUpdateEnabled(
  ptyId: string,
  enabled: boolean
): Promise<void> {
  try {
    await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        yield* pty.setUpdateEnabled(PtyId.make(ptyId), enabled)
      })
    )
  } catch {
    // Ignore errors - best-effort toggle
  }
}

/**
 * PTY lifecycle event type
 */
export type PtyLifecycleEvent = {
  type: 'created' | 'destroyed'
  ptyId: string
}

/**
 * Subscribe to PTY lifecycle events (created/destroyed).
 * Returns an unsubscribe function.
 */
export async function subscribeToPtyLifecycle(
  callback: (event: PtyLifecycleEvent) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeToLifecycle((event) => {
          callback({ type: event.type, ptyId: event.ptyId })
        })
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Title change event for subscriptions.
 */
export interface PtyTitleChangeEvent {
  ptyId: string
  title: string
}

/**
 * Subscribe to title changes across ALL PTYs.
 * Useful for aggregate view to update PTY list when titles change.
 * Returns an unsubscribe function.
 */
export async function subscribeToAllTitleChanges(
  callback: (event: PtyTitleChangeEvent) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeToAllTitleChanges((event) => {
          callback({ ptyId: event.ptyId, title: event.title })
        })
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Get the current title for a PTY.
 */
export async function getPtyTitle(ptyId: string): Promise<string> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getTitle(PtyId.make(ptyId))
      })
    )
  } catch {
    return ""
  }
}
