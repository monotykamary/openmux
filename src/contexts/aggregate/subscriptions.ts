/**
 * Subscription management for Aggregate View.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';

import { runStream, streamFromSubscription, tap } from '../../effect/stream-utils';
import {
  subscribeToAllPtyActivity,
  subscribeToMetadataChanges,
  subscribeToPtyLifecycle,
  type PtyMetadataChangeEvent,
} from '../../effect/bridge/pty-bridge';
import { removeAggregateSessionMappingForPty } from '../../effect/bridge/aggregate';
import { subscribeToGitRepoChanges } from '../../effect/services/pty/helpers';

import type { AggregateViewState, PendingPaneCreation } from './types';
import { buildPtyIndex } from './filter';
import { findPendingPaneCreationForLifecycle, removePendingPaneCreations } from './pending';
import { selectAfterPtyRemoval } from './selection';
import { getSessionPaneOrder, setSessionPaneOrder, getPendingPaneOrderKey } from './pane-order';
import { recomputeMatches, recomputeTree } from './session';

export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  metadataChanges: (() => void) | null;
  gitChanges: (() => void) | null;
  polling: (() => void) | null;
}

export interface RefreshState {
  refreshInProgress: boolean;
  pendingFullRefresh: boolean;
}

export type RefreshFlagKey = 'refreshInProgress';

export interface PtyOwnership {
  sessionId: string;
  paneId?: string;
  workspaceId?: number;
}

export interface CurrentSessionHints {
  sessionId: string | null;
  lastActiveWorkspaceId?: number;
  focusedPaneId?: string;
}

export interface CurrentSessionPty {
  ptyId: string;
  paneId: string;
  workspaceId: number;
  title?: string;
  cwd?: string;
  /**
   * Effective owner session for the current in-memory layout snapshot.
   * This may differ transiently from SessionContext.activeSessionId during
   * cold-start/session-switch races, so refresh.ts must trust this value over
   * the hinted active session when it is present.
   */
  sessionId?: string;
}

export interface LifecycleEvent {
  type: 'created' | 'destroyed';
  ptyId: string;
}

export interface LifecycleHandlers {
  handlePtyCreated: (ptyId: string) => Promise<void>;
  handlePtyDestroyed: (ptyId: string) => void;
}

export interface SubscriptionSetupDeps {
  subscriptions: SubscriptionManager;
  subscriptionsEpoch: { value: number };
  refreshPtys: () => Promise<void>;
  handleMetadataChange: (event: MetadataChangeEvent) => void;
  lifecycleHandlers: LifecycleHandlers;
}

export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    metadataChanges: null,
    gitChanges: null,
    polling: null,
  };
}

export function createRefreshState(): RefreshState {
  return {
    refreshInProgress: false,
    pendingFullRefresh: false,
  };
}

export class RefreshGuard implements AsyncDisposable {
  constructor(
    private state: RefreshState,
    private key: RefreshFlagKey
  ) {
    this.state[this.key] = true;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.state[this.key] = false;
  }
}

export interface LifecycleHandlerDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  refreshPtys: () => Promise<void>;
  /** Fast refresh: only the active session, no git metadata.
   *  Used by handlePtyCreated to make new PTYs appear instantly. */
  refreshActiveSession: () => Promise<void | Error>;
  /** Optional callback when a suspended PTY is destroyed. Used to invalidate caches. */
  onPtyDestroyed?: (ptyId: string) => void;
}

const MAX_DELETED_PTY_IDS = 256;

function pruneDeletedPtyIds(set: Set<string>): void {
  if (set.size <= MAX_DELETED_PTY_IDS) return;
  const entries = [...set];
  for (let i = 0; i < entries.length - MAX_DELETED_PTY_IDS; i++) {
    set.delete(entries[i]!);
  }
}

