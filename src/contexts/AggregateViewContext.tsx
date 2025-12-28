/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { listAllPtysWithMetadata, getPtyMetadata, subscribeToPtyLifecycle, subscribeToAllTitleChanges } from '../effect/bridge';
import type { GitInfo } from '../effect/services/pty/helpers';

// =============================================================================
// State Types
// =============================================================================

/** Git diff statistics */
export interface GitDiffStats {
  added: number;
  removed: number;
}

/** PTY info for the aggregate view */
export interface PtyInfo {
  ptyId: string;
  cwd: string;
  gitBranch: string | undefined;
  gitDiffStats: GitDiffStats | undefined;
  gitDirty: boolean;
  gitStaged: number;
  gitUnstaged: number;
  gitUntracked: number;
  gitConflicted: number;
  gitAhead: number | undefined;
  gitBehind: number | undefined;
  gitStashCount: number | undefined;
  gitState: GitInfo["state"] | undefined;
  gitDetached: boolean;
  gitRepoKey: string | undefined;
  foregroundProcess: string | undefined;
  shell: string | undefined;
  /** Workspace ID where this PTY is located (if found in current session) */
  workspaceId: number | undefined;
  /** Pane ID where this PTY is located (if found in current session) */
  paneId: string | undefined;
}

interface AggregateViewState {
  /** Whether the aggregate view overlay is shown */
  showAggregateView: boolean;
  /** Current filter query text */
  filterQuery: string;
  /** Whether to include inactive PTYs in the list/search */
  showInactive: boolean;
  /** All PTYs from all sessions */
  allPtys: PtyInfo[];
  /** PTYs matching the current filter */
  matchedPtys: PtyInfo[];
  /** Index of selected PTY in the list */
  selectedIndex: number;
  /** PTY ID currently selected for viewing */
  selectedPtyId: string | null;
  /** Whether a query is in progress */
  isLoading: boolean;
  /** Whether in interactive preview mode (vs list mode) */
  previewMode: boolean;
  /** Map from ptyId to index in allPtys for O(1) lookup */
  allPtysIndex: Map<string, number>;
  /** Map from ptyId to index in matchedPtys for O(1) lookup */
  matchedPtysIndex: Map<string, number>;
}

const initialState: AggregateViewState = {
  showAggregateView: false,
  filterQuery: '',
  showInactive: false,
  allPtys: [],
  matchedPtys: [],
  selectedIndex: 0,
  selectedPtyId: null,
  isLoading: false,
  previewMode: false,
  allPtysIndex: new Map(),
  matchedPtysIndex: new Map(),
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Debounce a function - delays execution until after wait ms have elapsed
 * since the last call. Useful for reducing rapid successive calls.
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

/** Filter PTYs by search query (matches cwd, git branch, or process) */
function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  if (!query.trim()) return ptys;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return ptys;

  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    // OR logic: match if ANY term matches ANY field
    return terms.some((term) =>
      cwd.includes(term) || branch.includes(term) || process.includes(term)
    );
  });
}

/** Normalize process names for comparisons (strip paths, lowercase) */
function normalizeProcessName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.toLowerCase();
}

/** Active PTY = foreground process is not just the shell */
function isActivePty(pty: PtyInfo): boolean {
  const processName = normalizeProcessName(pty.foregroundProcess);
  if (!processName) return false;
  const shellName = normalizeProcessName(pty.shell);
  if (!shellName) return true;
  return processName !== shellName;
}

/** Filter PTYs to only those with active foreground processes */
function filterActivePtys(ptys: PtyInfo[]): PtyInfo[] {
  return ptys.filter(isActivePty);
}

/** Apply active/inactive filtering based on scope flag */
function getBasePtys(ptys: PtyInfo[], showInactive: boolean): PtyInfo[] {
  return showInactive ? ptys : filterActivePtys(ptys);
}

/** Build an index map from ptyId to array index for O(1) lookups */
function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}

