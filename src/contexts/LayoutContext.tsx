/**
 * Layout context for workspace and master-stack layout management
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { NodeId, Direction, Rectangle, Workspace, WorkspaceId, LayoutMode, PaneData } from '../core/types';
import { BSPConfig, DEFAULT_CONFIG } from '../core/config';
import {
  calculateMasterStackLayout,
  getAllWorkspacePanes,
  getWorkspacePaneCount,
} from '../core/operations/master-stack-layout';

let paneIdCounter = 0;
function generatePaneId(): string {
  return `pane-${++paneIdCounter}`;
}

/**
 * Create a new empty workspace
 */
function createWorkspace(id: WorkspaceId, layoutMode: LayoutMode): Workspace {
  return {
    id,
    mainPane: null,
    stackPanes: [],
    focusedPaneId: null,
    activeStackIndex: 0,
    layoutMode,
  };
}

interface LayoutState {
  workspaces: Map<WorkspaceId, Workspace>;
  activeWorkspaceId: WorkspaceId;
  viewport: Rectangle;
  config: BSPConfig;
}

type LayoutAction =
  | { type: 'FOCUS_PANE'; paneId: NodeId }
  | { type: 'NAVIGATE'; direction: Direction }
  | { type: 'NEW_PANE'; ptyId?: string; title?: string }
  | { type: 'CLOSE_PANE' }
  | { type: 'CLOSE_PANE_BY_ID'; paneId: NodeId }
  | { type: 'RESIZE'; direction: Direction; delta: number }
  | { type: 'SET_VIEWPORT'; viewport: Rectangle }
  | { type: 'SWITCH_WORKSPACE'; workspaceId: WorkspaceId }
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'SET_PANE_PTY'; paneId: NodeId; ptyId: string }
  | { type: 'SWAP_MAIN' }; // Swap focused pane with main

function getActiveWorkspace(state: LayoutState): Workspace {
  let workspace = state.workspaces.get(state.activeWorkspaceId);
  if (!workspace) {
    workspace = createWorkspace(state.activeWorkspaceId, state.config.defaultLayoutMode);
  }
  return workspace;
}

function updateWorkspace(state: LayoutState, workspace: Workspace): Map<WorkspaceId, Workspace> {
  const newWorkspaces = new Map(state.workspaces);
  newWorkspaces.set(workspace.id, workspace);
  return newWorkspaces;
}

function recalculateLayout(workspace: Workspace, viewport: Rectangle, config: BSPConfig): Workspace {
  return calculateMasterStackLayout(workspace, viewport, config);
}

