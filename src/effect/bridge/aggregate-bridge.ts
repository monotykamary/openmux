/**
 * Aggregate view bridge functions
 * Provides PTY listing with metadata for aggregate view
 */

import { Effect, Option } from "effect"
import { runEffect } from "../runtime"
import { Pty } from "../services"
import type { PtyId } from "../types"
import type { GitDiffStats, GitInfo } from "../services/pty/helpers"

interface PtyMetadata {
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  gitDiffStats: GitDiffStats | undefined
  gitDirty: boolean
  foregroundProcess: string | undefined
  shell: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}

interface FetchPtyMetadataOptions {
  skipGitDiffStats?: boolean
}

/**
 * Fetch metadata for a single PTY.
 * Returns Option.none() if PTY is invalid or defunct.
 */
const fetchPtyMetadata = (ptyId: PtyId, options: FetchPtyMetadataOptions = {}) =>
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

    // Fetch cwd, git info, foregroundProcess in PARALLEL
    const [cwd, gitInfo, foregroundProcess] = yield* Effect.all([
      pty.getCwd(ptyId).pipe(Effect.orElseSucceed(() => process.cwd())),
      pty.getGitInfo(ptyId).pipe(Effect.orElseSucceed(() => undefined)),
      pty.getForegroundProcess(ptyId).pipe(Effect.orElseSucceed(() => undefined)),
    ], { concurrency: "unbounded" })

    // Skip defunct processes (zombie processes)
    if (foregroundProcess?.includes('defunct')) {
      return Option.none<PtyMetadata>()
    }

    // Fetch git diff stats (only if we have a cwd and not skipped)
    // Skip during polling to avoid expensive git operations that cause stuttering
    const gitDiffStats = options.skipGitDiffStats
      ? undefined
      : yield* pty.getGitDiffStats(ptyId).pipe(Effect.orElseSucceed(() => undefined))

    const gitInfoValue = gitInfo as GitInfo | undefined

    return Option.some<PtyMetadata>({
      ptyId,
      cwd,
      gitBranch: gitInfoValue?.branch,
      gitDiffStats,
      gitDirty: gitInfoValue?.dirty ?? false,
      foregroundProcess,
      shell: session.shell,
      workspaceId: undefined, // Will be enriched by AggregateView
      paneId: undefined,      // Will be enriched by AggregateView
    })
  })

export interface ListAllPtysOptions {
  /** Skip fetching git diff stats (useful for polling to reduce overhead) */
  skipGitDiffStats?: boolean
}

/**
 * Fetch metadata for a single PTY by ID.
 * Useful for staggered polling to avoid subprocess burst.
 *
 * @param ptyId - The PTY ID to fetch metadata for
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns PTY metadata or null if PTY is invalid/defunct
 */
export async function getPtyMetadata(
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const result = yield* fetchPtyMetadata(ptyId as PtyId, {
          skipGitDiffStats: options.skipGitDiffStats,
        })
        return Option.isSome(result) ? result.value : null
      })
    )
  } catch {
    return null
  }
}

/**
 * List all PTYs with their metadata.
 * Fetches metadata in parallel for better performance.
 *
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtysWithMetadata(options: ListAllPtysOptions = {}): Promise<PtyMetadata[]> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const ptyIds = yield* pty.listAll()

        // Fetch all PTY metadata in PARALLEL
        const results = yield* Effect.all(
          ptyIds.map((id) => fetchPtyMetadata(id, { skipGitDiffStats: options.skipGitDiffStats })),
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