export function createLifecycleHandlers(
  state: AggregateViewState,
  setState: SetStoreFunction<AggregateViewState>,
  deps: LifecycleHandlerDeps
) {
  const { resolvePtyOwnership } = deps;

  /** Sequential queue for handlePtyCreated. Prevents interleaved state
   *  mutations and refreshes when multiple PTYs are created rapidly.
   *  Each call awaits the previous one before starting, so
   *  stamp-then-refresh never races with another stamp-then-refresh. */
  let lifecycleChain: Promise<void> = Promise.resolve();

  const findMatchingPendingInsertion = (
    aggregateState: AggregateViewState,
    params: { ptyId: string; sessionId?: string | null; paneId?: string | null }
  ): PendingPaneCreation | null => {
    return findPendingPaneCreationForLifecycle(aggregateState, params);
  };

  /**
   * Handle PTY creation lifecycle event.
   *
   * Single-writer principle: do NOT insert into allPtys here.
   * Instead, clean up any pending pane creation that matches this PTY,
   * then trigger refreshPtys(). The snapshot will include the new PTY
   * via getCurrentSessionPtys (which reads from the layout), and
   * applySnapshot will write it to allPtys with the correct sessionId.
   *
   * This eliminates the race condition where the old 3-phase insert
   * (insertPlaceholderRow → stampOwnershipOnPlaceholder → hydratePlaceholderRow)
   * could write entries with wrong sessionIds due to stale ptyToSessionMap
   * or aggregateSessionMappings during rapid session switches.
   */
  const handlePtyCreatedImpl = async (ptyId: string): Promise<void> => {
    if (state.deletedPtyIds.has(ptyId)) {
      return;
    }

    const ownership = resolvePtyOwnership(ptyId);

    // Stamp the sort order BEFORE the refresh so applySnapshot reads it.
    // But DON'T remove the pending creation yet — the placeholder stays
    // in matchedPtys so the autoswitch effect can find it while the refresh
    // is in progress.
    if (ownership) {
      setState(
        produce((s) => {
          const matchingInsertion = findMatchingPendingInsertion(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });

          if (matchingInsertion) {
            if (matchingInsertion.sortOrderHint !== undefined) {
              const realPaneId = ownership.paneId ?? matchingInsertion.pendingPaneId;
              if (realPaneId) {
                const sessionPaneOrder = getSessionPaneOrder(
                  s.sessionPaneOrderIndex,
                  ownership.sessionId
                );
                sessionPaneOrder.set(realPaneId, matchingInsertion.sortOrderHint);
                const pendingKey = getPendingPaneOrderKey(matchingInsertion.id);
                if (sessionPaneOrder.has(pendingKey)) {
                  sessionPaneOrder.delete(pendingKey);
                }
                setSessionPaneOrder(s.sessionPaneOrderIndex, ownership.sessionId, sessionPaneOrder);
              }
            }
          }
        })
      );
    }

    // Refresh first — the pending creation's placeholder stays visible in
    // matchedPtys so the autoswitch effect can select it immediately.
    await deps.refreshActiveSession();

    // Yield to let createPaneWithPTY's onCreated callback fire.
    // When the lifecycle event arrives before onCreated sets pendingPtyId,
    // the pending creation is still unclaimed. Yielding lets the JS runtime
    // process the onCreated microtask/macrotask, which stamps pendingPtyId
    // onto the insertion. Without this yield, findPendingPaneCreationForLifecycle
    // can't match unclaimed insertions when there are multiple for the same
    // session (it only matches when exactly one is unclaimed), leaving the
    // pending creation orphaned and permanently blocking autoswitch.
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // NOW remove the pending creation. The refresh has put the real PTY
    // into allPtys/matchedPtys, so the placeholder is no longer needed.
    if (ownership) {
      setState(
        produce((s) => {
          const matchingInsertion = findMatchingPendingInsertion(s, {
            ptyId,
            sessionId: ownership.sessionId,
            paneId: ownership.paneId,
          });

          if (matchingInsertion) {
            removePendingPaneCreations(s, (insertion) => insertion.id === matchingInsertion.id);
          } else {
            removePendingPaneCreations(
              s,
              (insertion) =>
                insertion.pendingPtyId === ptyId ||
                (!!ownership.paneId && insertion.pendingPaneId === ownership.paneId)
            );
          }

          // Fallback: remove any pending creation whose real PTY has landed
          // in the flattened tree index. This catches cases where onCreated
          // fired during the yield above but the match-by-ptyId still missed
          // (e.g., the insertion's pendingPtyId was set to a different PTY
          // due to rapid sequential creations).
          removePendingPaneCreations(
            s,
            (insertion) =>
              insertion.pendingPtyId !== null && s.flattenedTreeIndex.has(insertion.pendingPtyId)
          );

          recomputeMatches(s);
          recomputeTree(s);
        })
      );
    }
  };

  const handlePtyCreated = (ptyId: string): Promise<void> => {
    lifecycleChain = lifecycleChain.then(() => handlePtyCreatedImpl(ptyId));
    return lifecycleChain;
  };

  const handlePtyDestroyed = (ptyId: string): void => {
    // Invalidate external caches while we have the ptyId before removal
    deps.onPtyDestroyed?.(ptyId);

    setState(
      produce((s) => {
        s.deletedPtyIds.add(ptyId);
        pruneDeletedPtyIds(s.deletedPtyIds);
        removeAggregateSessionMappingForPty(ptyId);
        s.pendingPtyIds.delete(ptyId);
        s.recentlyAddedPtyIds.delete(ptyId);

        const index = s.allPtysIndex.get(ptyId);
        if (index === undefined) return;

        const pty = s.allPtys[index];
        if (!pty) return;

        removePendingPaneCreations(
          s,
          (insertion) =>
            insertion.pendingPtyId === ptyId ||
            insertion.insertAfterPtyId === ptyId ||
            (!!pty.paneId && insertion.pendingPaneId === pty.paneId)
        );

        const sessionId = pty.sessionId;
        const removedFlattenedIndex = s.flattenedTreeIndex.get(ptyId);

        s.allPtys.splice(index, 1);
        s.allPtysIndex = buildPtyIndex(s.allPtys);

        const loadState = s.sessionLoadStates.get(sessionId);
        if (loadState) {
          const newPaneCount = Math.max(0, (loadState.paneCount ?? 1) - 1);
          s.sessionLoadStates.set(sessionId, {
            ...loadState,
            paneCount: newPaneCount,
          });
        }

        if (s.selectedPtyId === ptyId && removedFlattenedIndex !== undefined) {
          selectAfterPtyRemoval(s, ptyId);
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  return { handlePtyCreated, handlePtyDestroyed };
}

export interface MetadataChangeEvent {
  ptyId: string;
  title?: string;
  foregroundProcess?: string;
  cwd?: string;
}

export function createMetadataChangeHandler(
  setState: SetStoreFunction<AggregateViewState>
): (event: MetadataChangeEvent) => void {
  return (event: MetadataChangeEvent) => {
    setState(
      produce((s) => {
        let treeChanged = false;

        const allIndex = s.allPtysIndex.get(event.ptyId);
        if (allIndex !== undefined && s.allPtys[allIndex]) {
          const pty = s.allPtys[allIndex];
          if (pty.ptyId === event.ptyId) {
            let changed = false;
            if (event.title !== undefined && pty.title !== event.title) {
              changed = true;
              pty.title = event.title;
            }
            if (
              event.foregroundProcess !== undefined &&
              pty.foregroundProcess !== event.foregroundProcess
            ) {
              changed = true;
              pty.foregroundProcess = event.foregroundProcess;
            }
            if (event.cwd !== undefined && pty.cwd !== event.cwd) {
              changed = true;
              pty.cwd = event.cwd;
            }
            if (!changed) {
              s.allPtys[allIndex] = pty;
            } else {
              treeChanged = true;
            }
          }
        }

        const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
        if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
          const pty = s.matchedPtys[matchedIndex];
          if (pty.ptyId === event.ptyId) {
            let changed = false;
            if (event.title !== undefined && pty.title !== event.title) {
              changed = true;
              pty.title = event.title;
            }
            if (
              event.foregroundProcess !== undefined &&
              pty.foregroundProcess !== event.foregroundProcess
            ) {
              changed = true;
              pty.foregroundProcess = event.foregroundProcess;
            }
            if (event.cwd !== undefined && pty.cwd !== event.cwd) {
              changed = true;
              pty.cwd = event.cwd;
            }
            if (!changed) {
              s.matchedPtys[matchedIndex] = pty;
            } else {
              treeChanged = true;
            }
          }
        }

        // Must recompute the tree so flattenedTree nodes hold fresh references
        // to the updated PtyInfo objects. Without this, the tree drawer reads
        // stale cwd/title/foregroundProcess from the old immutable copies.
        if (treeChanged) {
          recomputeTree(s);
        }
      })
    );
  };
}

export async function setupSubscriptions(
  state: AggregateViewState,
  deps: SubscriptionSetupDeps
): Promise<void> {
  const { subscriptions, subscriptionsEpoch, handleMetadataChange, lifecycleHandlers } = deps;
  const refreshPtys = deps.refreshPtys;

  const epoch = ++subscriptionsEpoch.value;

  const tryInstall = (setup: () => () => void, slot: 'lifecycle' | 'metadataChanges'): boolean => {
    const unsub = setup();
    if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
      unsub();
      return false;
    }
    subscriptions[slot] = unsub;
    return true;
  };

  if (
    !tryInstall(
      () =>
        runStream(
          tap(
            streamFromSubscription<{ type: 'created' | 'destroyed'; ptyId: string }>(({ emit }) =>
              subscribeToPtyLifecycle(emit)
            ),
            (event) => {
              if (event.type === 'created') {
                void lifecycleHandlers.handlePtyCreated(event.ptyId);
                return;
              }
              lifecycleHandlers.handlePtyDestroyed(event.ptyId);
            }
          ),
          { label: 'aggregate-view-lifecycle' }
        ),
      'lifecycle'
    )
  ) {
    return;
  }

  if (
    !tryInstall(
      () =>
        runStream(
          tap(
            streamFromSubscription<PtyMetadataChangeEvent>(({ emit }) =>
              subscribeToMetadataChanges(emit)
            ),
            (event) => handleMetadataChange(event)
          ),
          { label: 'aggregate-view-metadata' }
        ),
      'metadataChanges'
    )
  ) {
    return;
  }

  const gitChangeUnsub = createGitRepoChangeRefresh(state, subscriptionsEpoch, epoch, refreshPtys);
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    gitChangeUnsub();
    return;
  }
  subscriptions.gitChanges = gitChangeUnsub;

  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    return;
  }

  const activityUnsub = createActivityBasedRefresh(state, subscriptionsEpoch, epoch, refreshPtys);
  if (epoch !== subscriptionsEpoch.value || !state.showAggregateView) {
    activityUnsub();
    return;
  }
  subscriptions.polling = activityUnsub;
}

