/**
 * Aggregate view bridge functions
 * Provides PTY listing with metadata for aggregate view
 */

import { Effect, Option } from "effect"
import { runEffect } from "../runtime"
import { Pty } from "../services"
import type { PtyId } from "../types"

interface PtyMetadata {
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  foregroundProcess: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}

/**
 * Fetch metadata for a single PTY.
 * Returns Option.none() if PTY is invalid or defunct.
 */
const fetchPtyMetadata = (ptyId: PtyId) =>
  Effect.gen(function* () {
    const pty = yield* Pty

    // Get session - trust Pty service for validity (no isProcessAlive check)
    const session = yield* pty.getSession(ptyId).pipe(
      Effect.catchAll(() => Effect.succeed(null))
    )

    // Skip if session not found or pid is 0
    if (!session || session.pid === 0) {
      return Option.none<PtyMetadata>()
    }

    // Fetch cwd, gitBranch, foregroundProcess in PARALLEL
    const [cwd, gitBranch, foregroundProcess] = yield* Effect.all([
      pty.getCwd(ptyId).pipe(Effect.orElseSucceed(() => process.cwd())),
      pty.getGitBranch(ptyId).pipe(Effect.orElseSucceed(() => undefined)),
      pty.getForegroundProcess(ptyId).pipe(Effect.orElseSucceed(() => undefined)),
    ], { concurrency: "unbounded" })

    // Skip defunct processes (zombie processes)
    if (foregroundProcess?.includes('defunct')) {
      return Option.none<PtyMetadata>()
    }

    return Option.some<PtyMetadata>({
      ptyId,
      cwd,
      gitBranch,
      foregroundProcess,
      workspaceId: undefined, // Will be enriched by AggregateView
      paneId: undefined,      // Will be enriched by AggregateView
    })
  })

/**
 * List all PTYs with their metadata.
 * Fetches metadata in parallel for better performance.
 */
export async function listAllPtysWithMetadata(): Promise<PtyMetadata[]> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const ptyIds = yield* pty.listAll()

        // Fetch all PTY metadata in PARALLEL
        const results = yield* Effect.all(
          ptyIds.map(fetchPtyMetadata),
          { concurrency: "unbounded" }
        )

        // Filter out None values and extract Some values
        return results
          .filter(Option.isSome)
          .map((opt) => opt.value)
      })
    )
  } catch {
    return []
  }
}
