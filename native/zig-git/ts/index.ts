/**
 * zig-git: Minimal libgit2 bindings for Bun.
 */

import { lib } from "./lib-loader";

export interface NativeGitInfo {
  branch: string | null;
  dirty: boolean;
  gitDir: string | null;
  workDir: string | null;
}

export type GitRepoState =
  | "none"
  | "merge"
  | "revert"
  | "revert-seq"
  | "cherry-pick"
  | "cherry-pick-seq"
  | "bisect"
  | "rebase"
  | "rebase-interactive"
  | "rebase-merge"
  | "apply-mailbox"
  | "apply-mailbox-or-rebase"
  | "unknown";

export interface GitRepoStatus extends NativeGitInfo {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  ahead: number | null;
  behind: number | null;
  stashCount: number | null;
  state: GitRepoState;
  detached: boolean;
}

export interface GitDiffStats {
  added: number;
  removed: number;
}

const BRANCH_BUF_SIZE = 256;
const PATH_BUF_SIZE = 4096;

export const DIFF_PENDING = -3;
export const STATUS_PENDING = -5;

const initResult = lib.symbols.omx_git_init();
const isInitialized = initResult >= 0;

if (isInitialized) {
  process.on("exit", () => {
    lib.symbols.omx_git_shutdown();
  });
}

function readCString(buffer: Buffer): string | null {
  const end = buffer.indexOf(0);
  const sliceEnd = end === -1 ? buffer.length : end;
  if (sliceEnd === 0) return null;
  return buffer.toString("utf8", 0, sliceEnd);
}

function normalizeCount(value: number): number | null {
  return value < 0 ? null : value;
}

function mapRepoState(value: number): GitRepoState {
  switch (value) {
    case 0:
      return "none";
    case 1:
      return "merge";
    case 2:
      return "revert";
    case 3:
      return "revert-seq";
    case 4:
      return "cherry-pick";
    case 5:
      return "cherry-pick-seq";
    case 6:
      return "bisect";
    case 7:
      return "rebase";
    case 8:
      return "rebase-interactive";
    case 9:
      return "rebase-merge";
    case 10:
      return "apply-mailbox";
    case 11:
      return "apply-mailbox-or-rebase";
    default:
      return "unknown";
  }
}

export function getRepoInfo(cwd: string): NativeGitInfo | null {
  const cwdBuf = Buffer.from(`${cwd}\0`, "utf8");
  const branchBuf = Buffer.alloc(BRANCH_BUF_SIZE);
  const gitdirBuf = Buffer.alloc(PATH_BUF_SIZE);
  const workdirBuf = Buffer.alloc(PATH_BUF_SIZE);
  const dirtyBuf = Buffer.alloc(1);

  const result = lib.symbols.omx_git_repo_info(
    cwdBuf,
    branchBuf,
    branchBuf.length,
    gitdirBuf,
    gitdirBuf.length,
    workdirBuf,
    workdirBuf.length,
    dirtyBuf
  );

  if (result !== 0) return null;

  return {
    branch: readCString(branchBuf),
    dirty: dirtyBuf[0] === 1,
    gitDir: readCString(gitdirBuf),
    workDir: readCString(workdirBuf),
  };
}

export function getRepoStatus(cwd: string): GitRepoStatus | null {
  const cwdBuf = Buffer.from(`${cwd}\0`, "utf8");
  const branchBuf = Buffer.alloc(BRANCH_BUF_SIZE);
  const gitdirBuf = Buffer.alloc(PATH_BUF_SIZE);
  const workdirBuf = Buffer.alloc(PATH_BUF_SIZE);
  const dirtyBuf = Buffer.alloc(1);
  const stagedBuf = Buffer.alloc(4);
  const unstagedBuf = Buffer.alloc(4);
  const untrackedBuf = Buffer.alloc(4);
  const conflictedBuf = Buffer.alloc(4);
  const aheadBuf = Buffer.alloc(4);
  const behindBuf = Buffer.alloc(4);
  const stashBuf = Buffer.alloc(4);
  const stateBuf = Buffer.alloc(4);
  const detachedBuf = Buffer.alloc(1);

  const result = lib.symbols.omx_git_repo_status(
    cwdBuf,
    branchBuf,
    branchBuf.length,
    gitdirBuf,
    gitdirBuf.length,
    workdirBuf,
    workdirBuf.length,
    dirtyBuf,
    stagedBuf,
    unstagedBuf,
    untrackedBuf,
    conflictedBuf,
    aheadBuf,
    behindBuf,
    stashBuf,
    stateBuf,
    detachedBuf
  );

  if (result !== 0) return null;

  return {
    branch: readCString(branchBuf),
    dirty: dirtyBuf[0] === 1,
    gitDir: readCString(gitdirBuf),
    workDir: readCString(workdirBuf),
    staged: stagedBuf.readInt32LE(0),
    unstaged: unstagedBuf.readInt32LE(0),
    untracked: untrackedBuf.readInt32LE(0),
    conflicted: conflictedBuf.readInt32LE(0),
    ahead: normalizeCount(aheadBuf.readInt32LE(0)),
    behind: normalizeCount(behindBuf.readInt32LE(0)),
    stashCount: normalizeCount(stashBuf.readInt32LE(0)),
    state: mapRepoState(stateBuf.readInt32LE(0)),
    detached: detachedBuf[0] === 1,
  };
}