function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'FOCUS_PANE': {
      const workspace = getActiveWorkspace(state);

      // Update activeStackIndex if focusing a stack pane
      let activeStackIndex = workspace.activeStackIndex;
      const stackIndex = workspace.stackPanes.findIndex(p => p.id === action.paneId);
      if (stackIndex >= 0) {
        activeStackIndex = stackIndex;
      }

      const updated: Workspace = {
        ...workspace,
        focusedPaneId: action.paneId,
        activeStackIndex,
      };
      return { ...state, workspaces: updateWorkspace(state, updated) };
    }

    case 'NAVIGATE': {
      const workspace = getActiveWorkspace(state);
      const allPanes = getAllWorkspacePanes(workspace);
      if (allPanes.length === 0) return state;

      const currentIndex = allPanes.findIndex(p => p.id === workspace.focusedPaneId);
      if (currentIndex === -1) return state;

      let newIndex = currentIndex;
      const { direction } = action;

      // Navigation logic based on layout mode
      if (workspace.layoutMode === 'vertical' || workspace.layoutMode === 'stacked') {
        // Main on left, stack on right
        if (direction === 'west' || direction === 'east') {
          // Move between main and stack
          if (currentIndex === 0 && direction === 'east' && workspace.stackPanes.length > 0) {
            newIndex = 1 + workspace.activeStackIndex;
          } else if (currentIndex > 0 && direction === 'west') {
            newIndex = 0;
          }
        } else if (direction === 'north' || direction === 'south') {
          // Move within stack (vertical) or switch tabs (stacked)
          if (currentIndex > 0) {
            const stackIdx = currentIndex - 1;
            if (direction === 'north' && stackIdx > 0) {
              newIndex = currentIndex - 1;
            } else if (direction === 'south' && stackIdx < workspace.stackPanes.length - 1) {
              newIndex = currentIndex + 1;
            }
          }
        }
      } else {
        // Horizontal: main on top, stack on bottom
        if (direction === 'north' || direction === 'south') {
          // Move between main and stack
          if (currentIndex === 0 && direction === 'south' && workspace.stackPanes.length > 0) {
            newIndex = 1 + workspace.activeStackIndex;
          } else if (currentIndex > 0 && direction === 'north') {
            newIndex = 0;
          }
        } else if (direction === 'west' || direction === 'east') {
          // Move within stack (horizontal)
          if (currentIndex > 0) {
            const stackIdx = currentIndex - 1;
            if (direction === 'west' && stackIdx > 0) {
              newIndex = currentIndex - 1;
            } else if (direction === 'east' && stackIdx < workspace.stackPanes.length - 1) {
              newIndex = currentIndex + 1;
            }
          }
        }
      }

      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < allPanes.length) {
        const newPane = allPanes[newIndex];
        if (newPane) {
          const activeStackIndex = newIndex > 0 ? newIndex - 1 : workspace.activeStackIndex;
          const updated: Workspace = {
            ...workspace,
            focusedPaneId: newPane.id,
            activeStackIndex,
          };
          return { ...state, workspaces: updateWorkspace(state, updated) };
        }
      }
      return state;
    }

    case 'NEW_PANE': {
      const workspace = getActiveWorkspace(state);
      const newPaneId = generatePaneId();
      const newPane: PaneData = {
        id: newPaneId,
        ptyId: action.ptyId,
        title: action.title ?? 'shell',
      };

      let updated: Workspace;

      if (!workspace.mainPane) {
        // First pane becomes main
        updated = {
          ...workspace,
          mainPane: newPane,
          focusedPaneId: newPaneId,
        };
      } else {
        // New pane goes to stack
        updated = {
          ...workspace,
          stackPanes: [...workspace.stackPanes, newPane],
          focusedPaneId: newPaneId,
          activeStackIndex: workspace.stackPanes.length, // Focus new pane
        };
      }

      updated = recalculateLayout(updated, state.viewport, state.config);
      return { ...state, workspaces: updateWorkspace(state, updated) };
    }

    case 'CLOSE_PANE': {
      const workspace = getActiveWorkspace(state);
      if (!workspace.focusedPaneId) return state;

      let updated: Workspace;

      if (workspace.mainPane?.id === workspace.focusedPaneId) {
        // Closing main pane
        if (workspace.stackPanes.length > 0) {
          // Promote first stack pane to main
          const [newMain, ...remainingStack] = workspace.stackPanes;
          updated = {
            ...workspace,
            mainPane: newMain!,
            stackPanes: remainingStack,
            focusedPaneId: newMain!.id,
            activeStackIndex: Math.min(workspace.activeStackIndex, Math.max(0, remainingStack.length - 1)),
          };
        } else {
          // No more panes
          updated = {
            ...workspace,
            mainPane: null,
            focusedPaneId: null,
          };
        }
      } else {
        // Closing a stack pane
        const closeIndex = workspace.stackPanes.findIndex(p => p.id === workspace.focusedPaneId);
        if (closeIndex >= 0) {
          const newStack = workspace.stackPanes.filter((_, i) => i !== closeIndex);
          let newFocusId: string | null = workspace.mainPane?.id ?? null;
          let newActiveIndex = 0;

          if (newStack.length > 0) {
            // Focus adjacent stack pane or main
            newActiveIndex = Math.min(closeIndex, newStack.length - 1);
            newFocusId = newStack[newActiveIndex]?.id ?? workspace.mainPane?.id ?? null;
          }

          updated = {
            ...workspace,
            stackPanes: newStack,
            focusedPaneId: newFocusId,
            activeStackIndex: newActiveIndex,
          };
        } else {
          return state;
        }
      }

      if (updated.mainPane) {
        updated = recalculateLayout(updated, state.viewport, state.config);
        return { ...state, workspaces: updateWorkspace(state, updated) };
      }

      // Workspace is now empty - remove it
      const newWorkspaces = new Map(state.workspaces);
      newWorkspaces.delete(workspace.id);
      return { ...state, workspaces: newWorkspaces };
    }

    case 'CLOSE_PANE_BY_ID': {
      const workspace = getActiveWorkspace(state);
      const { paneId } = action;

      let updated: Workspace;

      if (workspace.mainPane?.id === paneId) {
        // Closing main pane
        if (workspace.stackPanes.length > 0) {
          // Promote first stack pane to main
          const [newMain, ...remainingStack] = workspace.stackPanes;
          updated = {
            ...workspace,
            mainPane: newMain!,
            stackPanes: remainingStack,
            focusedPaneId: newMain!.id,
            activeStackIndex: Math.min(workspace.activeStackIndex, Math.max(0, remainingStack.length - 1)),
          };
        } else {
          // No more panes
          updated = {
            ...workspace,
            mainPane: null,
            focusedPaneId: null,
          };
        }
      } else {
        // Closing a stack pane
        const closeIndex = workspace.stackPanes.findIndex(p => p.id === paneId);
        if (closeIndex >= 0) {
          const newStack = workspace.stackPanes.filter((_, i) => i !== closeIndex);
          let newFocusId: string | null = workspace.focusedPaneId;
          let newActiveIndex = workspace.activeStackIndex;

          // If closing the focused pane, update focus
          if (workspace.focusedPaneId === paneId) {
            if (newStack.length > 0) {
              newActiveIndex = Math.min(closeIndex, newStack.length - 1);
              newFocusId = newStack[newActiveIndex]?.id ?? workspace.mainPane?.id ?? null;
            } else {
              newFocusId = workspace.mainPane?.id ?? null;
              newActiveIndex = 0;
            }
          } else if (closeIndex <= workspace.activeStackIndex) {
            // Adjust activeStackIndex if closing pane before it
            newActiveIndex = Math.max(0, workspace.activeStackIndex - 1);
          }

          updated = {
            ...workspace,
            stackPanes: newStack,
            focusedPaneId: newFocusId,
            activeStackIndex: newActiveIndex,
          };
        } else {
          return state;
        }
      }

      if (updated.mainPane) {
        updated = recalculateLayout(updated, state.viewport, state.config);
        return { ...state, workspaces: updateWorkspace(state, updated) };
      }

      // Workspace is now empty - remove it
      const newWorkspaces = new Map(state.workspaces);
      newWorkspaces.delete(workspace.id);
      return { ...state, workspaces: newWorkspaces };
    }

    case 'RESIZE': {
      // Resize is a no-op in master-stack layout for now
      // Could be used to adjust the main/stack split ratio in the future
      return state;
    }

    case 'SET_VIEWPORT': {
      // Recalculate layout for all workspaces
      const newWorkspaces = new Map<WorkspaceId, Workspace>();
      for (const [id, workspace] of state.workspaces) {
        if (workspace.mainPane) {
          newWorkspaces.set(id, recalculateLayout(workspace, action.viewport, state.config));
        } else {
          newWorkspaces.set(id, workspace);
        }
      }
      return { ...state, workspaces: newWorkspaces, viewport: action.viewport };
    }

    case 'SWITCH_WORKSPACE': {
      if (!state.workspaces.has(action.workspaceId)) {
        const newWorkspace = createWorkspace(action.workspaceId, state.config.defaultLayoutMode);
        return {
          ...state,
          workspaces: updateWorkspace(state, newWorkspace),
          activeWorkspaceId: action.workspaceId,
        };
      }
      return { ...state, activeWorkspaceId: action.workspaceId };
    }

    case 'SET_LAYOUT_MODE': {
      const workspace = getActiveWorkspace(state);
      let updated: Workspace = { ...workspace, layoutMode: action.mode };
      if (updated.mainPane) {
        updated = recalculateLayout(updated, state.viewport, state.config);
      }
      return { ...state, workspaces: updateWorkspace(state, updated) };
    }

    case 'SET_PANE_PTY': {
      const workspace = getActiveWorkspace(state);
      const { paneId, ptyId } = action;

      let updated: Workspace = workspace;

      if (workspace.mainPane?.id === paneId) {
        updated = {
          ...workspace,
          mainPane: { ...workspace.mainPane, ptyId },
        };
      } else {
        updated = {
          ...workspace,
          stackPanes: workspace.stackPanes.map(p =>
            p.id === paneId ? { ...p, ptyId } : p
          ),
        };
      }

      return { ...state, workspaces: updateWorkspace(state, updated) };
    }

    case 'SWAP_MAIN': {
      const workspace = getActiveWorkspace(state);
      if (!workspace.mainPane || !workspace.focusedPaneId) return state;
      if (workspace.focusedPaneId === workspace.mainPane.id) return state;

      const focusedStackIndex = workspace.stackPanes.findIndex(
        p => p.id === workspace.focusedPaneId
      );
      if (focusedStackIndex === -1) return state;

      const focusedPane = workspace.stackPanes[focusedStackIndex]!;
      const newStack = [...workspace.stackPanes];
      newStack[focusedStackIndex] = workspace.mainPane;

      let updated: Workspace = {
        ...workspace,
        mainPane: focusedPane,
        stackPanes: newStack,
      };

      updated = recalculateLayout(updated, state.viewport, state.config);
      return { ...state, workspaces: updateWorkspace(state, updated) };
    }

    default:
      return state;
  }
}