function recomputeMatches(state: AggregateViewState) {
  const basePtys = getBasePtys(state.allPtys, state.showInactive);
  const matchedPtys = filterPtys(basePtys, state.filterQuery);
  const matchedPtysIndex = buildPtyIndex(matchedPtys);
  const currentSelectedPtyId = state.selectedPtyId;
  const currentPtyIndex = currentSelectedPtyId ? matchedPtysIndex.get(currentSelectedPtyId) : undefined;
  const currentPtyStillExists = currentPtyIndex !== undefined;
  const newSelectedIndex = currentPtyStillExists
    ? currentPtyIndex
    : Math.min(state.selectedIndex, Math.max(0, matchedPtys.length - 1));
  const selectedPtyId = matchedPtys[newSelectedIndex]?.ptyId ?? null;

  state.matchedPtys = matchedPtys;
  state.matchedPtysIndex = matchedPtysIndex;
  state.selectedIndex = newSelectedIndex;
  state.selectedPtyId = selectedPtyId;
  if (!currentPtyStillExists || selectedPtyId === null) {
    state.previewMode = false;
  }
}

// =============================================================================
// Context
// =============================================================================

interface AggregateViewContextValue {
  state: AggregateViewState;
  openAggregateView: () => void;
  closeAggregateView: () => void;
  setFilterQuery: (query: string) => void;
  toggleShowInactive: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  selectPty: (ptyId: string) => void;
  getSelectedPty: () => PtyInfo | null;
  refreshPtys: () => Promise<void>;
  enterPreviewMode: () => void;
  exitPreviewMode: () => void;
}

const AggregateViewContext = createContext<AggregateViewContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface AggregateViewProviderProps extends ParentProps {}

