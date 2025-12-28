/**
 * Helper functions for PTY service
 * Git-related utilities backed by libgit2.
 */

import { Effect } from "effect"
import { watch } from "fs"
import { getRepoInfo, getDiffStatsAsync, type GitDiffStats as NativeGitDiffStats } from "../../../../zig-git/ts/index"

export interface GitInfo {
  branch: string | undefined
  dirty: boolean
}

/**
 * Git diff statistics (lines added and removed)
 */
export interface GitDiffStats {
  added: number
  removed: number
}

interface RepoEntry {
  key: string
  gitDir: string
  workDir: string | null
  branch: string | undefined
  dirty: boolean
  stale: boolean
  lastFetched: number
  lastAccess: number
  diffStats?: GitDiffStats
  diffInFlight?: Promise<GitDiffStats | undefined>
  watcher?: ReturnType<typeof watch>
}

const repoCache = new Map<string, RepoEntry>()
const cwdToRepoKey = new Map<string, string>()

const INFO_TTL_MS = 2000
const CACHE_TTL_MS = 10 * 60 * 1000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function normalizeRepoPath(path: string | null): string | null {
  if (!path) return null
  if (path.length > 1 && (path.endsWith("/") || path.endsWith("\\"))) {
    return path.slice(0, -1)
  }
  return path
}

function scheduleCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of repoCache.entries()) {
      if (now - entry.lastAccess > CACHE_TTL_MS) {
        entry.watcher?.close()
        repoCache.delete(key)
      }
    }
  }, CACHE_TTL_MS)
  cleanupTimer.unref?.()
}

function markStale(entry: RepoEntry) {
  entry.stale = true
  entry.diffStats = undefined
}

function ensureWatcher(entry: RepoEntry) {
  if (entry.watcher) return
  try {
    const recursive = process.platform === "darwin" || process.platform === "win32"
    entry.watcher = watch(entry.gitDir, { recursive }, () => {
      markStale(entry)
    })
    entry.watcher.on("error", () => {
      entry.watcher?.close()
      entry.watcher = undefined
    })
  } catch {
    entry.watcher = undefined
  }
}

async function refreshRepoInfo(
  cwd: string,
  existingKey?: string
): Promise<RepoEntry | null> {
  const info = getRepoInfo(cwd)
  if (!info || !info.gitDir) {
    if (existingKey) repoCache.delete(existingKey)
    cwdToRepoKey.delete(cwd)
    return null
  }

  const gitDir = normalizeRepoPath(info.gitDir)
  if (!gitDir) return null

  const workDir = normalizeRepoPath(info.workDir)
  const key = workDir ?? gitDir

  if (existingKey && existingKey !== key) {
    const oldEntry = repoCache.get(existingKey)
    oldEntry?.watcher?.close()
    repoCache.delete(existingKey)
  }

  const now = Date.now()
  let entry = repoCache.get(key)
  if (!entry) {
    entry = {
      key,
      gitDir,
      workDir,
      branch: info.branch ?? undefined,
      dirty: info.dirty,
      stale: false,
      lastFetched: now,
      lastAccess: now,
    }
    repoCache.set(key, entry)
  } else {
    const prevBranch = entry.branch
    const prevDirty = entry.dirty
    entry.gitDir = gitDir
    entry.workDir = workDir
    entry.branch = info.branch ?? undefined
    entry.dirty = info.dirty
    entry.stale = false
    entry.lastFetched = now
    entry.lastAccess = now
    if (prevBranch !== entry.branch || prevDirty !== entry.dirty) {
      entry.diffStats = undefined
    }
  }

  cwdToRepoKey.set(cwd, key)
  ensureWatcher(entry)
  scheduleCleanup()
  return entry
}

async function getRepoEntry(
  cwd: string,
  options: { force?: boolean; maxAgeMs?: number } = {}
): Promise<RepoEntry | null> {
  const now = Date.now()
  const maxAgeMs = options.maxAgeMs ?? INFO_TTL_MS
  const cachedKey = cwdToRepoKey.get(cwd)
  const cached = cachedKey ? repoCache.get(cachedKey) : undefined

  if (!cached) {
    return refreshRepoInfo(cwd)
  }

  cached.lastAccess = now
  if (options.force || cached.stale || now - cached.lastFetched > maxAgeMs) {
    return refreshRepoInfo(cwd, cached.key)
  }

  return cached
}

/**
 * Get git branch + dirty indicator for a directory.
 */
export const getGitInfo = (
  cwd: string,
  options?: { force?: boolean; maxAgeMs?: number }
): Effect.Effect<GitInfo | undefined> =>
  Effect.tryPromise(async () => {
    const entry = await getRepoEntry(cwd, options)
    if (!entry) return undefined
    return {
      branch: entry.branch,
      dirty: entry.dirty,
    }
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

/**
 * Get git branch for a directory (compat helper).
 */
export const getGitBranch = (cwd: string): Effect.Effect<string | undefined> =>
  getGitInfo(cwd).pipe(Effect.map((info) => info?.branch))

/**
 * Get the git diff statistics for a directory.
 * Includes untracked files via libgit2.
 */
export const getGitDiffStats = (cwd: string): Effect.Effect<GitDiffStats | undefined> =>
  Effect.tryPromise(async () => {
    const entry = await getRepoEntry(cwd)
    if (!entry) return undefined

    entry.lastAccess = Date.now()
    if (entry.diffInFlight) return entry.diffInFlight

    entry.diffInFlight = getDiffStatsAsync(cwd).then((stats: NativeGitDiffStats | null) => {
      entry.diffInFlight = undefined
      if (!stats || (stats.added === 0 && stats.removed === 0)) {
        entry.diffStats = undefined
        return undefined
      }
      entry.diffStats = stats
      return stats
    })

    return entry.diffInFlight
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