interface LayoutContextValue {
  state: LayoutState;
  dispatch: Dispatch<LayoutAction>;
  activeWorkspace: Workspace;
  paneCount: number;
  panes: PaneData[];
  populatedWorkspaces: WorkspaceId[];
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

interface LayoutProviderProps {
  config?: Partial<BSPConfig>;
  children: ReactNode;
}

export function LayoutProvider({ config, children }: LayoutProviderProps) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const initialState: LayoutState = {
    workspaces: new Map(),
    activeWorkspaceId: 1,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
  };

  const [state, dispatch] = useReducer(layoutReducer, initialState);

  const value = useMemo<LayoutContextValue>(() => {
    const activeWorkspace = getActiveWorkspace(state);

    const populatedWorkspaces: WorkspaceId[] = [];
    for (const [id, workspace] of state.workspaces) {
      if (workspace.mainPane) {
        populatedWorkspaces.push(id);
      }
    }
    if (!populatedWorkspaces.includes(state.activeWorkspaceId)) {
      populatedWorkspaces.push(state.activeWorkspaceId);
    }
    populatedWorkspaces.sort((a, b) => a - b);

    return {
      state,
      dispatch,
      activeWorkspace,
      paneCount: getWorkspacePaneCount(activeWorkspace),
      panes: getAllWorkspacePanes(activeWorkspace),
      populatedWorkspaces,
    };
  }, [state]);

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}