export function createGitRepoChangeRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtys: () => Promise<void>
): () => void {
  return subscribeToGitRepoChanges((event) => {
    if (!state.showAggregateView || subscriptionsEpoch.value !== epoch) {
      return;
    }

    const affectedPtyIds = state.allPtys
      .filter((pty) => pty.gitRepoKey === event.repoKey)
      .map((pty) => pty.ptyId);

    if (affectedPtyIds.length === 0) {
      return;
    }

    void refreshPtys();
  });
}

export function createActivityBasedRefresh(
  state: AggregateViewState,
  subscriptionsEpoch: { value: number },
  epoch: number,
  refreshPtys: () => Promise<void>
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = 500;

  const flushPending = async (): Promise<void> => {
    debounceTimer = null;

    if (!state.showAggregateView) return;
    if (subscriptionsEpoch.value !== epoch) return;

    await refreshPtys();
  };

  const scheduleFlush = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void flushPending(), debounceMs);
  };

  const activityStream = streamFromSubscription<{ ptyId: string }>(({ emit }) =>
    subscribeToAllPtyActivity(emit)
  );

  const activityUnsub = runStream(
    tap(activityStream, () => {
      scheduleFlush();
    }),
    { label: 'aggregate-view-activity-refresh' }
  );

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    activityUnsub();
  };
}

export function cleanupSubscriptions(
  subscriptions: SubscriptionManager,
  subscriptionsEpoch: { value: number }
): void {
  subscriptionsEpoch.value += 1;
  for (const key of Object.keys(subscriptions) as Array<keyof SubscriptionManager>) {
    subscriptions[key]?.();
    subscriptions[key] = null;
  }
}
