/**
 * Regression test: git metadata must not clear then redraw during refresh.
 *
 * When a live PTY replaces a saved PTY for the same pane (e.g. during
 * dedupeAggregatePtysByPane in applySnapshot), the live PTY's empty git
 * fields must not override the saved PTY's known git metadata.
 *
 * Similarly, stampOwnershipOnPlaceholder must not wipe existing git metadata
 * when stamping ownership onto a placeholder that already has git data.
 */

import { describe, expect, it } from 'bun:test';

import type { SessionMetadata } from '../../../effect/models';
import type { PtyInfo } from '../types';
import { dedupeAggregatePtysByPane, isSavedAggregatePtyId } from '../rows';
import { mergePtyInfoPreservingGitMetadata } from '../git';
import { applySnapshot, applyGitMetadataToPty } from '../refresh/apply-snapshot';
import type { SnapshotResult } from '../refresh/build-snapshot';
import type { AggregateViewState } from '../types';
import { initialState } from '../types';

const sessionMetadata: SessionMetadata = {
  id: 'session-1',
  name: 'Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const emptyGitFields = {
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

function createSavedPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'saved:session-1:pane-3',
    cwd: '/repo',
    gitBranch: 'main',
    gitDiffStats: { added: 10, removed: 2, binary: 0 },
    gitDirty: true,
    gitStaged: 1,
    gitUnstaged: 2,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: 7,
    gitBehind: 0,
    gitStashCount: 0,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: '/repo',
    gitIsWorktree: false,
    gitCommonDir: null,
    foregroundProcess: 'nvim',
    shell: '/bin/zsh',
    title: 'editor',
    workspaceId: 1,
    paneId: 'pane-3',
    sessionId: 'session-1',
    sessionMetadata,
    sortOrderHint: 2,
    ...overrides,
  };
}

function createLivePty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: 'pty-live',
    cwd: '/repo',
    ...emptyGitFields,
    foregroundProcess: undefined,
    shell: 'shell',
    title: '...',
    workspaceId: 1,
    paneId: 'pane-3',
    sessionId: 'session-1',
    sessionMetadata,
    sortOrderHint: 2,
    ...overrides,
  };
}

