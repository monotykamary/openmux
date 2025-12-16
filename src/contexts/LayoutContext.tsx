/**
 * Layout context for workspace and master-stack layout management
 */

import {
  createContext,
  useContext,
  createMemo,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { Workspace, WorkspaceId, PaneData, Direction, LayoutMode } from '../core/types';
import { LayoutConfig, DEFAULT_CONFIG } from '../core/config';
import {
  getAllWorkspacePanes,
  getWorkspacePaneCount,
} from '../core/operations/master-stack-layout';
import {
  layoutReducer,
  getActiveWorkspace,
  type LayoutState,
  type LayoutAction,
} from '../core/operations/layout-actions';

// =============================================================================
// Context Value Interface
// =============================================================================

interface LayoutContextValue {
  state: LayoutState;
  activeWorkspace: Workspace;
  paneCount: number;
  panes: PaneData[];
  populatedWorkspaces: WorkspaceId[];
  /** Version counter that increments on save-worthy layout changes */
  layoutVersion: number;
  // Actions
  focusPane: (paneId: string) => void;
  navigate: (direction: Direction) => void;
  newPane: (title?: string) => void;
  closePane: () => void;
  closePaneById: (paneId: string) => void;
  setViewport: (viewport: { x: number; y: number; width: number; height: number }) => void;
  switchWorkspace: (workspaceId: WorkspaceId) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setPanePty: (paneId: string, ptyId: string) => void;
  swapMain: () => void;
  toggleZoom: () => void;
  loadSession: (params: { workspaces: Map<WorkspaceId, Workspace>; activeWorkspaceId: WorkspaceId }) => void;
  clearAll: () => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface LayoutProviderProps extends ParentProps {
  config?: Partial<LayoutConfig>;
}

export function LayoutProvider(props: LayoutProviderProps) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...props.config };

  const initialState: LayoutState = {
    workspaces: new Map(),
    activeWorkspaceId: 1,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
    layoutVersion: 0,
  };

  // We use createStore but apply the existing reducer for state transitions
  // This preserves the well-tested reducer logic
  const [state, setState] = createStore<LayoutState>(initialState);

  // Helper to dispatch actions through the reducer
  const dispatch = (action: LayoutAction) => {
    setState(produce((s) => {
      const newState = layoutReducer(s as LayoutState, action);
      // Copy all properties from newState to s
      Object.assign(s, newState);
    }));
  };

  // Computed values using createMemo
  const activeWorkspace = createMemo(() => getActiveWorkspace(state));

  const populatedWorkspaces = createMemo(() => {
    const result: WorkspaceId[] = [];
    for (const [id, workspace] of state.workspaces) {
      if (workspace.mainPane) {
        result.push(id);
      }
    }
    if (!result.includes(state.activeWorkspaceId)) {
      result.push(state.activeWorkspaceId);
    }
    result.sort((a, b) => a - b);
    return result;
  });

  const paneCount = createMemo(() => getWorkspacePaneCount(activeWorkspace()));
  const panes = createMemo(() => getAllWorkspacePanes(activeWorkspace()));

  // Action functions
  const focusPane = (paneId: string) => dispatch({ type: 'FOCUS_PANE', paneId });
  const navigate = (direction: Direction) => dispatch({ type: 'NAVIGATE', direction });
  const newPane = (title?: string) => dispatch({ type: 'NEW_PANE', title });
  const closePane = () => dispatch({ type: 'CLOSE_PANE' });
  const closePaneById = (paneId: string) => dispatch({ type: 'CLOSE_PANE_BY_ID', paneId });
  const setViewport = (viewport: { x: number; y: number; width: number; height: number }) =>
    dispatch({ type: 'SET_VIEWPORT', viewport });
  const switchWorkspace = (workspaceId: WorkspaceId) =>
    dispatch({ type: 'SWITCH_WORKSPACE', workspaceId });
  const setLayoutMode = (mode: LayoutMode) => dispatch({ type: 'SET_LAYOUT_MODE', mode });
  const setPanePty = (paneId: string, ptyId: string) =>
    dispatch({ type: 'SET_PANE_PTY', paneId, ptyId });
  const swapMain = () => dispatch({ type: 'SWAP_MAIN' });
  const toggleZoom = () => dispatch({ type: 'TOGGLE_ZOOM' });
  const loadSession = (params: { workspaces: Map<WorkspaceId, Workspace>; activeWorkspaceId: WorkspaceId }) =>
    dispatch({ type: 'LOAD_SESSION', workspaces: params.workspaces, activeWorkspaceId: params.activeWorkspaceId });
  const clearAll = () => dispatch({ type: 'CLEAR_ALL' });

  // Build context value - note: computed values need to be accessed as functions in Solid
  const value: LayoutContextValue = {
    get state() { return state; },
    get activeWorkspace() { return activeWorkspace(); },
    get paneCount() { return paneCount(); },
    get panes() { return panes(); },
    get populatedWorkspaces() { return populatedWorkspaces(); },
    get layoutVersion() { return state.layoutVersion; },
    focusPane,
    navigate,
    newPane,
    closePane,
    closePaneById,
    setViewport,
    switchWorkspace,
    setLayoutMode,
    setPanePty,
    swapMain,
    toggleZoom,
    loadSession,
    clearAll,
  };

  return (
    <LayoutContext.Provider value={value}>
      {props.children}
    </LayoutContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}