export function getRepoStatusAsync(
  cwd: string,
  options: { pollIntervalMs?: number } = {}
): Promise<GitRepoStatus | null> {
  const pollIntervalMs = options.pollIntervalMs ?? 10;
  const cwdBuf = Buffer.from(`${cwd}\0`, "utf8");

  return new Promise((resolve) => {
    const branchBuf = Buffer.alloc(BRANCH_BUF_SIZE);
    const gitdirBuf = Buffer.alloc(PATH_BUF_SIZE);
    const workdirBuf = Buffer.alloc(PATH_BUF_SIZE);
    const dirtyBuf = Buffer.alloc(1);
    const stagedBuf = Buffer.alloc(4);
    const unstagedBuf = Buffer.alloc(4);
    const untrackedBuf = Buffer.alloc(4);
    const conflictedBuf = Buffer.alloc(4);
    const aheadBuf = Buffer.alloc(4);
    const behindBuf = Buffer.alloc(4);
    const stashBuf = Buffer.alloc(4);
    const stateBuf = Buffer.alloc(4);
    const detachedBuf = Buffer.alloc(1);

    const poll = (requestId: number) => {
      const status = lib.symbols.omx_git_status_poll(
        requestId,
        branchBuf,
        branchBuf.length,
        gitdirBuf,
        gitdirBuf.length,
        workdirBuf,
        workdirBuf.length,
        dirtyBuf,
        stagedBuf,
        unstagedBuf,
        untrackedBuf,
        conflictedBuf,
        aheadBuf,
        behindBuf,
        stashBuf,
        stateBuf,
        detachedBuf
      );

      if (status === STATUS_PENDING) {
        setTimeout(poll, pollIntervalMs);
        return;
      }

      if (status !== 0) {
        resolve(null);
        return;
      }

      resolve({
        branch: readCString(branchBuf),
        dirty: dirtyBuf[0] === 1,
        gitDir: readCString(gitdirBuf),
        workDir: readCString(workdirBuf),
        staged: stagedBuf.readInt32LE(0),
        unstaged: unstagedBuf.readInt32LE(0),
        untracked: untrackedBuf.readInt32LE(0),
        conflicted: conflictedBuf.readInt32LE(0),
        ahead: normalizeCount(aheadBuf.readInt32LE(0)),
        behind: normalizeCount(behindBuf.readInt32LE(0)),
        stashCount: normalizeCount(stashBuf.readInt32LE(0)),
        state: mapRepoState(stateBuf.readInt32LE(0)),
        detached: detachedBuf[0] === 1,
      });
    };

    const request = () => {
      const requestId = lib.symbols.omx_git_status_async(cwdBuf);
      if (requestId < 0) {
        setTimeout(request, pollIntervalMs);
        return;
      }
      poll(requestId);
    };

    request();
  });
}

export function getDiffStatsAsync(
  cwd: string,
  options: { pollIntervalMs?: number } = {}
): Promise<GitDiffStats | null> {
  const pollIntervalMs = options.pollIntervalMs ?? 10;
  const cwdBuf = Buffer.from(`${cwd}\0`, "utf8");
  const requestId = lib.symbols.omx_git_diff_stats_async(cwdBuf);
  if (requestId < 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    const addedBuf = Buffer.alloc(4);
    const removedBuf = Buffer.alloc(4);

    const poll = () => {
      const status = lib.symbols.omx_git_diff_stats_poll(requestId, addedBuf, removedBuf);
      if (status === DIFF_PENDING) {
        setTimeout(poll, pollIntervalMs);
        return;
      }
      if (status !== 0) {
        resolve(null);
        return;
      }

      resolve({
        added: addedBuf.readInt32LE(0),
        removed: removedBuf.readInt32LE(0),
      });
    };

    poll();
  });
}

export function cancelDiffStats(requestId: number): void {
  if (requestId < 0) return;
  lib.symbols.omx_git_diff_stats_cancel(requestId);
}

export function cancelRepoStatus(requestId: number): void {
  if (requestId < 0) return;
  lib.symbols.omx_git_status_cancel(requestId);
}
