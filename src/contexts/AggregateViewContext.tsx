/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  createEffect,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { listAllPtysWithMetadata } from '../effect/bridge';

// =============================================================================
// State Types
// =============================================================================

/** PTY info for the aggregate view */
export interface PtyInfo {
  ptyId: string;
  cwd: string;
  gitBranch: string | undefined;
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
};

// =============================================================================
// Helper Functions
// =============================================================================

/** Filter PTYs by search query (matches cwd, git branch, or process) */
function filterPtys(ptys: PtyInfo[], query: string): PtyInfo[] {
  if (!query.trim()) return ptys;

  const lowerQuery = query.toLowerCase();
  return ptys.filter((pty) => {
    const cwd = pty.cwd.toLowerCase();
    const branch = pty.gitBranch?.toLowerCase() ?? '';
    const process = pty.foregroundProcess?.toLowerCase() ?? '';
    return cwd.includes(lowerQuery) || branch.includes(lowerQuery) || process.includes(lowerQuery);
  });
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

  // Fetch all PTYs from all sessions
  const refreshPtys = async () => {
    setState('isLoading', true);
    const ptys = await listAllPtysWithMetadata();
    const matchedPtys = filterPtys(ptys, state.filterQuery);
    const selectedPtyId = matchedPtys[state.selectedIndex]?.ptyId ?? matchedPtys[0]?.ptyId ?? null;
    setState(produce((s) => {
      s.allPtys = ptys;
      s.matchedPtys = matchedPtys;
      s.selectedPtyId = selectedPtyId;
      s.isLoading = false;
    }));
  };

  // Refresh PTYs when view opens
  createEffect(() => {
    if (state.showAggregateView) {
      refreshPtys();
    }
  });

  // Actions
  const openAggregateView = () => {
    setState(produce((s) => {
      s.showAggregateView = true;
      s.filterQuery = '';
      s.selectedIndex = 0;
      s.matchedPtys = s.allPtys;
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
    setState(produce((s) => {
      s.filterQuery = query;
      s.matchedPtys = matchedPtys;
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
      s.selectedIndex = s.matchedPtys.findIndex((p) => p.ptyId === ptyId);
    }));
  };

  const getSelectedPty = (): PtyInfo | null => {
    if (state.selectedPtyId === null) return null;
    return state.matchedPtys.find((p) => p.ptyId === state.selectedPtyId) ?? null;
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
