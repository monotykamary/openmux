import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "../../runtime"
import { Pty } from "../../services"
import { PtyId, Cols, Rows } from "../../types"

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
