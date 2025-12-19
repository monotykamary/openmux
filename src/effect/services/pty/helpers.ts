/**
 * Helper functions for PTY service
 * Git-related utilities and other PTY helpers
 *
 * Note: Process inspection (CWD, foreground process) now uses zig-pty native APIs directly.
 */

import { Effect } from "effect"
import { getGitBranchNative } from "./native-process"

/**
 * Get the git branch for a directory
 * Reads .git/HEAD directly - no subprocess spawning.
 */
export const getGitBranch = (cwd: string): Effect.Effect<string | undefined> =>
  Effect.tryPromise(async () => {
    const result = await getGitBranchNative(cwd)
    return result ?? undefined
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

/**
 * Git diff statistics (lines added and removed)
 */
export interface GitDiffStats {
  added: number
  removed: number
}

/**
 * Get the git diff statistics for a directory
 * Returns the number of lines added and removed compared to HEAD
 *
 * Note: This still uses subprocess as there's no efficient native way to compute diffs.
 * However, this is only called on initial load, not during polling.
 */
export const getGitDiffStats = (cwd: string): Effect.Effect<GitDiffStats | undefined> =>
  Effect.tryPromise(async () => {
    // Check if we're in a git repository
    const checkProc = Bun.spawn(
      ["git", "rev-parse", "--is-inside-work-tree"],
      { stdout: "pipe", stderr: "pipe", cwd }
    )
    const checkOutput = await new Response(checkProc.stdout).text()
    const checkExitCode = await checkProc.exited
    if (checkExitCode !== 0 || checkOutput.trim() !== "true") return undefined

    // Get diff stats using git diff --stat
    const proc = Bun.spawn(
      ["git", "diff", "--numstat", "HEAD"],
      { stdout: "pipe", stderr: "pipe", cwd }
    )
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return undefined

    let added = 0
    let removed = 0

    // Parse numstat output: "added\tremoved\tfilename"
    const lines = output.trim().split("\n").filter(Boolean)
    for (const line of lines) {
      const parts = line.split("\t")
      if (parts.length >= 2) {
        const lineAdded = parseInt(parts[0], 10)
        const lineRemoved = parseInt(parts[1], 10)
        if (!isNaN(lineAdded)) added += lineAdded
        if (!isNaN(lineRemoved)) removed += lineRemoved
      }
    }

    // If no changes, return undefined to hide the indicator
    if (added === 0 && removed === 0) return undefined

    return { added, removed }
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
