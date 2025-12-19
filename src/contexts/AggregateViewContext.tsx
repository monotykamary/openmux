/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  onCleanup,
  batch,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { listAllPtysWithMetadata, subscribeToPtyLifecycle, subscribeToAllTitleChanges } from '../effect/bridge';

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
  foregroundProcess: string | undefined;
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

/** Build an index map from ptyId to array index for O(1) lookups */
function buildPtyIndex(ptys: PtyInfo[]): Map<string, number> {
  return new Map(ptys.map((p, i) => [p.ptyId, i]));
}

// =============================================================================
// Context
// =============================================================================

interface AggregateViewContextValue {
  state: AggregateViewState;
  openAggregateView: () => void;
  closeAggregateView: () => void;
  setFilterQuery: (query: string) => void;
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
      const ptys = await listAllPtysWithMetadata();
      const matchedPtys = filterPtys(ptys, state.filterQuery);

      // Build O(1) lookup indexes
      const allPtysIndex = buildPtyIndex(ptys);
      const matchedPtysIndex = buildPtyIndex(matchedPtys);

      // Determine new selected PTY using O(1) lookup
      const currentSelectedPtyId = state.selectedPtyId;
      const currentPtyIndex = currentSelectedPtyId ? matchedPtysIndex.get(currentSelectedPtyId) : undefined;
      const currentPtyStillExists = currentPtyIndex !== undefined;

      // If currently selected PTY was destroyed, exit preview mode and select next available
      const newSelectedIndex = currentPtyStillExists
        ? currentPtyIndex
        : Math.min(state.selectedIndex, Math.max(0, matchedPtys.length - 1));
      const selectedPtyId = matchedPtys[newSelectedIndex]?.ptyId ?? null;

      setState(produce((s) => {
        s.allPtys = ptys;
        s.matchedPtys = matchedPtys;
        s.allPtysIndex = allPtysIndex;
        s.matchedPtysIndex = matchedPtysIndex;
        s.selectedIndex = newSelectedIndex;
        s.selectedPtyId = selectedPtyId;
        s.isLoading = false;
        // Exit preview mode if the selected PTY was destroyed or no PTYs remain
        if (!currentPtyStillExists || selectedPtyId === null) {
          s.previewMode = false;
        }
      }));
    } finally {
      refreshInProgress = false;
    }
  };

  // Consolidated subscription manager
  interface SubscriptionManager {
    lifecycle: (() => void) | null;
    titleChange: (() => void) | null;
    polling: ReturnType<typeof setInterval> | null;
  }

  const subscriptions: SubscriptionManager = {
    lifecycle: null,
    titleChange: null,
    polling: null,
  };

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

  // Incremental refresh - polls all PTYs and updates changed fields
  // Uses native APIs (FFI/proc) so the burst is very fast (~1ms per PTY)
  let incrementalRefreshInProgress = false;
  const incrementalRefreshPtys = async () => {
    if (incrementalRefreshInProgress || state.allPtys.length === 0) return;
    incrementalRefreshInProgress = true;

    try {
      // Fetch all PTYs at once (native APIs make this fast)
      const newPtys = await listAllPtysWithMetadata({ skipGitDiffStats: true });
      const newPtysMap = new Map(newPtys.map(p => [p.ptyId, p]));

      // Check if PTY list changed (added/removed)
      const oldPtyIds = new Set(state.allPtys.map(p => p.ptyId));
      const newPtyIds = new Set(newPtys.map(p => p.ptyId));
      const listChanged = oldPtyIds.size !== newPtyIds.size ||
        [...oldPtyIds].some(id => !newPtyIds.has(id));

      if (listChanged) {
        // PTYs added or removed - do full refresh
        await refreshPtys();
        return;
      }

      // Update only changed fields in existing PTYs
      setState(produce((s) => {
        for (let i = 0; i < s.allPtys.length; i++) {
          const oldPty = s.allPtys[i];
          const newPty = newPtysMap.get(oldPty.ptyId);
          if (!newPty) continue;

          if (oldPty.foregroundProcess !== newPty.foregroundProcess) {
            s.allPtys[i].foregroundProcess = newPty.foregroundProcess;
          }
          if (oldPty.gitBranch !== newPty.gitBranch) {
            s.allPtys[i].gitBranch = newPty.gitBranch;
          }
          if (oldPty.cwd !== newPty.cwd) {
            s.allPtys[i].cwd = newPty.cwd;
          }
          // Preserve gitDiffStats from initial load (we skip it during polling)
        }
        // Also update matchedPtys if filter is active
        for (let i = 0; i < s.matchedPtys.length; i++) {
          const oldPty = s.matchedPtys[i];
          const newPty = newPtysMap.get(oldPty.ptyId);
          if (!newPty) continue;

          if (oldPty.foregroundProcess !== newPty.foregroundProcess) {
            s.matchedPtys[i].foregroundProcess = newPty.foregroundProcess;
          }
          if (oldPty.gitBranch !== newPty.gitBranch) {
            s.matchedPtys[i].gitBranch = newPty.gitBranch;
          }
          if (oldPty.cwd !== newPty.cwd) {
            s.matchedPtys[i].cwd = newPty.cwd;
          }
        }
      }));
    } finally {
      incrementalRefreshInProgress = false;
    }
  };

  const setupSubscriptions = async () => {
    // Subscribe to PTY lifecycle events for auto-refresh (created/destroyed)
    // Use debounced refresh to prevent animation stutter from rapid events
    subscriptions.lifecycle = await subscribeToPtyLifecycle(() => {
      debouncedRefreshPtys();
    });

    // Subscribe to title changes - use incremental update instead of full refresh
    subscriptions.titleChange = await subscribeToAllTitleChanges(handleTitleChange);

    // Poll all PTYs every 5 seconds using native APIs (very fast, ~1ms per PTY)
    // Title change events handle most updates - this is just a fallback
    subscriptions.polling = setInterval(() => {
      incrementalRefreshPtys();
    }, 5000);
  };

  const cleanupSubscriptions = () => {
    subscriptions.lifecycle?.();
    subscriptions.titleChange?.();
    if (subscriptions.polling) clearInterval(subscriptions.polling);
    subscriptions.lifecycle = null;
    subscriptions.titleChange = null;
    subscriptions.polling = null;
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
      s.matchedPtys = s.allPtys;
      s.matchedPtysIndex = s.allPtysIndex; // Share index since matchedPtys === allPtys
      s.selectedPtyId = s.allPtys[0]?.ptyId ?? null;
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
    const matchedPtys = filterPtys(state.allPtys, query);
    const matchedPtysIndex = buildPtyIndex(matchedPtys);
    setState(produce((s) => {
      s.filterQuery = query;
      s.matchedPtys = matchedPtys;
      s.matchedPtysIndex = matchedPtysIndex;
      s.selectedIndex = 0;
      s.selectedPtyId = matchedPtys[0]?.ptyId ?? null;
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