export function AggregateViewProvider(props: AggregateViewProviderProps) {
  const [state, setState] = createStore<AggregateViewState>(initialState);

  // Track if a refresh is in progress to prevent overlapping calls
  let refreshInProgress = false;

  // Fetch all PTYs from all sessions
  const refreshPtys = async () => {
    // Skip if a refresh is already in progress
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      setState('isLoading', true);
      const ptys = await listAllPtysWithMetadata({ skipGitDiffStats: true });

      setState(produce((s) => {
        const merged = ptys.map((pty) => {
          const prevIndex = s.allPtysIndex.get(pty.ptyId);
          if (prevIndex === undefined) return pty;
          const prev = s.allPtys[prevIndex];
          const repoChanged =
            prev.cwd !== pty.cwd ||
            prev.gitBranch !== pty.gitBranch ||
            prev.gitDirty !== pty.gitDirty ||
            prev.gitStaged !== pty.gitStaged ||
            prev.gitUnstaged !== pty.gitUnstaged ||
            prev.gitUntracked !== pty.gitUntracked ||
            prev.gitConflicted !== pty.gitConflicted ||
            prev.gitRepoKey !== pty.gitRepoKey;
          const gitDiffStats =
            pty.gitDiffStats ?? (repoChanged ? undefined : prev.gitDiffStats);
          return { ...pty, gitDiffStats };
        });

        s.allPtys = merged;
        s.allPtysIndex = buildPtyIndex(merged);
        s.isLoading = false;
        recomputeMatches(s);
      }));
    } finally {
      refreshInProgress = false;
    }
  };

  // Consolidated subscription manager
  interface SubscriptionManager {
    lifecycle: (() => void) | null;
    titleChange: (() => void) | null;
    pollingActive: ReturnType<typeof setInterval> | null;
    pollingInactive: ReturnType<typeof setInterval> | null;
  }

  const subscriptions: SubscriptionManager = {
    lifecycle: null,
    titleChange: null,
    pollingActive: null,
    pollingInactive: null,
  };
  let subscriptionsEpoch = 0;

  // Incremental title update handler - O(1) instead of full refresh
  const handleTitleChange = (event: { ptyId: string; title: string }) => {
    setState(produce((s) => {
      // Update in allPtys using O(1) lookup
      const allIndex = s.allPtysIndex.get(event.ptyId);
      if (allIndex !== undefined && s.allPtys[allIndex]) {
        s.allPtys[allIndex] = { ...s.allPtys[allIndex], foregroundProcess: event.title };
      }
      // Update in matchedPtys using O(1) lookup
      const matchedIndex = s.matchedPtysIndex.get(event.ptyId);
      if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
        s.matchedPtys[matchedIndex] = { ...s.matchedPtys[matchedIndex], foregroundProcess: event.title };
      }
    }));
  };

  // Debounced refresh for lifecycle events - prevents cascading refreshes
  // when multiple panes are created/destroyed rapidly
  const debouncedRefreshPtys = debounce(() => refreshPtys(), 100);

  const syncGitFields = (target: PtyInfo, update: PtyInfo) => {
    if (target.gitRepoKey !== update.gitRepoKey) {
      target.gitRepoKey = update.gitRepoKey;
    }
    if (target.cwd !== update.cwd) {
      target.cwd = update.cwd;
    }
    if (target.gitBranch !== update.gitBranch) {
      target.gitBranch = update.gitBranch;
    }
    if (target.gitDirty !== update.gitDirty) {
      target.gitDirty = update.gitDirty;
    }
    if (target.gitStaged !== update.gitStaged) {
      target.gitStaged = update.gitStaged;
    }
    if (target.gitUnstaged !== update.gitUnstaged) {
      target.gitUnstaged = update.gitUnstaged;
    }
    if (target.gitUntracked !== update.gitUntracked) {
      target.gitUntracked = update.gitUntracked;
    }
    if (target.gitConflicted !== update.gitConflicted) {
      target.gitConflicted = update.gitConflicted;
    }
    if (target.gitAhead !== update.gitAhead) {
      target.gitAhead = update.gitAhead;
    }
    if (target.gitBehind !== update.gitBehind) {
      target.gitBehind = update.gitBehind;
    }
    if (target.gitStashCount !== update.gitStashCount) {
      target.gitStashCount = update.gitStashCount;
    }
    if (target.gitState !== update.gitState) {
      target.gitState = update.gitState;
    }
    if (target.gitDetached !== update.gitDetached) {
      target.gitDetached = update.gitDetached;
    }
    // Keep diff stats until refreshed to avoid flicker on status updates.
  };

  const applyRepoUpdate = (
    list: PtyInfo[],
    update: PtyInfo,
    options: { applyDiffStats?: boolean } = {}
  ) => {
    const repoKey = update.gitRepoKey;
    if (!repoKey) return;

    for (const pty of list) {
      if (pty.gitRepoKey !== repoKey) continue;
      syncGitFields(pty, update);
      if (options.applyDiffStats && update.gitDiffStats !== undefined) {
        pty.gitDiffStats = update.gitDiffStats;
      }
    }
  };

  let subsetRefreshInProgress = false;
  const refreshPtysSubset = async (ptyIds: string[]) => {
    if (subsetRefreshInProgress || ptyIds.length === 0) return;
    subsetRefreshInProgress = true;

    try {
      const results = await Promise.all(
        ptyIds.map((id) => getPtyMetadata(id, { skipGitDiffStats: true }))
      );
      const updates = results.filter((result): result is PtyInfo => result !== null);

      if (updates.length === 0) return;

      setState(produce((s) => {
        const updatedRepos = new Set<string>();
        for (const update of updates) {
          const index = s.allPtysIndex.get(update.ptyId);
          if (index === undefined || !s.allPtys[index]) continue;
          if (s.allPtys[index].foregroundProcess !== update.foregroundProcess) {
            s.allPtys[index].foregroundProcess = update.foregroundProcess;
          }
          syncGitFields(s.allPtys[index], update);
          if (update.gitRepoKey && !updatedRepos.has(update.gitRepoKey)) {
            updatedRepos.add(update.gitRepoKey);
            applyRepoUpdate(s.allPtys, update);
          }
        }

        recomputeMatches(s);
      }));
    } finally {
      subsetRefreshInProgress = false;
    }
  };

  let selectedDiffRefreshInProgress = false;
  const refreshSelectedDiffStats = async (ptyId: string) => {
    if (selectedDiffRefreshInProgress) return;
    selectedDiffRefreshInProgress = true;

    try {
      const update = await getPtyMetadata(ptyId, { skipGitDiffStats: false });
      if (!update) return;

      setState(produce((s) => {
        const index = s.allPtysIndex.get(update.ptyId);
        if (index !== undefined && s.allPtys[index]) {
          syncGitFields(s.allPtys[index], update);
          s.allPtys[index].gitDiffStats = update.gitDiffStats;
        }
        const matchedIndex = s.matchedPtysIndex.get(update.ptyId);
        if (matchedIndex !== undefined && s.matchedPtys[matchedIndex]) {
          syncGitFields(s.matchedPtys[matchedIndex], update);
          s.matchedPtys[matchedIndex].gitDiffStats = update.gitDiffStats;
        }

        applyRepoUpdate(s.allPtys, update, { applyDiffStats: true });
        applyRepoUpdate(s.matchedPtys, update, { applyDiffStats: true });
      }));
    } finally {
      selectedDiffRefreshInProgress = false;
    }
  };

  const setupSubscriptions = async () => {
    const epoch = ++subscriptionsEpoch;
    // Subscribe to PTY lifecycle events for auto-refresh (created/destroyed)
    // Use debounced refresh to prevent animation stutter from rapid events
    const lifecycleUnsub = await subscribeToPtyLifecycle(() => {
      debouncedRefreshPtys();
    });
    if (epoch !== subscriptionsEpoch || !state.showAggregateView) {
      lifecycleUnsub();
      return;
    }
    subscriptions.lifecycle = lifecycleUnsub;

    // Subscribe to title changes - use incremental update instead of full refresh
    const titleUnsub = await subscribeToAllTitleChanges(handleTitleChange);
    if (epoch !== subscriptionsEpoch || !state.showAggregateView) {
      titleUnsub();
      return;
    }
    subscriptions.titleChange = titleUnsub;

    // Dynamic polling: active PTYs update faster, inactive slower.
    if (epoch !== subscriptionsEpoch || !state.showAggregateView) {
      return;
    }
    const activePollMs = 2000;
    const inactivePollMs = 10000;

    subscriptions.pollingActive = setInterval(() => {
      if (!state.showAggregateView || state.allPtys.length === 0) return;
      const activeIds = new Set(state.allPtys.filter(isActivePty).map((pty) => pty.ptyId));
      if (state.selectedPtyId) activeIds.add(state.selectedPtyId);
      refreshPtysSubset(Array.from(activeIds));
    }, activePollMs);

    subscriptions.pollingInactive = setInterval(() => {
      if (!state.showAggregateView || state.allPtys.length === 0) return;
      const activeIds = new Set(state.allPtys.filter(isActivePty).map((pty) => pty.ptyId));
      if (state.selectedPtyId) activeIds.add(state.selectedPtyId);
      const inactiveIds = state.allPtys
        .filter((pty) => !activeIds.has(pty.ptyId))
        .map((pty) => pty.ptyId);
      refreshPtysSubset(inactiveIds);
    }, inactivePollMs);
  };

  const cleanupSubscriptions = () => {
    subscriptionsEpoch += 1;
    subscriptions.lifecycle?.();
    subscriptions.titleChange?.();
    if (subscriptions.pollingActive) clearInterval(subscriptions.pollingActive);
    if (subscriptions.pollingInactive) clearInterval(subscriptions.pollingInactive);
    subscriptions.lifecycle = null;
    subscriptions.titleChange = null;
    subscriptions.pollingActive = null;
    subscriptions.pollingInactive = null;
  };

  // Refresh PTYs when view opens and subscribe to lifecycle/title events
  createEffect(() => {
    if (state.showAggregateView) {
      // Initial refresh then setup subscriptions
      refreshPtys();
      setupSubscriptions();
    } else {
      cleanupSubscriptions();
    }
  });

  createEffect(() => {
    if (!state.showAggregateView) return;
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;
    refreshSelectedDiffStats(selectedPtyId);
  });

  // Cleanup on unmount
  onCleanup(() => {
    cleanupSubscriptions();
  });

  // Actions
  const openAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = true;
      s.filterQuery = '';
      s.selectedIndex = 0;
      const basePtys = getBasePtys(s.allPtys, s.showInactive);
      s.matchedPtys = basePtys;
      s.matchedPtysIndex = buildPtyIndex(basePtys);
      s.selectedPtyId = basePtys[0]?.ptyId ?? null;
    }));
  };

  const closeAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = false;
      s.filterQuery = '';
      s.selectedIndex = 0;
      s.previewMode = false;
    }));
  };

  const setFilterQuery = (query: string) => {
    const basePtys = getBasePtys(state.allPtys, state.showInactive);
    const matchedPtys = filterPtys(basePtys, query);
    const matchedPtysIndex = buildPtyIndex(matchedPtys);
    setState(produce((s) => {
      s.filterQuery = query;
      s.matchedPtys = matchedPtys;
      s.matchedPtysIndex = matchedPtysIndex;
      s.selectedIndex = 0;
      s.selectedPtyId = matchedPtys[0]?.ptyId ?? null;
    }));
  };

  const toggleShowInactive = () => {
    setState(produce((s) => {
      s.showInactive = !s.showInactive;
      const basePtys = getBasePtys(s.allPtys, s.showInactive);
      const matchedPtys = filterPtys(basePtys, s.filterQuery);
      const matchedPtysIndex = buildPtyIndex(matchedPtys);
      const currentSelectedPtyId = s.selectedPtyId;
      const currentPtyIndex = currentSelectedPtyId ? matchedPtysIndex.get(currentSelectedPtyId) : undefined;
      const currentPtyStillExists = currentPtyIndex !== undefined;
      const newSelectedIndex = currentPtyStillExists
        ? currentPtyIndex
        : Math.min(s.selectedIndex, Math.max(0, matchedPtys.length - 1));
      const selectedPtyId = matchedPtys[newSelectedIndex]?.ptyId ?? null;

      s.matchedPtys = matchedPtys;
      s.matchedPtysIndex = matchedPtysIndex;
      s.selectedIndex = newSelectedIndex;
      s.selectedPtyId = selectedPtyId;
      if (!currentPtyStillExists || selectedPtyId === null) {
        s.previewMode = false;
      }
    }));
  };

  const navigateUp = () => {
    const newIndex = Math.max(0, state.selectedIndex - 1);
    setState(produce((s) => {
      s.selectedIndex = newIndex;
      s.selectedPtyId = s.matchedPtys[newIndex]?.ptyId ?? null;
    }));
  };

  const navigateDown = () => {
    const newIndex = Math.min(state.matchedPtys.length - 1, state.selectedIndex + 1);
    setState(produce((s) => {
      s.selectedIndex = newIndex;
      s.selectedPtyId = s.matchedPtys[newIndex]?.ptyId ?? null;
    }));
  };

  const selectPty = (ptyId: string) => {
    setState(produce((s) => {
      s.selectedPtyId = ptyId;
      // O(1) lookup instead of findIndex
      s.selectedIndex = s.matchedPtysIndex.get(ptyId) ?? -1;
    }));
  };

  const getSelectedPty = (): PtyInfo | null => {
    if (state.selectedPtyId === null) return null;
    // O(1) lookup using index then direct access
    const index = state.matchedPtysIndex.get(state.selectedPtyId);
    return index !== undefined ? state.matchedPtys[index] ?? null : null;
  };

  const enterPreviewMode = () => {
    setState('previewMode', true);
  };

  const exitPreviewMode = () => {
    setState('previewMode', false);
  };

  const value: AggregateViewContextValue = {
    state,
    openAggregateView,
    closeAggregateView,
    setFilterQuery,
    toggleShowInactive,
    navigateUp,
    navigateDown,
    selectPty,
    getSelectedPty,
    refreshPtys,
    enterPreviewMode,
    exitPreviewMode,
  };

  return (
    <AggregateViewContext.Provider value={value}>
      {props.children}
    </AggregateViewContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useAggregateView(): AggregateViewContextValue {
  const context = useContext(AggregateViewContext);
  if (!context) {
    throw new Error('useAggregateView must be used within AggregateViewProvider');
  }
  return context;
}
