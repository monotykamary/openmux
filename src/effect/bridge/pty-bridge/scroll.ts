import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../../runtime"
import { Pty } from "../../services"
import { PtyId } from "../../types"

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