describe('regression: git metadata must not clear then redraw', () => {
  it('dedupeAggregatePtysByPane preserves git metadata from saved fallback when live pty has empty git fields', () => {
    const saved = createSavedPty();
    const live = createLivePty();

    expect(isSavedAggregatePtyId(saved.ptyId)).toBe(true);
    expect(isSavedAggregatePtyId(live.ptyId)).toBe(false);

    const deduped = dedupeAggregatePtysByPane([saved, live]);

    // Live pty is preferred (not saved), but its empty git metadata must not
    // override the saved pty's known git metadata.
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.title).toBe('...');
    expect(deduped[0]!.gitBranch).toBe('main');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(deduped[0]!.gitDirty).toBe(true);
    expect(deduped[0]!.gitStaged).toBe(1);
    expect(deduped[0]!.gitUnstaged).toBe(2);
    expect(deduped[0]!.gitAhead).toBe(7);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata from live pty when it has git data', () => {
    const live = createLivePty({
      ptyId: 'pty-existing',
      gitBranch: 'feature',
      gitDiffStats: { added: 5, removed: 1, binary: 0 },
      gitDirty: true,
      gitStaged: 0,
      gitUnstaged: 3,
      gitAhead: 2,
      gitRepoKey: '/repo',
      title: 'working',
    });
    const saved = createSavedPty({
      ptyId: 'saved:session-1:pane-3',
      ...emptyGitFields,
    });

    const deduped = dedupeAggregatePtysByPane([live, saved]);

    // Live pty is preferred, its git metadata is used
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-existing');
    expect(deduped[0]!.gitBranch).toBe('feature');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 5, removed: 1, binary: 0 });
  });

  it('dedupeAggregatePtysByPane prefers live pty git metadata when both have git data', () => {
    const saved = createSavedPty({
      gitBranch: 'old-branch',
      gitAhead: 1,
    });
    const live = createLivePty({
      gitBranch: 'new-branch',
      gitAhead: 5,
      gitRepoKey: '/repo',
    });

    const deduped = dedupeAggregatePtysByPane([saved, live]);

    // Live pty is preferred and has git data, so its data wins
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.gitBranch).toBe('new-branch');
    expect(deduped[0]!.gitAhead).toBe(5);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata when live replaces saved for same pane', () => {
    const saved = createSavedPty();
    const live = createLivePty();

    // Both ptys are for the same pane (session-1, pane-3)
    const deduped = dedupeAggregatePtysByPane([saved, live]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.ptyId).toBe('pty-live');
    expect(deduped[0]!.gitBranch).toBe('main');
    expect(deduped[0]!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(deduped[0]!.gitDirty).toBe(true);
    expect(deduped[0]!.gitAhead).toBe(7);
    expect(deduped[0]!.gitRepoKey).toBe('/repo');
  });

  it('dedupeAggregatePtysByPane preserves git metadata across multiple pane dedupes', () => {
    const saved1 = createSavedPty({ paneId: 'pane-a', sortOrderHint: 0 });
    const live1 = createLivePty({ paneId: 'pane-a', sortOrderHint: 0 });
    const saved2 = createSavedPty({
      ptyId: 'saved:session-1:pane-b',
      paneId: 'pane-b',
      gitBranch: 'develop',
      gitAhead: 3,
      gitDiffStats: { added: 20, removed: 5, binary: 1 },
      sortOrderHint: 1,
    });
    const live2 = createLivePty({ paneId: 'pane-b', sortOrderHint: 1 });

    const deduped = dedupeAggregatePtysByPane([saved1, live1, saved2, live2]);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((p) => p.paneId === 'pane-a')).toMatchObject({
      ptyId: 'pty-live',
      gitBranch: 'main',
      gitAhead: 7,
    });
    expect(deduped.find((p) => p.paneId === 'pane-b')).toMatchObject({
      ptyId: 'pty-live',
      gitBranch: 'develop',
      gitAhead: 3,
      gitDiffStats: { added: 20, removed: 5, binary: 1 },
    });
  });

  it('dedupeAggregatePtysByPane preserves git metadata from existing live PTY when snapshot PTY has empty git fields (merge-mode applySnapshot)', () => {
    // Simulates the applySnapshot merge-mode scenario:
    // 1. Existing PTYs in allPtys have git metadata (from a prior full refresh)
    // 2. Snapshot PTYs (from refreshActiveSession with skipGitMetadata:true) have empty git fields
    // 3. Both sets are passed to dedupeAggregatePtysByPane
    // 4. The deduplication must preserve git metadata from the existing PTYs

    const existingLivePty: PtyInfo = {
      ptyId: 'pty-1',
      cwd: '/repo',
      gitBranch: 'main',
      gitDiffStats: { added: 10, removed: 2, binary: 0 },
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 2,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 7,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/repo',
      gitIsWorktree: false,
      gitCommonDir: null,
      foregroundProcess: 'nvim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      sortOrderHint: 0,
    };

    const newPanePty: PtyInfo = {
      ptyId: 'pty-2',
      cwd: '/repo',
      ...emptyGitFields,
      foregroundProcess: undefined,
      shell: 'shell',
      title: '...',
      workspaceId: 1,
      paneId: 'pane-2',
      sessionId: 'session-1',
      sessionMetadata,
      sortOrderHint: 1,
    };

    // Snapshot PTYs: same panes as existing but with empty git fields
    const snapshotPty1: PtyInfo = {
      ...existingLivePty,
      ...emptyGitFields,
      title: 'editor',
    };
    const snapshotPty2 = { ...newPanePty };

    // This is what applySnapshot now passes: existing PTYs first, then snapshot PTYs
    const deduped = dedupeAggregatePtysByPane([existingLivePty, snapshotPty1, snapshotPty2]);

    expect(deduped).toHaveLength(2);

    // pane-1: snapshot version preferred (same ptyId), git metadata preserved from existing
    const pane1 = deduped.find((p) => p.paneId === 'pane-1');
    expect(pane1).toBeDefined();
    expect(pane1!.ptyId).toBe('pty-1');
    expect(pane1!.gitBranch).toBe('main');
    expect(pane1!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(pane1!.gitDirty).toBe(true);
    expect(pane1!.gitStaged).toBe(1);
    expect(pane1!.gitUnstaged).toBe(2);
    expect(pane1!.gitAhead).toBe(7);
    expect(pane1!.gitRepoKey).toBe('/repo');

    // pane-2: only the new pane, no git metadata (no existing to inherit from)
    const pane2 = deduped.find((p) => p.paneId === 'pane-2');
    expect(pane2).toBeDefined();
    expect(pane2!.ptyId).toBe('pty-2');
    expect(pane2!.gitBranch).toBeUndefined();
    expect(pane2!.gitRepoKey).toBeUndefined();
  });

  it('mergePtyInfoPreservingGitMetadata preserves git metadata when next has empty fields', () => {
    // This is the core invariant: when transitioning from one git state to
    // the next, if the next state has empty git fields (partial refresh),
    // the existing git metadata must be preserved.
    const existing = createSavedPty({
      ptyId: 'pty-1',
      gitBranch: 'main',
      gitAhead: 7,
    });
    const next: PtyInfo = {
      ...existing,
      ...emptyGitFields,
      foregroundProcess: 'bash',
      title: 'shell',
    };

    const merged = mergePtyInfoPreservingGitMetadata(existing, next);

    expect(merged.foregroundProcess).toBe('bash');
    expect(merged.title).toBe('shell');
    expect(merged.gitBranch).toBe('main');
    expect(merged.gitAhead).toBe(7);
    expect(merged.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
  });

  it('applyGitMetadataToPty copies only git fields from source to target', () => {
    const target: PtyInfo = {
      ptyId: 'pty-1',
      cwd: '/repo',
      foregroundProcess: 'vim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      ...emptyGitFields,
    };
    const source: PtyInfo = {
      ptyId: 'pty-1',
      cwd: '/repo',
      foregroundProcess: 'old-process',
      shell: 'old-shell',
      title: 'old-title',
      workspaceId: 2,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      gitBranch: 'develop',
      gitDiffStats: { added: 5, removed: 1, binary: 0 },
      gitDirty: true,
      gitStaged: 3,
      gitUnstaged: 7,
      gitUntracked: 1,
      gitConflicted: 0,
      gitAhead: 2,
      gitBehind: 1,
      gitStashCount: 1,
      gitState: 'rebase',
      gitDetached: false,
      gitRepoKey: '/repo',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    const result = applyGitMetadataToPty(target, source);

    // Target fields are preserved
    expect(result.foregroundProcess).toBe('vim');
    expect(result.shell).toBe('/bin/zsh');
    expect(result.title).toBe('editor');
    expect(result.cwd).toBe('/repo');

    // Git fields come from source
    expect(result.gitBranch).toBe('develop');
    expect(result.gitDiffStats).toEqual({ added: 5, removed: 1, binary: 0 });
    expect(result.gitDirty).toBe(true);
    expect(result.gitStaged).toBe(3);
    expect(result.gitUnstaged).toBe(7);
    expect(result.gitAhead).toBe(2);
    expect(result.gitBehind).toBe(1);
    expect(result.gitStashCount).toBe(1);
    expect(result.gitState).toBe('rebase');
    expect(result.gitRepoKey).toBe('/repo');
  });

  it('applySnapshot non-merge path preserves git metadata from existing PTYs', () => {
    // This is the bug: refreshPtys() Phase 1 builds a snapshot with
    // skipGitMetadata:true, then applySnapshot replaces all PTYs.
    // Without git metadata preservation, all git fields vanish between
    // Phase 1 and Phase 2 (hydrateGitMetadata).
    //
    // The fix: applySnapshot fills in empty git fields on snapshot PTYs
    // from the previous allPtys entries that match by ptyId or pane key.

    const existingPty: PtyInfo = {
      ptyId: 'pty-1',
      cwd: '/repo',
      foregroundProcess: 'vim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      gitBranch: 'main',
      gitDiffStats: { added: 10, removed: 2, binary: 0 },
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 2,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 7,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/repo',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    // Snapshot PTY: same ptyId and paneId, but empty git fields (from skipGitMetadata)
    const snapshotPty: PtyInfo = {
      ...existingPty,
      foregroundProcess: 'bash',
      title: 'shell',
      ...emptyGitFields,
    };

    const snapshot: SnapshotResult = {
      sessions: [sessionMetadata],
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      sessionPaneOrders: new Map([['session-1', new Map([['pane-1', 0]])]]),
      ptys: [snapshotPty],
      loadedSessionIds: new Set(['session-1']),
    };

    const { createStore: createStoreSolid } = require('solid-js/store');
    const [state, setState] = createStoreSolid<AggregateViewState>({
      ...initialState,
      showAggregateView: true,
      allSessions: new Map([['session-1', sessionMetadata]]),
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      expandedSessionIds: new Set(['session-1']),
      allPtys: [existingPty],
      allPtysIndex: new Map([['pty-1', 0]]),
      sessionPaneOrders: new Map(),
      sessionPaneOrderIndex: new Map(),
      pendingPaneCreations: [],
    });

    applySnapshot(state, setState, snapshot, { mergeWithExisting: false });

    // Git metadata must survive the non-merge applySnapshot
    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]!.ptyId).toBe('pty-1');
    expect(state.allPtys[0]!.gitBranch).toBe('main');
    expect(state.allPtys[0]!.gitDiffStats).toEqual({ added: 10, removed: 2, binary: 0 });
    expect(state.allPtys[0]!.gitDirty).toBe(true);
    expect(state.allPtys[0]!.gitAhead).toBe(7);
    expect(state.allPtys[0]!.gitRepoKey).toBe('/repo');

    // Non-git fields come from the snapshot (updated foregroundProcess/title)
    expect(state.allPtys[0]!.foregroundProcess).toBe('bash');
    expect(state.allPtys[0]!.title).toBe('shell');
  });

  it('applySnapshot non-merge path does NOT preserve git metadata when CWD changed', () => {
    // When a PTY's CWD changed (e.g. cd into a different directory),
    // the old git metadata is for the previous repo and must NOT be
    // carried forward.

    const existingPty: PtyInfo = {
      ptyId: 'pty-1',
      cwd: '/old-repo',
      foregroundProcess: 'vim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      gitBranch: 'main',
      gitDiffStats: { added: 10, removed: 2, binary: 0 },
      gitDirty: true,
      gitStaged: 1,
      gitUnstaged: 2,
      gitUntracked: 0,
      gitConflicted: 0,
      gitAhead: 7,
      gitBehind: 0,
      gitStashCount: 0,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/old-repo',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    // Snapshot PTY: same ptyId but different CWD
    const snapshotPty: PtyInfo = {
      ...existingPty,
      cwd: '/new-repo',
      ...emptyGitFields,
    };

    const snapshot: SnapshotResult = {
      sessions: [sessionMetadata],
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      sessionPaneOrders: new Map([['session-1', new Map([['pane-1', 0]])]]),
      ptys: [snapshotPty],
      loadedSessionIds: new Set(['session-1']),
    };

    const { createStore: createStoreSolid } = require('solid-js/store');
    const [state, setState] = createStoreSolid<AggregateViewState>({
      ...initialState,
      showAggregateView: true,
      allSessions: new Map([['session-1', sessionMetadata]]),
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      expandedSessionIds: new Set(['session-1']),
      allPtys: [existingPty],
      allPtysIndex: new Map([['pty-1', 0]]),
      sessionPaneOrders: new Map(),
      sessionPaneOrderIndex: new Map(),
      pendingPaneCreations: [],
    });

    applySnapshot(state, setState, snapshot, { mergeWithExisting: false });

    // Git metadata must NOT be preserved (CWD changed)
    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]!.cwd).toBe('/new-repo');
    expect(state.allPtys[0]!.gitBranch).toBeUndefined();
    expect(state.allPtys[0]!.gitDirty).toBe(false);
    expect(state.allPtys[0]!.gitRepoKey).toBeUndefined();
  });

  it('applySnapshot non-merge path preserves git metadata by pane key for saved: → live ptyId transition', () => {
    // When a saved: PTY transitions to a live PTY (same pane, different ptyId),
    // git metadata should be preserved via the pane key match.

    const existingPty: PtyInfo = {
      ptyId: 'saved:session-1:pane-1',
      cwd: '/repo',
      foregroundProcess: undefined,
      shell: 'shell',
      title: 'shell',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      gitBranch: 'develop',
      gitDiffStats: { added: 20, removed: 5, binary: 1 },
      gitDirty: true,
      gitStaged: 5,
      gitUnstaged: 10,
      gitUntracked: 3,
      gitConflicted: 0,
      gitAhead: 3,
      gitBehind: 2,
      gitStashCount: 1,
      gitState: undefined,
      gitDetached: false,
      gitRepoKey: '/repo',
      gitIsWorktree: false,
      gitCommonDir: null,
    };

    // Snapshot PTY: live ptyId (different from saved:), same pane, empty git fields
    const snapshotPty: PtyInfo = {
      ptyId: 'pty-live',
      cwd: '/repo',
      foregroundProcess: 'vim',
      shell: '/bin/zsh',
      title: 'editor',
      workspaceId: 1,
      paneId: 'pane-1',
      sessionId: 'session-1',
      sessionMetadata,
      ...emptyGitFields,
    };

    const snapshot: SnapshotResult = {
      sessions: [sessionMetadata],
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      sessionPaneOrders: new Map([['session-1', new Map([['pane-1', 0]])]]),
      ptys: [snapshotPty],
      loadedSessionIds: new Set(['session-1']),
    };

    const { createStore: createStoreSolid } = require('solid-js/store');
    const [state, setState] = createStoreSolid<AggregateViewState>({
      ...initialState,
      showAggregateView: true,
      allSessions: new Map([['session-1', sessionMetadata]]),
      sessionLoadStates: new Map([['session-1', { status: 'loaded', paneCount: 1 }]]),
      expandedSessionIds: new Set(['session-1']),
      allPtys: [existingPty],
      allPtysIndex: new Map([['saved:session-1:pane-1', 0]]),
      sessionPaneOrders: new Map(),
      sessionPaneOrderIndex: new Map(),
      pendingPaneCreations: [],
    });

    applySnapshot(state, setState, snapshot, { mergeWithExisting: false });

    // Git metadata must survive via pane key match
    expect(state.allPtys).toHaveLength(1);
    expect(state.allPtys[0]!.ptyId).toBe('pty-live');
    expect(state.allPtys[0]!.gitBranch).toBe('develop');
    expect(state.allPtys[0]!.gitDiffStats).toEqual({ added: 20, removed: 5, binary: 1 });
    expect(state.allPtys[0]!.gitDirty).toBe(true);
    expect(state.allPtys[0]!.gitAhead).toBe(3);
    expect(state.allPtys[0]!.gitRepoKey).toBe('/repo');
  });
});
