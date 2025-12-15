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
import type { Workspace, WorkspaceId, PaneData } from '../core/types';
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

interface LayoutContextValue {
  state: LayoutState;
  dispatch: Dispatch<LayoutAction>;
  activeWorkspace: Workspace;
  paneCount: number;
  panes: PaneData[];
  populatedWorkspaces: WorkspaceId[];
  /** Version counter that increments on save-worthy layout changes */
  layoutVersion: number;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

interface LayoutProviderProps {
  config?: Partial<LayoutConfig>;
  children: ReactNode;
}

export function LayoutProvider({ config, children }: LayoutProviderProps) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const initialState: LayoutState = {
    workspaces: new Map(),
    activeWorkspaceId: 1,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
    layoutVersion: 0,
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
      layoutVersion: state.layoutVersion,
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
