/**
 * Action creators for AggregateViewContext.
 */

import { produce, type SetStoreFunction } from 'solid-js/store';
import type {
  PtyInfo,
  AggregateViewState,
  PendingPaneCreation,
  SessionLoadState,
  FlattenedTreeItem,
  SessionTreeNode,
} from './aggregate-view-types';
import { clearPreviewState, recomputeMatches, recomputeTree } from './aggregate-view-helpers';
import { selectAfterPtyRemoval as selectAfterPtyRemovalShared } from './aggregate/selection';
import {
  removePendingPaneCreations,
  upsertPendingPaneCreation,
} from './aggregate-view-pending-insertions';
import {
  getSessionPaneOrder,
  getSessionPaneOrderKey,
  getPendingPaneOrderKey,
  isPendingPaneOrderKey,
  setSessionPaneOrder,
} from './aggregate/pane-order';

export interface AggregateViewActionsParams {
  state: AggregateViewState;
  setState: SetStoreFunction<AggregateViewState>;
  refreshPtys: () => Promise<void>;
  /** Optional callback when creating a new pane in a session */
  onCreatePaneInSession?: (sessionId: string) => void;
  /** Persist manual aggregate session order */
  persistSessionOrder?: (order: string[]) => Promise<void>;
  /** The PTY ID that was focused before the aggregate view opened */
  getFocusedPtyId?: () => string | null;
}

