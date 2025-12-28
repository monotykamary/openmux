/**
 * Helper functions for PTY service
 * Git-related utilities backed by libgit2.
 */

import { Effect } from "effect"
import { watch } from "fs"
import {
  getRepoStatusAsync,
  getDiffStatsAsync,
  type GitDiffStats as NativeGitDiffStats,
  type GitRepoState,
} from "../../../../native/zig-git/ts/index"

export interface GitInfo {
  branch: string | undefined
  dirty: boolean
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  ahead: number | undefined
  behind: number | undefined
  stashCount: number | undefined
  state: GitRepoState | undefined
  detached: boolean
  repoKey: string
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
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  ahead: number | undefined
  behind: number | undefined
  stashCount: number | undefined
  state: GitRepoState | undefined
  detached: boolean
  stale: boolean
  lastFetched: number
  lastAccess: number
  lastStaleAt?: number
  diffStats?: GitDiffStats
  diffInFlight?: Promise<GitDiffStats | undefined>
  infoInFlight?: Promise<RepoEntry | null>
  gitWatcher?: ReturnType<typeof watch>
  workWatcher?: ReturnType<typeof watch>
}

const repoCache = new Map<string, RepoEntry>()
const cwdToRepoKey = new Map<string, string>()
const pendingByCwd = new Map<string, Promise<RepoEntry | null>>()

const STATUS_TTL_MS = 2000
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
        entry.gitWatcher?.close()
        entry.workWatcher?.close()
        repoCache.delete(key)
      }
    }
  }, CACHE_TTL_MS)
  cleanupTimer.unref?.()
}

function markStale(entry: RepoEntry) {
  const now = Date.now()
  if (entry.lastStaleAt && now - entry.lastStaleAt < 50) {
    return
  }
  entry.lastStaleAt = now
  entry.stale = true
}

function ensureGitWatcher(entry: RepoEntry) {
  if (entry.gitWatcher) return
  try {
    const recursive = process.platform === "darwin" || process.platform === "win32"
    entry.gitWatcher = watch(entry.gitDir, { recursive }, () => {
      markStale(entry)
    })
    entry.gitWatcher.on("error", () => {
      entry.gitWatcher?.close()
      entry.gitWatcher = undefined
    })
  } catch {
    entry.gitWatcher = undefined
  }
}

function ensureWorkdirWatcher(entry: RepoEntry) {
  if (!entry.workDir || entry.workWatcher) return
  try {
    const recursive = process.platform === "darwin" || process.platform === "win32"
    entry.workWatcher = watch(entry.workDir, { recursive }, () => {
      markStale(entry)
    })
    entry.workWatcher.on("error", () => {
      entry.workWatcher?.close()
      entry.workWatcher = undefined
    })
  } catch {
    entry.workWatcher = undefined
  }
}

async function refreshRepoInfo(
  cwd: string,
  existingKey?: string
): Promise<RepoEntry | null> {
  const existingEntry = existingKey ? repoCache.get(existingKey) : undefined
  if (existingEntry?.infoInFlight) {
    return existingEntry.infoInFlight
  }
  if (!existingEntry) {
    const pending = pendingByCwd.get(cwd)
    if (pending) return pending
  }

  const refreshPromise = (async () => {
    const info = await getRepoStatusAsync(cwd)
    if (!info || !info.gitDir) {
      if (existingEntry) {
        existingEntry.lastAccess = Date.now()
        return existingEntry
      }
      if (existingKey) {
        const oldEntry = repoCache.get(existingKey)
        oldEntry?.gitWatcher?.close()
        oldEntry?.workWatcher?.close()
        repoCache.delete(existingKey)
      }
      cwdToRepoKey.delete(cwd)
      return null
    }

    const gitDir = normalizeRepoPath(info.gitDir)
    if (!gitDir) return null

    const workDir = normalizeRepoPath(info.workDir)
    const key = workDir ?? gitDir

    if (existingKey && existingKey !== key) {
      const oldEntry = repoCache.get(existingKey)
      oldEntry?.gitWatcher?.close()
      oldEntry?.workWatcher?.close()
      repoCache.delete(existingKey)
    }

    const now = Date.now()
    let entry = repoCache.get(key)
    const nextState = info.state === "unknown" ? undefined : info.state
    const nextAhead = info.ahead ?? undefined
    const nextBehind = info.behind ?? undefined
    const nextStash = info.stashCount ?? undefined

    if (!entry) {
      entry = {
        key,
        gitDir,
        workDir,
        branch: info.branch ?? undefined,
        dirty: info.dirty,
        staged: info.staged,
        unstaged: info.unstaged,
        untracked: info.untracked,
        conflicted: info.conflicted,
        ahead: nextAhead,
        behind: nextBehind,
        stashCount: nextStash,
        state: nextState,
        detached: info.detached,
        stale: false,
        lastFetched: now,
        lastAccess: now,
      }
      repoCache.set(key, entry)
    } else {
      const diffReset =
        entry.branch !== (info.branch ?? undefined) ||
        entry.dirty !== info.dirty ||
        entry.staged !== info.staged ||
        entry.unstaged !== info.unstaged ||
        entry.untracked !== info.untracked ||
        entry.conflicted !== info.conflicted

      entry.gitDir = gitDir
      entry.workDir = workDir
      entry.branch = info.branch ?? undefined
      entry.dirty = info.dirty
      entry.staged = info.staged
      entry.unstaged = info.unstaged
      entry.untracked = info.untracked
      entry.conflicted = info.conflicted
      entry.ahead = nextAhead
      entry.behind = nextBehind
      entry.stashCount = nextStash
      entry.state = nextState
      entry.detached = info.detached
      entry.stale = false
      entry.lastFetched = now
      entry.lastAccess = now
      if (diffReset) {
        entry.diffStats = undefined
      }
    }

    cwdToRepoKey.set(cwd, key)
    ensureGitWatcher(entry)
    ensureWorkdirWatcher(entry)
    scheduleCleanup()
    return entry
  })()

  if (existingEntry) {
    existingEntry.infoInFlight = refreshPromise
  } else {
    pendingByCwd.set(cwd, refreshPromise)
  }

  try {
    return await refreshPromise
  } finally {
    if (existingEntry?.infoInFlight === refreshPromise) {
      existingEntry.infoInFlight = undefined
    }
    if (!existingEntry) {
      pendingByCwd.delete(cwd)
    }
  }
}

async function getRepoEntry(
  cwd: string,
  options: { force?: boolean; maxAgeMs?: number } = {}
): Promise<RepoEntry | null> {
  const now = Date.now()
  const maxAgeMs = options.maxAgeMs ?? STATUS_TTL_MS
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
      staged: entry.staged,
      unstaged: entry.unstaged,
      untracked: entry.untracked,
      conflicted: entry.conflicted,
      ahead: entry.ahead,
      behind: entry.behind,
      stashCount: entry.stashCount,
      state: entry.state,
      detached: entry.detached,
      repoKey: entry.key,
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
