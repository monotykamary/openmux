import type {
  SerializedLayoutNode,
  SerializedSession,
  SessionMetadata,
} from '../../../effect/models';
import type { PtyInfo } from '../types';
import { getSavedAggregatePtyId } from '../rows';
import { hasGitMetadata } from '../git';
import type { CurrentSessionPty } from '../subscriptions';

export function collectSerializedPaneIds(
  node: SerializedLayoutNode | null | undefined,
  result: string[]
): void {
  if (!node) return;
  if ('type' in node && node.type === 'split') {
    collectSerializedPaneIds(node.first, result);
    collectSerializedPaneIds(node.second, result);
    return;
  }
  result.push(node.id);
}

export function buildSessionPaneOrder(session: SerializedSession): Map<string, number> {
  const paneIds: string[] = [];

  for (const workspace of session.workspaces) {
    collectSerializedPaneIds(workspace.mainPane, paneIds);
    for (const pane of workspace.stackPanes) {
      collectSerializedPaneIds(pane, paneIds);
    }
  }

  return new Map(paneIds.map((paneId, index) => [paneId, index] as const));
}

export function collectSessionPaneRecords(session: SerializedSession): Array<{
  paneId: string;
  cwd: string;
  title: string | undefined;
  workspaceId: number;
}> {
  const result: Array<{
    paneId: string;
    cwd: string;
    title: string | undefined;
    workspaceId: number;
  }> = [];

  const collect = (node: SerializedLayoutNode | null | undefined, workspaceId: number): void => {
    if (!node) return;
    if ('type' in node && node.type === 'split') {
      collect(node.first, workspaceId);
      collect(node.second, workspaceId);
      return;
    }

    const pane = node as { id: string; cwd: string; title?: string };
    result.push({
      paneId: pane.id,
      cwd: pane.cwd,
      title: pane.title,
      workspaceId,
    });
  };

  for (const workspace of session.workspaces) {
    collect(workspace.mainPane, workspace.id);
    for (const pane of workspace.stackPanes) {
      collect(pane, workspace.id);
    }
  }

  return result;
}

export function getEmptyGitMetadata(): Pick<
  PtyInfo,
  | 'gitBranch'
  | 'gitDiffStats'
  | 'gitDirty'
  | 'gitStaged'
  | 'gitUnstaged'
  | 'gitUntracked'
  | 'gitConflicted'
  | 'gitAhead'
  | 'gitBehind'
  | 'gitStashCount'
  | 'gitState'
  | 'gitDetached'
  | 'gitRepoKey'
  | 'gitIsWorktree'
  | 'gitCommonDir'
> {
  return {
    gitBranch: undefined,
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
    gitIsWorktree: false,
    gitCommonDir: null,
  };
}

export function buildSavedPaneInfo(params: {
  sessionId: string;
  sessionMetadata: SessionMetadata;
  paneId: string;
  workspaceId: number;
  cwd: string;
  title: string | undefined;
  existing?: PtyInfo;
}): PtyInfo {
  const { sessionId, sessionMetadata, paneId, workspaceId, cwd, title, existing } = params;

  // Preserve git metadata from the existing PTY when the CWD hasn't changed.
  // During a skipGitMetadata refresh, the snapshot PTYs have empty git fields.
  // Carrying forward the existing git data avoids a visible flicker between
  // Phase 1 (snapshot apply) and Phase 2 (hydrateGitMetadata).
  const shouldPreserveExistingGit = existing && existing.cwd === cwd && hasGitMetadata(existing);
  const preservedGit = shouldPreserveExistingGit
    ? {
        gitBranch: existing.gitBranch,
        gitDiffStats: existing.gitDiffStats,
        gitDirty: existing.gitDirty,
        gitStaged: existing.gitStaged,
        gitUnstaged: existing.gitUnstaged,
        gitUntracked: existing.gitUntracked,
        gitConflicted: existing.gitConflicted,
        gitAhead: existing.gitAhead,
        gitBehind: existing.gitBehind,
        gitStashCount: existing.gitStashCount,
        gitState: existing.gitState,
        gitDetached: existing.gitDetached,
        gitRepoKey: existing.gitRepoKey,
        gitIsWorktree: existing.gitIsWorktree,
        gitCommonDir: existing.gitCommonDir,
      }
    : getEmptyGitMetadata();

  return {
    ptyId: getSavedAggregatePtyId(sessionId, paneId),
    cwd,
    foregroundProcess: existing?.foregroundProcess,
    shell: existing?.shell,
    workspaceId,
    paneId,
    sessionId,
    sessionMetadata,
    // Use the serialized title from the session data, not the '...'
    // placeholder title from a stale existing entry. The '...' title
    // means "data not yet loaded" — the serialized data IS the real data.
    title: existing?.title && existing.title !== '...' ? existing.title : title,
    sortOrderHint: existing?.sortOrderHint,
    ...preservedGit,
  };
}

export function buildLivePaneFallback(params: {
  sessionId: string;
  sessionMetadata: SessionMetadata;
  pty: CurrentSessionPty;
}): PtyInfo {
  const { sessionId, sessionMetadata, pty } = params;

  return {
    ptyId: pty.ptyId,
    cwd: pty.cwd ?? '',
    foregroundProcess: undefined,
    shell: undefined,
    workspaceId: pty.workspaceId,
    paneId: pty.paneId,
    sessionId,
    sessionMetadata,
    title: pty.title,
    sortOrderHint: undefined,
    ...getEmptyGitMetadata(),
  };
}
