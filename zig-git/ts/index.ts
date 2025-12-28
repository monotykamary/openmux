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

export interface GitDiffStats {
  added: number;
  removed: number;
}

const BRANCH_BUF_SIZE = 256;
const PATH_BUF_SIZE = 4096;

export const DIFF_PENDING = -3;

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
