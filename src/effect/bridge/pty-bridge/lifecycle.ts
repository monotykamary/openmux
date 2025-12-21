import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../../runtime"
import { Pty } from "../../services"
import { PtyId, Cols, Rows } from "../../types"

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
 * Destroy a PTY session.
 * This is fire-and-forget - deferred to next macrotask to avoid blocking animations.
 */
export function destroyPty(ptyId: string): void {
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
