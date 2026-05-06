import { produce, type SetStoreFunction } from 'solid-js/store';

import { buildPtyIndex } from '../filter';
import {
  getSessionPaneOrder,
  getPendingPaneOrderKey,
  mergePaneOrder,
  setSessionPaneOrder,
} from '../pane-order';
import { recomputeMatches, recomputeTree } from '../session';
import type { AggregateViewState, PtyInfo } from '../types';
import { dedupeAggregatePtysByPane, getAggregatePaneKey } from '../rows';
import { hasGitMetadata } from '../git';
import type { SnapshotResult } from './build-snapshot';

export interface ApplySnapshotOptions {
  mergeWithExisting?: boolean;
}

/** Copy git metadata fields from a source PTY onto a target PTY.
 *  Only git fields are copied; all other fields come from the target. */
export function applyGitMetadataToPty(target: PtyInfo, source: PtyInfo): PtyInfo {
  return {
    ...target,
    gitBranch: source.gitBranch,
    gitDiffStats: source.gitDiffStats,
    gitDirty: source.gitDirty,
    gitStaged: source.gitStaged,
    gitUnstaged: source.gitUnstaged,
    gitUntracked: source.gitUntracked,
    gitConflicted: source.gitConflicted,
    gitAhead: source.gitAhead,
    gitBehind: source.gitBehind,
    gitStashCount: source.gitStashCount,
    gitState: source.gitState,
    gitDetached: source.gitDetached,
    gitRepoKey: source.gitRepoKey,
    gitIsWorktree: source.gitIsWorktree,
    gitCommonDir: source.gitCommonDir,
  };
}

