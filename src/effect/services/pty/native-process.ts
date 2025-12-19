/**
 * Native process utilities - direct file reads for git info.
 *
 * Note: Process inspection (CWD, foreground process) now uses zig-pty native APIs directly.
 * This file only contains git-related utilities that read .git files directly.
 */

import { readFile } from "fs/promises";

// =============================================================================
// Get Git Branch (direct file read)
// =============================================================================

/**
 * Get the current git branch by reading .git/HEAD directly.
 * No subprocess spawning needed!
 */
export async function getGitBranchNative(cwd: string): Promise<string | null> {
  try {
    // First, check if .git/HEAD exists
    const headPath = `${cwd}/.git/HEAD`;
    const head = await readFile(headPath, "utf-8");

    // HEAD contains either:
    // "ref: refs/heads/branch-name\n" (on a branch)
    // "abc123...\n" (detached HEAD, commit hash)

    const refMatch = head.match(/^ref: refs\/heads\/(.+)/);
    if (refMatch) {
      return refMatch[1].trim();
    }

    // Detached HEAD - return short hash
    const hash = head.trim();
    if (hash.length >= 7) {
      return hash.substring(0, 7);
    }

    return null;
  } catch {
    // Not a git repo or can't read .git/HEAD
    return null;
  }
}
