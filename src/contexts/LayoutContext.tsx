/**
 * Layout context for workspace and master-stack layout management
 */

import {
  createContext,
  useContext,
  createMemo,
  batch,
  type ParentProps,
} from 'solid-js';
import { createStore, unwrap, reconcile, produce } from 'solid-js/store';
import type { Workspace, WorkspaceId, PaneData, Direction, LayoutMode } from '../core/types';
import { LayoutConfig, DEFAULT_CONFIG } from '../core/config';
import {
  getAllWorkspacePanes,
  getWorkspacePaneCount,
  calculateMasterStackLayout,
} from '../core/operations/master-stack-layout';
import {
  layoutReducer,
  getActiveWorkspace,
  generatePaneId,
  createWorkspace,
  type LayoutState,
  type LayoutAction,
  type Workspaces,
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
  /** Create pane with PTY already attached - single render, no stutter */
  newPaneWithPty: (ptyId: string, title?: string) => string;
  closePane: () => void;
  closePaneById: (paneId: string) => void;
  setViewport: (viewport: { x: number; y: number; width: number; height: number }) => void;
  switchWorkspace: (workspaceId: WorkspaceId) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setPanePty: (paneId: string, ptyId: string) => void;
  setPaneTitle: (paneId: string, title: string) => void;
  swapMain: () => void;
  toggleZoom: () => void;
  loadSession: (params: { workspaces: Workspaces; activeWorkspaceId: WorkspaceId }) => void;
  clearAll: () => void;
  /** Get estimated dimensions for a new pane (for PTY creation before pane exists) */
  getNewPaneDimensions: () => { cols: number; rows: number };
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
    workspaces: {},
    activeWorkspaceId: 1,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
    layoutVersion: 0,
  };

  // We use createStore but apply the existing reducer for state transitions
  // This preserves the well-tested reducer logic
  const [state, setState] = createStore<LayoutState>(initialState);

  // Debug timing flag - set to true to see layout timing
  const DEBUG_LAYOUT_TIMING = false;

  // Apply state update using batch to group all updates into a single render cycle
  const applyState = (newState: LayoutState) => {
    const start = DEBUG_LAYOUT_TIMING ? performance.now() : 0;

    // Batch all updates into a single render cycle
    batch(() => {
      // Use reconcile with merge:true for workspaces to preserve object references
      // where possible - this minimizes re-renders when only some properties change
      setState('workspaces', reconcile(newState.workspaces, { merge: true }));
      setState('activeWorkspaceId', newState.activeWorkspaceId);
      setState('viewport', newState.viewport);
      setState('config', newState.config);
      setState('layoutVersion', newState.layoutVersion);
    });

    if (DEBUG_LAYOUT_TIMING) {
      const elapsed = performance.now() - start;
      if (elapsed > 1) {
        console.log(`[LAYOUT] setState took ${elapsed.toFixed(2)}ms`);
      }
    }
  };

  // Queue for batching rapid actions (like spam creating panes)
  let pendingActions: LayoutAction[] = [];
  let flushScheduled = false;
  // Timing for performance measurement
  let actionStartTimes: Map<string, number> = new Map();

  // Debug timing flag - set to true to see action timing
  const DEBUG_ACTION_TIMING = false;

  // Flush pending actions in a batch
  const flushActions = () => {
    if (pendingActions.length === 0) return;

    const actions = pendingActions;
    pendingActions = [];
    flushScheduled = false;

    const flushStart = DEBUG_ACTION_TIMING ? performance.now() : 0;

    // Apply all actions to get final state
    let currentState = unwrap(state);
    for (const action of actions) {
      currentState = layoutReducer(currentState, action);
    }

    const reducerDone = DEBUG_ACTION_TIMING ? performance.now() : 0;

    // Apply state update
    applyState(currentState);

    if (DEBUG_ACTION_TIMING) {
      const flushEnd = performance.now();
      const actionTypes = actions.map(a => a.type).join(', ');
      console.log(`[LAYOUT] flush(${actionTypes}): reducer=${(reducerDone - flushStart).toFixed(2)}ms, applyState=${(flushEnd - reducerDone).toFixed(2)}ms, total=${(flushEnd - flushStart).toFixed(2)}ms`);

      // Log end-to-end time for each action
      for (const action of actions) {
        const startTime = actionStartTimes.get(action.type);
        if (startTime) {
          console.log(`[LAYOUT] ${action.type} end-to-end: ${(flushEnd - startTime).toFixed(2)}ms`);
          actionStartTimes.delete(action.type);
        }
      }
    }
  };

  // Fast path for SET_PANE_PTY - direct store path update instead of reconcile
  // This avoids diffing the entire workspaces object for a single property change
  const applySetPanePty = (paneId: string, ptyId: string) => {
    const start = DEBUG_ACTION_TIMING ? performance.now() : 0;

    const wsId = state.activeWorkspaceId;
    const workspace = state.workspaces[wsId];

    if (workspace?.mainPane?.id === paneId) {
      // Direct path update for main pane
      setState('workspaces', wsId, 'mainPane', 'ptyId', ptyId);
    } else if (workspace) {
      // Find stack pane index and update directly
      const stackIndex = workspace.stackPanes.findIndex(p => p.id === paneId);
      if (stackIndex !== -1) {
        setState('workspaces', wsId, 'stackPanes', stackIndex, 'ptyId', ptyId);
      }
    }

    if (DEBUG_ACTION_TIMING) {
      console.log(`[LAYOUT] SET_PANE_PTY direct update: ${(performance.now() - start).toFixed(2)}ms`);
    }
  };

  // Fast path for NEW_PANE - use produce for direct mutations instead of reconcile
  // This avoids the overhead of diffing the entire workspaces object
  const applyNewPane = (title?: string, ptyId?: string) => {
    const start = DEBUG_ACTION_TIMING ? performance.now() : 0;
    const wsId = state.activeWorkspaceId;
    const newPaneId = generatePaneId();

    // Use produce for efficient in-place updates
    setState(produce((draft) => {
      // Ensure workspace exists
      if (!draft.workspaces[wsId]) {
        draft.workspaces[wsId] = createWorkspace(wsId, draft.config.defaultLayoutMode);
      }
      const workspace = draft.workspaces[wsId]!;

      const newPane = {
        id: newPaneId,
        ptyId,
        title: title ?? 'shell',
      };

      if (!workspace.mainPane) {
        // First pane becomes main
        workspace.mainPane = newPane;
        workspace.focusedPaneId = newPaneId;
      } else {
        // New pane goes to stack
        workspace.stackPanes.push(newPane);
        workspace.focusedPaneId = newPaneId;
        workspace.activeStackIndex = workspace.stackPanes.length - 1;
      }

      // Recalculate layout and apply rectangles in-place
      const calculated = calculateMasterStackLayout(workspace, draft.viewport, draft.config);
      if (workspace.mainPane && calculated.mainPane) {
        workspace.mainPane.rectangle = calculated.mainPane.rectangle;
      }
      for (let i = 0; i < workspace.stackPanes.length; i++) {
        if (calculated.stackPanes[i]) {
          workspace.stackPanes[i]!.rectangle = calculated.stackPanes[i]!.rectangle;
        }
      }

      draft.layoutVersion++;
    }));

    if (DEBUG_ACTION_TIMING) {
      const label = ptyId ? 'NEW_PANE_WITH_PTY' : 'NEW_PANE';
      console.log(`[LAYOUT] ${label} produce: ${(performance.now() - start).toFixed(2)}ms`);
    }

    return newPaneId;
  };

  // Helper to dispatch actions through the reducer
  // Uses reconcile for efficient diffing
  const dispatch = (action: LayoutAction) => {
    // SET_PANE_PTY uses fast direct path update - defer to avoid blocking animations
    if (action.type === 'SET_PANE_PTY') {
      setTimeout(() => applySetPanePty(action.paneId, action.ptyId), 0);
      return;
    }

    // NEW_PANE uses fast produce path - defer to avoid blocking animations in other panes
    if (action.type === 'NEW_PANE') {
      setTimeout(() => applyNewPane(action.title), 0);
      return;
    }

    // Actions that affect layout (can cause expensive re-renders) are batched
    // to reduce stutter when rapidly creating/closing panes
    const batchableActions = ['CLOSE_PANE', 'CLOSE_PANE_BY_ID'];

    if (batchableActions.includes(action.type)) {
      if (DEBUG_ACTION_TIMING) {
        actionStartTimes.set(action.type, performance.now());
      }
      pendingActions.push(action);
      if (!flushScheduled) {
        flushScheduled = true;
        // Use setImmediate/setTimeout(0) to defer to next event loop iteration
        // This allows any pending rendering to complete before layout changes
        // setImmediate is faster than setTimeout(0) when available (Node/Bun)
        if (typeof setImmediate !== 'undefined') {
          setImmediate(flushActions);
        } else {
          setTimeout(flushActions, 0);
        }
      }
      return;
    }

    // Non-batchable actions apply directly
    const currentState = unwrap(state);
    const newState = layoutReducer(currentState, action);
    applyState(newState);
  };

  // Computed values using createMemo
  const activeWorkspace = createMemo(() => getActiveWorkspace(state));

  const populatedWorkspaces = createMemo(() => {
    const result: WorkspaceId[] = [];
    for (const [idStr, workspace] of Object.entries(state.workspaces)) {
      if (workspace?.mainPane) {
        result.push(Number(idStr) as WorkspaceId);
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
  const setPaneTitle = (paneId: string, title: string) =>
    dispatch({ type: 'SET_PANE_TITLE', paneId, title });
  const swapMain = () => dispatch({ type: 'SWAP_MAIN' });
  const toggleZoom = () => dispatch({ type: 'TOGGLE_ZOOM' });
  const loadSession = (params: { workspaces: Workspaces; activeWorkspaceId: WorkspaceId }) =>
    dispatch({ type: 'LOAD_SESSION', workspaces: params.workspaces, activeWorkspaceId: params.activeWorkspaceId });
  const clearAll = () => dispatch({ type: 'CLEAR_ALL' });

  // Create pane with PTY already attached - SINGLE render, no stutter
  // This is the preferred way to create new panes
  const newPaneWithPty = (ptyId: string, title?: string): string => {
    return applyNewPane(title, ptyId);
  };

  // Get estimated dimensions for a new pane (for PTY creation before pane exists)
  // Calculates what the new pane's size would be based on current layout
  const getNewPaneDimensions = (): { cols: number; rows: number } => {
    const workspace = getActiveWorkspace(state);
    const viewport = state.viewport;
    const config = state.config;

    // Calculate what layout would look like with one more pane
    const tempWorkspace = { ...workspace };
    if (!tempWorkspace.mainPane) {
      // Would be the main pane - use split ratio
      const width = Math.floor(viewport.width * config.defaultSplitRatio);
      const height = viewport.height;
      return {
        cols: Math.max(1, width - 2),
        rows: Math.max(1, height - 2),
      };
    } else {
      // Would be in stack - calculate stack pane size
      const stackWidth = Math.floor(viewport.width * (1 - config.defaultSplitRatio));
      const stackCount = tempWorkspace.stackPanes.length + 1;
      const height = Math.floor(viewport.height / stackCount);
      return {
        cols: Math.max(1, stackWidth - 2),
        rows: Math.max(1, height - 2),
      };
    }
  };

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
    newPaneWithPty,
    closePane,
    closePaneById,
    setViewport,
    switchWorkspace,
    setLayoutMode,
    setPanePty,
    setPaneTitle,
    swapMain,
    toggleZoom,
    loadSession,
    clearAll,
    getNewPaneDimensions,
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