export function applySnapshot(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  snapshot: SnapshotResult,
  options?: ApplySnapshotOptions
): void {
  setState(
    produce((s) => {
      const previousPaneOrderIndex = new Map(s.sessionPaneOrderIndex);
      const snapshotPtys = snapshot.ptys.filter((pty) => !s.deletedPtyIds.has(pty.ptyId));

      // Single-writer principle: the snapshot IS allPtys.
      // No carriedOptimisticPtys, no cross-session reconciliation.
      // The snapshot is built from authoritative sources (layout + disk)
      // and is the sole source of truth for which PTYs exist and which
      // session they belong to. This eliminates the race condition where
      // optimistic entries from handlePtyCreated could have wrong sessionIds.
      //
      // When mergeWithExisting is true (fast refresh from handlePtyCreated),
      // we only replace data for sessions that have PTYs in the snapshot,
      // preserving data for other sessions until the full background refresh
      // completes. Non-active sessions are listed in snapshot.sessions but
      // marked as 'unloaded' — they must NOT overwrite existing loaded data.
      // Sessions that were actually loaded in this snapshot (not inferred
      // from PTYs' sessionId, which can be wrong due to ownership resolution).
      // In activeSessionOnly mode, only the active session was loaded even if
      // some PTYs have a different sessionId. Using loadedSessionIds prevents
      // the merge from clobbering other sessions' data when a PTY's sessionId
      // points to a non-active session.
      const loadedSnapshotSessionIds =
        snapshot.loadedSessionIds ?? new Set<string>(snapshot.ptys.map((p) => String(p.sessionId)));
      const mergeMode = options?.mergeWithExisting ?? false;

      // Preserve sortOrderHint from pending pane creations so that
      // newly created panes maintain their intended position.
      const pendingSortHints = new Map<string, number>();
      for (const insertion of s.pendingPaneCreations) {
        if (insertion.pendingPtyId && insertion.sortOrderHint !== undefined) {
          pendingSortHints.set(insertion.pendingPtyId, insertion.sortOrderHint);
        }
      }

      const finalPtys = snapshotPtys.map((pty) => {
        const sortHint = pendingSortHints.get(pty.ptyId);
        return sortHint !== undefined ? { ...pty, sortOrderHint: sortHint } : pty;
      });

      s.isLoading = false;
      if (!mergeMode) {
        s.allSessions.clear();
      }
      for (const session of snapshot.sessions) {
        s.allSessions.set(session.id, session);
      }

      if (!mergeMode) {
        s.sessionLoadStates.clear();
      } else {
        // Only remove load states for sessions that have PTYs in the snapshot.
        // Non-active sessions are listed as 'unloaded' in the snapshot but
        // must NOT overwrite their existing loaded state.
        for (const sessionId of loadedSnapshotSessionIds) {
          s.sessionLoadStates.delete(sessionId);
        }
      }
      for (const [sessionId, loadState] of snapshot.sessionLoadStates) {
        // In merge mode, skip 'unloaded' entries — they're placeholders for
        // sessions we didn't actually load; preserving existing load states
        // keeps the UI from flashing "Session (unloaded)".
        if (mergeMode && loadState.status === 'unloaded') continue;
        s.sessionLoadStates.set(sessionId, loadState);
      }

      if (!mergeMode) {
        s.loadingSessionIds.clear();
        s.loadAttemptedSessionIds.clear();
      }

      if (!mergeMode) {
        s.sessionPaneOrders = new Map();
        s.sessionPaneOrderIndex.clear();
      }
      for (const [sessionId, paneOrder] of snapshot.sessionPaneOrders) {
        const existingOrder = getSessionPaneOrder(previousPaneOrderIndex, sessionId);
        const mergedPaneOrder = mergePaneOrder(
          existingOrder.size > 0 ? existingOrder : undefined,
          paneOrder
        );
        s.sessionPaneOrders.set(sessionId, mergedPaneOrder);
        setSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, mergedPaneOrder);
      }

      // Preserve pane sort orders from pending pane creations so that
      // newly created panes maintain their intended position.
      // Use real paneId if available, otherwise a synthetic key derived from
      // the pending creation ID. This ensures rapid sequential PTY creations
      // each keep their intended position even before the real paneId is known.
      for (const insertion of s.pendingPaneCreations) {
        if (insertion.sortOrderHint === undefined) {
          continue;
        }
        const paneIdForOrder = insertion.pendingPaneId ?? getPendingPaneOrderKey(insertion.id);
        const sessionPaneOrder =
          s.sessionPaneOrders.get(insertion.sessionId) ?? new Map<string, number>();
        sessionPaneOrder.set(paneIdForOrder, insertion.sortOrderHint);
        s.sessionPaneOrders.set(insertion.sessionId, sessionPaneOrder);
        setSessionPaneOrder(s.sessionPaneOrderIndex, insertion.sessionId, sessionPaneOrder);
      }

      // Build git metadata lookup from EXISTING PTYs before they're replaced.
      // This is used to fill in empty git fields on snapshot PTYs after
      // the replacement, avoiding the flicker between Phase 1 (skipGitMetadata)
      // and Phase 2 (hydrateGitMetadata).
      const preExistingGitByPtyId = new Map<string, PtyInfo>();
      const preExistingGitByPaneKey = new Map<string, PtyInfo>();
      for (const pty of s.allPtys) {
        if (!hasGitMetadata(pty)) continue;
        if (!s.deletedPtyIds.has(pty.ptyId)) {
          preExistingGitByPtyId.set(pty.ptyId, pty);
        }
        const key = getAggregatePaneKey(pty.sessionId, pty.paneId);
        if (key) preExistingGitByPaneKey.set(key, pty);
      }

      if (mergeMode) {
        // Merge PTYs: keep existing PTYs for sessions that don't have PTYs
        // in the snapshot (i.e., non-active sessions during a fast refresh),
        // replace PTYs for sessions that do have PTYs in the snapshot.
        const existingPtysForOtherSessions = s.allPtys.filter(
          (pty) => !loadedSnapshotSessionIds.has(pty.sessionId)
        );
        // Include existing PTYs for loaded sessions so that
        // dedupeAggregatePtysByPane can preserve git metadata from them
        // when snapshot PTYs have empty git fields (from skipGitMetadata).
        // Without this, the merge discards existing PTYs that carry cached
        // git data, causing a visible flicker where git metadata clears
        // and only reappears after the subsequent full refreshPtys().
        const existingPtysForLoadedSessions = s.allPtys.filter((pty) =>
          loadedSnapshotSessionIds.has(pty.sessionId)
        );
        s.allPtys = dedupeAggregatePtysByPane([
          ...existingPtysForOtherSessions,
          ...existingPtysForLoadedSessions,
          ...finalPtys,
        ]);
      } else {
        s.allPtys = dedupeAggregatePtysByPane(finalPtys);
      }

      // Single-writer git metadata preservation: fill in empty git fields
      // on snapshot PTYs from their previous entries. This avoids the
      // flicker where Phase 1 (skipGitMetadata) clears all git metadata
      // and Phase 2 (hydrateGitMetadata) must async-fetch it back.
      // Only carried forward when the ptyId matches AND the CWD hasn't
      // changed (stale repo metadata must not leak into a new directory).
      //
      // In merge mode, dedupeAggregatePtysByPane already preserves git
      // metadata from existing PTYs, so this loop only fills gaps that
      // the dedupe missed (e.g. saved: → live ptyId transitions without
      // pane-key overlap).

      // Identify which PTYs came from the snapshot (vs carried-existing)
      // to avoid filling git metadata on non-snapshot entries.
      const snapshotPtyIds = new Set(finalPtys.map((p) => p.ptyId));
      const snapshotPaneKeys = new Set<string>();
      for (const p of finalPtys) {
        const key = getAggregatePaneKey(p.sessionId, p.paneId);
        if (key) snapshotPaneKeys.add(key);
      }

      for (let i = 0; i < s.allPtys.length; i++) {
        const pty = s.allPtys[i];
        // Only fill snapshot PTYs (not carried-existing from merge mode)
        if (!snapshotPtyIds.has(pty.ptyId)) {
          const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
          if (paneKey && !snapshotPaneKeys.has(paneKey)) continue;
        }
        if (hasGitMetadata(pty)) continue;

        // Try match by ptyId first (same PTY, same pane)
        const byPtyId = preExistingGitByPtyId.get(pty.ptyId);
        if (byPtyId && byPtyId.cwd === pty.cwd) {
          s.allPtys[i] = applyGitMetadataToPty(pty, byPtyId);
          continue;
        }

        // Try match by pane key (saved: → live transition for same pane)
        const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
        if (paneKey) {
          const byPaneKey = preExistingGitByPaneKey.get(paneKey);
          if (byPaneKey && byPaneKey.cwd === pty.cwd) {
            s.allPtys[i] = applyGitMetadataToPty(pty, byPaneKey);
          }
        }
      }
      s.allPtysIndex = buildPtyIndex(s.allPtys);

      // Clear stale tracking sets — the snapshot is authoritative now.
      s.pendingPtyIds.clear();
      s.recentlyAddedPtyIds.clear();

      if (s.expandedSessionIds.size === 0) {
        for (const session of snapshot.sessions) {
          s.expandedSessionIds.add(session.id);
        }
      }

      recomputeMatches(s);
      recomputeTree(s);
    })
  );
}
