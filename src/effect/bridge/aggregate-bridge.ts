/**
 * Aggregate view bridge functions
 * Provides PTY listing with metadata for aggregate view
 */

import { Effect } from "effect"
import { runEffect } from "../runtime"
import { Pty } from "../services"

/**
 * Check if a process is still alive.
 */
export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    // kill -0 sends no signal but checks if process exists
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * List all PTYs with their metadata.
 * Filters out dead processes and defunct zombies.
 */
export async function listAllPtysWithMetadata(): Promise<Array<{
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  foregroundProcess: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}>> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const ptyIds = yield* pty.listAll()

        const results: Array<{
          ptyId: string
          cwd: string
          gitBranch: string | undefined
          foregroundProcess: string | undefined
          workspaceId: number | undefined
          paneId: string | undefined
        }> = []

        for (const ptyId of ptyIds) {
          // Get session to check if PTY process is still alive
          const session = yield* pty.getSession(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )

          // Skip if session not found or process is dead
          if (!session || session.pid === 0) continue
          const alive = yield* Effect.promise(() => isProcessAlive(session.pid))
          if (!alive) continue

          const cwd = yield* pty.getCwd(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(process.cwd()))
          )
          const gitBranch = yield* pty.getGitBranch(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )
          const foregroundProcess = yield* pty.getForegroundProcess(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )

          // Skip defunct processes (zombie processes)
          if (foregroundProcess?.includes('defunct')) continue

          results.push({
            ptyId,
            cwd,
            gitBranch,
            foregroundProcess,
            workspaceId: undefined, // Will be enriched by AggregateView
            paneId: undefined,      // Will be enriched by AggregateView
          })
        }

        return results
      })
    )
  } catch {
    return []
  }
}
