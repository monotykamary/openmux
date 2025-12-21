export interface GitDiffStats {
  added: number;
  removed: number;
}

export interface PtyInfo {
  ptyId: string;
  cwd: string;
  gitBranch: string | undefined;
  gitDiffStats: GitDiffStats | undefined;
  foregroundProcess: string | undefined;
  workspaceId: number | undefined;
  paneId: string | undefined;
}
