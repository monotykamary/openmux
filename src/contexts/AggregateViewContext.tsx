/**
 * AggregateViewContext - manages state for the aggregate view overlay.
 * Allows filtering and viewing PTYs across all workspaces.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
  type Dispatch,
} from 'react';
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
// Actions
// =============================================================================

type AggregateViewAction =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'SET_FILTER_QUERY'; query: string }
  | { type: 'SET_ALL_PTYS'; ptys: PtyInfo[] }
  | { type: 'NAVIGATE_UP' }
  | { type: 'NAVIGATE_DOWN' }
  | { type: 'SELECT_PTY'; ptyId: string }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'ENTER_PREVIEW_MODE' }
  | { type: 'EXIT_PREVIEW_MODE' };

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
// Reducer
// =============================================================================

function aggregateViewReducer(
  state: AggregateViewState,
  action: AggregateViewAction
): AggregateViewState {
  switch (action.type) {
    case 'OPEN':
      return {
        ...state,
        showAggregateView: true,
        filterQuery: '',
        selectedIndex: 0,
        matchedPtys: state.allPtys,
        selectedPtyId: state.allPtys[0]?.ptyId ?? null,
      };

    case 'CLOSE':
      return {
        ...state,
        showAggregateView: false,
        filterQuery: '',
        selectedIndex: 0,
        previewMode: false,
      };

    case 'SET_FILTER_QUERY': {
      const matchedPtys = filterPtys(state.allPtys, action.query);
      return {
        ...state,
        filterQuery: action.query,
        matchedPtys,
        selectedIndex: 0,
        selectedPtyId: matchedPtys[0]?.ptyId ?? null,
      };
    }

    case 'SET_ALL_PTYS': {
      const matchedPtys = filterPtys(action.ptys, state.filterQuery);
      const selectedPtyId = matchedPtys[state.selectedIndex]?.ptyId ?? matchedPtys[0]?.ptyId ?? null;
      return {
        ...state,
        allPtys: action.ptys,
        matchedPtys,
        selectedPtyId,
        isLoading: false,
      };
    }

    case 'NAVIGATE_UP': {
      const newIndex = Math.max(0, state.selectedIndex - 1);
      return {
        ...state,
        selectedIndex: newIndex,
        selectedPtyId: state.matchedPtys[newIndex]?.ptyId ?? null,
      };
    }

    case 'NAVIGATE_DOWN': {
      const newIndex = Math.min(state.matchedPtys.length - 1, state.selectedIndex + 1);
      return {
        ...state,
        selectedIndex: newIndex,
        selectedPtyId: state.matchedPtys[newIndex]?.ptyId ?? null,
      };
    }

    case 'SELECT_PTY':
      return {
        ...state,
        selectedPtyId: action.ptyId,
        selectedIndex: state.matchedPtys.findIndex((p) => p.ptyId === action.ptyId),
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.isLoading,
      };

    case 'ENTER_PREVIEW_MODE':
      return {
        ...state,
        previewMode: true,
      };

    case 'EXIT_PREVIEW_MODE':
      return {
        ...state,
        previewMode: false,
      };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface AggregateViewContextValue {
  state: AggregateViewState;
  dispatch: Dispatch<AggregateViewAction>;
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

interface AggregateViewProviderProps {
  children: ReactNode;
}

export function AggregateViewProvider({ children }: AggregateViewProviderProps) {
  const [state, dispatch] = useReducer(aggregateViewReducer, initialState);

  // Fetch all PTYs from all sessions
  const refreshPtys = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', isLoading: true });
    const ptys = await listAllPtysWithMetadata();
    dispatch({ type: 'SET_ALL_PTYS', ptys });
  }, []);

  // Refresh PTYs when view opens
  useEffect(() => {
    if (state.showAggregateView) {
      refreshPtys();
    }
  }, [state.showAggregateView, refreshPtys]);

  // Actions
  const openAggregateView = useCallback(() => {
    dispatch({ type: 'OPEN' });
  }, []);

  const closeAggregateView = useCallback(() => {
    dispatch({ type: 'CLOSE' });
  }, []);

  const setFilterQuery = useCallback((query: string) => {
    dispatch({ type: 'SET_FILTER_QUERY', query });
  }, []);

  const navigateUp = useCallback(() => {
    dispatch({ type: 'NAVIGATE_UP' });
  }, []);

  const navigateDown = useCallback(() => {
    dispatch({ type: 'NAVIGATE_DOWN' });
  }, []);

  const selectPty = useCallback((ptyId: string) => {
    dispatch({ type: 'SELECT_PTY', ptyId });
  }, []);

  const getSelectedPty = useCallback((): PtyInfo | null => {
    if (state.selectedPtyId === null) return null;
    return state.matchedPtys.find((p) => p.ptyId === state.selectedPtyId) ?? null;
  }, [state.selectedPtyId, state.matchedPtys]);

  const enterPreviewMode = useCallback(() => {
    dispatch({ type: 'ENTER_PREVIEW_MODE' });
  }, []);

  const exitPreviewMode = useCallback(() => {
    dispatch({ type: 'EXIT_PREVIEW_MODE' });
  }, []);

  const value: AggregateViewContextValue = {
    state,
    dispatch,
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
      {children}
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