export function createAggregateViewActions(params: AggregateViewActionsParams) {
  const { state, setState, refreshPtys, onCreatePaneInSession, persistSessionOrder } = params;

  const getSessionIdForItem = (item: FlattenedTreeItem | undefined): string | null => {
    if (!item) return null;
    if (item.node.type === 'session') return item.node.session.id;
    if (item.node.type === 'pty') return item.node.ptyInfo.sessionId;
    if (item.node.type === 'placeholder') return item.node.parentSessionId;
    return null;
  };

  const isSelectableItem = (item: FlattenedTreeItem | undefined): boolean => {
    return !!item && item.node.type !== 'spacer';
  };

  const findNearestSelectableIndex = (items: FlattenedTreeItem[], index: number): number | null => {
    if (items.length === 0) return null;
    if (isSelectableItem(items[index])) return index;

    for (let distance = 1; distance < items.length; distance++) {
      const lower = index - distance;
      if (lower >= 0 && isSelectableItem(items[lower])) return lower;
      const upper = index + distance;
      if (upper < items.length && isSelectableItem(items[upper])) return upper;
    }

    return null;
  };

  const applySelection = (s: AggregateViewState, index: number) => {
    const targetIndex = findNearestSelectableIndex(s.flattenedTree, index);
    if (targetIndex === null) {
      s.selectedIndex = 0;
      s.selectedPtyId = null;
      s.selectedSessionId = null;
      clearPreviewState(s);
      return;
    }

    const item = s.flattenedTree[targetIndex];
    s.selectedIndex = targetIndex;
    s.selectedPtyId = item?.node.type === 'pty' ? item.node.ptyInfo.ptyId : null;
    s.selectedSessionId = getSessionIdForItem(item);
    if (s.selectedPtyId === null) {
      clearPreviewState(s);
    }
  };

  const openAggregateView = () => {
    const focusedPtyId = params.getFocusedPtyId?.() ?? null;

    setState(
      produce((s) => {
        s.showAggregateView = true;
        s.filterQuery = '';
        s.pendingPaneCreations = [];
        s.listScrollOffset = 0;
        s.previewMode = true;
        s.previewZoomed = false;
        recomputeMatches(s);
        recomputeTree(s);

        // Prefer the focused PTY (the one the user was working on before
        // opening the aggregate view). Fall back to the first PTY in the tree.
        if (focusedPtyId) {
          const focusedIndex = s.flattenedTreeIndex.get(focusedPtyId);
          if (focusedIndex !== undefined) {
            applySelection(s, focusedIndex);
            return;
          }
        }

        const firstPtyIndex = s.flattenedTree.findIndex((item) => item.node.type === 'pty');
        if (firstPtyIndex >= 0) {
          applySelection(s, firstPtyIndex);
        } else {
          applySelection(s, 0);
        }
      })
    );
  };

  const closeAggregateView = () => {
    setState(
      produce((s) => {
        s.showAggregateView = false;
        s.filterQuery = '';
        s.selectedIndex = 0;
        s.selectedPtyId = null;
        s.selectedSessionId = null;
        s.pendingPaneCreations = [];
        s.listScrollOffset = 0;
        s.showPtyPicker = false;
        clearPreviewState(s);
      })
    );
  };

  const setFilterQuery = (query: string) => {
    setState(
      produce((s) => {
        s.filterQuery = query;
        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  const toggleShowInactive = () => {
    setState(
      produce((s) => {
        s.showInactive = !s.showInactive;
        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  // Tree-Aware Navigation

  const navigateUp = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex - 1;
    while (nextIndex >= 0 && !isSelectableItem(state.flattenedTree[nextIndex])) {
      nextIndex -= 1;
    }
    if (nextIndex < 0) return;

    setState(
      produce((s) => {
        applySelection(s, nextIndex);
      })
    );
  };

  const navigateDown = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex + 1;
    while (
      nextIndex < state.flattenedTree.length &&
      !isSelectableItem(state.flattenedTree[nextIndex])
    ) {
      nextIndex += 1;
    }
    if (nextIndex >= state.flattenedTree.length) return;

    setState(
      produce((s) => {
        applySelection(s, nextIndex);
      })
    );
  };

  /** Navigate to previous PTY only (skips session headers/placeholders).
   * Used in preview mode to stay in preview while switching panes. */
  const navigateToPrevPty = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex - 1;
    while (nextIndex >= 0) {
      const item = state.flattenedTree[nextIndex];
      if (item?.node.type === 'pty') break;
      nextIndex -= 1;
    }
    if (nextIndex < 0) return;

    setState(
      produce((s) => {
        applySelection(s, nextIndex);
      })
    );
  };

  /** Navigate to next PTY only (skips session headers/placeholders).
   * Used in preview mode to stay in preview while switching panes. */
  const navigateToNextPty = () => {
    if (state.flattenedTree.length === 0) return;

    let nextIndex = state.selectedIndex + 1;
    while (nextIndex < state.flattenedTree.length) {
      const item = state.flattenedTree[nextIndex];
      if (item?.node.type === 'pty') break;
      nextIndex += 1;
    }
    if (nextIndex >= state.flattenedTree.length) return;

    setState(
      produce((s) => {
        applySelection(s, nextIndex);
      })
    );
  };

  const setSelectedIndex = (index: number) => {
    if (state.flattenedTree.length === 0) return;
    const maxIndex = Math.max(0, state.flattenedTree.length - 1);
    const clamped = Math.min(maxIndex, Math.max(0, index));

    setState(
      produce((s) => {
        applySelection(s, clamped);
      })
    );
  };

  const selectPty = (ptyId: string) => {
    const index = state.flattenedTreeIndex.get(ptyId);
    if (index !== undefined) {
      setState(
        produce((s) => {
          applySelection(s, index);
        })
      );
    }
  };

  /**
   * Get the currently selected PTY info.
   * Uses flattened tree for O(1) access.
   */
  const getSelectedPty = (): PtyInfo | null => {
    const item = state.flattenedTree[state.selectedIndex];
    if (item?.node.type === 'pty') {
      return item.node.ptyInfo;
    }
    return null;
  };

  const enterPreviewMode = () => {
    setState('previewMode', true);
  };

  const exitPreviewMode = () => {
    setState(
      produce((s) => {
        clearPreviewState(s);
      })
    );
  };

  const togglePreviewZoom = () => {
    setState(
      produce((s) => {
        if (!s.previewMode || !s.selectedPtyId) return;
        s.previewZoomed = !s.previewZoomed;
      })
    );
  };

  // Lazy Loading: Session PTY Loading on Demand

  /**
   * Attempt to load session PTYs on demand.
   *
   * Single-writer principle: do NOT push directly to allPtys here.
   * Instead, trigger a refreshPtys() which will rebuild the snapshot
   * from authoritative sources and apply it via applySnapshot.
   * The snapshot includes all sessions (including lazy-loaded ones) via
   * loadSession and getCurrentSessionPtys.
   */
  const loadSessionPtys = async (sessionId: string): Promise<void> => {
    if (state.loadingSessionIds.has(sessionId)) return;

    setState(
      produce((s) => {
        s.loadingSessionIds.add(sessionId);
        s.loadAttemptedSessionIds.add(sessionId);
        s.sessionLoadStates.set(sessionId, {
          status: 'loading',
        });
        recomputeTree(s);
      })
    );

    // Single writer: let refreshPtys handle everything.
    // It will load the session from disk, build the snapshot,
    // and apply it atomically via applySnapshot.
    await refreshPtys();
  };

  /** Get the loading state for a session */
  const getSessionLoadState = (sessionId: string): SessionLoadState | undefined => {
    return state.sessionLoadStates.get(sessionId);
  };

  /** Check if a session is currently loading */
  const isSessionLoading = (sessionId: string): boolean => {
    return state.loadingSessionIds.has(sessionId);
  };

  // Session Tree Navigation

  /** Toggle session expansion (collapse/expand PTYs under a session) */
  const toggleSessionExpanded = (sessionId: string) => {
    setState(
      produce((s) => {
        if (s.expandedSessionIds.has(sessionId)) {
          s.expandedSessionIds.delete(sessionId);
        } else {
          s.expandedSessionIds.add(sessionId);
        }
        recomputeTree(s);
      })
    );
  };

  /** Expand all sessions */
  const expandAllSessions = () => {
    setState(
      produce((s) => {
        for (const node of s.treeRoot) {
          if (node.type === 'session' && node.loadState.status === 'loaded') {
            s.expandedSessionIds.add(node.session.id);
          }
        }
        recomputeTree(s);
      })
    );
  };

  /** Collapse all sessions */
  const collapseAllSessions = () => {
    setState(
      produce((s) => {
        s.expandedSessionIds.clear();
        recomputeTree(s);
      })
    );
  };

  /** Get flattened item at index */
  const getFlattenedItem = (index: number): FlattenedTreeItem | undefined => {
    return state.flattenedTree[index];
  };

  /** Get the currently selected flattened item */
  const getSelectedItem = (): FlattenedTreeItem | undefined => {
    return state.flattenedTree[state.selectedIndex];
  };

  /**
   * Smart selection after removing a PTY.
   * Delegates to the shared selectAfterPtyRemoval from aggregate/selection.
   */
  const handleSelectAfterPtyRemoval = (removedPtyId: string): void => {
    setState(
      produce((s) => {
        selectAfterPtyRemovalShared(s, removedPtyId);
      })
    );
  };

  /** Get the session ID for the currently selected item (PTY or session header) */
  const getSelectedSessionId = (): string | null => {
    const item = getSelectedItem();
    if (!item) return null;

    if (item.node.type === 'pty') {
      return item.node.ptyInfo.sessionId;
    } else if (item.node.type === 'session') {
      return item.node.session.id;
    } else if (item.node.type === 'placeholder') {
      return item.node.parentSessionId;
    }
    return null;
  };

  // List Scrolling

  /** Scroll the list up by a specified amount (default: 3 lines) */
  const scrollListUp = (amount: number = 3) => {
    setState('listScrollOffset', (current) => Math.max(0, current - amount));
  };

  /** Scroll the list down by a specified amount (default: 3 lines) */
  const scrollListDown = (amount: number = 3) => {
    setState('listScrollOffset', (current) => {
      const maxOffset = Math.max(0, state.flattenedTree.length - 1);
      return Math.min(maxOffset, current + amount);
    });
  };

  /** Set the list scroll offset directly */
  const setListScrollOffset = (offset: number) => {
    const maxOffset = Math.max(0, state.flattenedTree.length - 1);
    setState('listScrollOffset', Math.max(0, Math.min(maxOffset, offset)));
  };

  /** Create a new pane in the currently selected session */
  const createNewPaneInSelectedSession = (): boolean => {
    const sessionId = getSelectedSessionId();
    if (!sessionId || !onCreatePaneInSession) return false;

    onCreatePaneInSession(sessionId);
    return true;
  };

  const reorderSessions = async (
    sourceSessionId: string,
    targetSessionId: string
  ): Promise<void> => {
    if (sourceSessionId === targetSessionId) return;

    const currentOrder = state.treeRoot
      .filter((node): node is SessionTreeNode => node.type === 'session')
      .map((node) => String(node.session.id));

    const sourceIndex = currentOrder.indexOf(sourceSessionId);
    const targetIndex = currentOrder.indexOf(targetSessionId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextOrder = [...currentOrder];
    const movingDown = sourceIndex < targetIndex;
    const [movedSessionId] = nextOrder.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextOrder.indexOf(targetSessionId);
    if (!movedSessionId || targetIndexAfterRemoval === -1) return;
    const insertIndex = movingDown ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
    nextOrder.splice(insertIndex, 0, movedSessionId);

    setState(
      produce((s) => {
        s.manualSessionOrder = nextOrder;
        recomputeTree(s);
      })
    );

    await persistSessionOrder?.(nextOrder);
  };

  /** Add or update a pending aggregate pane insertion request */
  const upsertAggregatePendingPaneCreation = (insertion: PendingPaneCreation): void => {
    setState(
      produce((s) => {
        upsertPendingPaneCreation(s, insertion);

        // Stamp the pending insertion's sortOrderHint into the session pane order
        // index so that sortPtysForSession uses the correct (adjacent) position
        // instead of the layout-tree traversal order which puts new panes at the end.
        if (insertion.sortOrderHint !== undefined) {
          // Use real paneId if available, otherwise use a synthetic key derived
          // from the pending creation ID. This ensures the sort position is
          // preserved even before the real paneId is assigned.
          const paneIdForOrder = insertion.pendingPaneId ?? getPendingPaneOrderKey(insertion.id);
          const key = getSessionPaneOrderKey(insertion.sessionId, paneIdForOrder);
          const existingOrder = s.sessionPaneOrderIndex.get(key);
          // Only override if the sortOrderHint is different from what the layout
          // traversal assigned (which is typically an end-of-list index).
          if (existingOrder !== insertion.sortOrderHint) {
            const sessionPaneOrder = getSessionPaneOrder(
              s.sessionPaneOrderIndex,
              insertion.sessionId
            );
            sessionPaneOrder.set(paneIdForOrder, insertion.sortOrderHint);
            // When the real paneId is now known, remove the old synthetic key.
            if (insertion.pendingPaneId) {
              const pendingKey = getPendingPaneOrderKey(insertion.id);
              if (sessionPaneOrder.has(pendingKey)) {
                sessionPaneOrder.delete(pendingKey);
              }
            }
            setSessionPaneOrder(s.sessionPaneOrderIndex, insertion.sessionId, sessionPaneOrder);
          }
        }

        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  /** Remove a specific pending aggregate pane insertion request */
  const removePendingPaneCreation = (id: string): void => {
    setState(
      produce((s) => {
        const insertion = s.pendingPaneCreations.find((i) => i.id === id);
        // Clean up the synthetic key from sessionPaneOrderIndex if the pending
        // creation never resolved to a real paneId.
        if (insertion && !insertion.pendingPaneId && insertion.sortOrderHint !== undefined) {
          const sessionPaneOrder = getSessionPaneOrder(
            s.sessionPaneOrderIndex,
            insertion.sessionId
          );
          const pendingKey = getPendingPaneOrderKey(insertion.id);
          if (sessionPaneOrder.has(pendingKey)) {
            sessionPaneOrder.delete(pendingKey);
            setSessionPaneOrder(s.sessionPaneOrderIndex, insertion.sessionId, sessionPaneOrder);
          }
        }
        removePendingPaneCreations(s, (insertion) => insertion.id === id);
        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  /** Clear all pending aggregate pane insertion requests */
  const clearPendingPaneCreations = (): void => {
    setState(
      produce((s) => {
        // Clean up all synthetic pending keys from sessionPaneOrderIndex.
        const sessionsToClean = new Set<string>();
        for (const insertion of s.pendingPaneCreations) {
          if (!insertion.pendingPaneId && insertion.sortOrderHint !== undefined) {
            sessionsToClean.add(insertion.sessionId);
          }
        }
        for (const sessionId of sessionsToClean) {
          const sessionPaneOrder = getSessionPaneOrder(s.sessionPaneOrderIndex, sessionId);
          let changed = false;
          for (const key of [...sessionPaneOrder.keys()]) {
            if (isPendingPaneOrderKey(key)) {
              sessionPaneOrder.delete(key);
              changed = true;
            }
          }
          if (changed) {
            setSessionPaneOrder(s.sessionPaneOrderIndex, sessionId, sessionPaneOrder);
          }
        }
        s.pendingPaneCreations = [];
        recomputeMatches(s);
        recomputeTree(s);
      })
    );
  };

  /** Open the PTY picker overlay */
  const openPtyPicker = () => {
    setState('showPtyPicker', true);
  };

  /** Close the PTY picker overlay */
  const closePtyPicker = () => {
    setState('showPtyPicker', false);
  };

  /** Maximum MRU stack depth */
  const MRU_CAPACITY = 8;

  /** Push a PTY ID onto the MRU stack (dedup + reorder, LIFO) */
  const pushPtyMru = (ptyId: string) => {
    setState(
      produce((s) => {
        const filtered = s.ptyMru.filter((id) => id !== ptyId);
        s.ptyMru = [ptyId, ...filtered].slice(0, MRU_CAPACITY);
      })
    );
  };

  return {
    openAggregateView,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    navigateToPrevPty,
    navigateToNextPty,
    setSelectedIndex,
    selectPty,
    getSelectedPty,
    getSelectedSessionId,
    createNewPaneInSelectedSession,
    enterPreviewMode,
    exitPreviewMode,
    togglePreviewZoom,
    reorderSessions,
    // Lazy loading
    loadSessionPtys,
    getSessionLoadState,
    isSessionLoading,
    // Session tree
    toggleSessionExpanded,
    expandAllSessions,
    collapseAllSessions,
    getFlattenedItem,
    getSelectedItem,
    // Smart selection on close/kill
    selectAfterPtyRemoval: handleSelectAfterPtyRemoval,
    // List scrolling
    scrollListUp,
    scrollListDown,
    setListScrollOffset,
    upsertPendingPaneCreation: upsertAggregatePendingPaneCreation,
    removePendingPaneCreation,
    clearPendingPaneCreations,
    openPtyPicker,
    closePtyPicker,
    pushPtyMru,
  };
}
