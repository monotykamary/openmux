/**
 * Workspace operations action handlers
 * SET_VIEWPORT, SWITCH_WORKSPACE, LOAD_SESSION, CLEAR_ALL
 */

import type { Rectangle, Workspace, WorkspaceId } from '../../types';
import type { LayoutState } from './types';
import { createWorkspace, updateWorkspace, recalculateLayout, syncPaneIdCounter } from './helpers';

/**
 * Handle SET_VIEWPORT action
 * Updates viewport and recalculates all layouts
 */
export function handleSetViewport(state: LayoutState, viewport: Rectangle): LayoutState {
  const newWorkspaces = new Map<WorkspaceId, Workspace>();
  for (const [id, workspace] of state.workspaces) {
    if (workspace.mainPane) {
      newWorkspaces.set(id, recalculateLayout(workspace, viewport, state.config));
    } else {
      newWorkspaces.set(id, workspace);
    }
  }
  return { ...state, workspaces: newWorkspaces, viewport };
}

/**
 * Handle SWITCH_WORKSPACE action
 * Switches to existing workspace or creates new one
 */
export function handleSwitchWorkspace(state: LayoutState, workspaceId: WorkspaceId): LayoutState {
  if (!state.workspaces.has(workspaceId)) {
    const newWorkspace = createWorkspace(workspaceId, state.config.defaultLayoutMode);
    return {
      ...state,
      workspaces: updateWorkspace(state, newWorkspace),
      activeWorkspaceId: workspaceId,
      layoutVersion: state.layoutVersion + 1,
    };
  }
  return { ...state, activeWorkspaceId: workspaceId, layoutVersion: state.layoutVersion + 1 };
}

/**
 * Handle LOAD_SESSION action
 * Loads workspaces from a saved session
 */
export function handleLoadSession(
  state: LayoutState,
  workspaces: Map<WorkspaceId, Workspace>,
  activeWorkspaceId: WorkspaceId
): LayoutState {
  const newWorkspaces = new Map<WorkspaceId, Workspace>();
  for (const [id, workspace] of workspaces) {
    if (workspace.mainPane) {
      newWorkspaces.set(id, recalculateLayout(workspace, state.viewport, state.config));
    } else {
      newWorkspaces.set(id, workspace);
    }
  }
  // Sync pane ID counter to avoid conflicts with existing pane IDs
  syncPaneIdCounter(newWorkspaces);
  return {
    ...state,
    workspaces: newWorkspaces,
    activeWorkspaceId,
  };
}

/**
 * Handle CLEAR_ALL action
 * Clears all workspaces for session switch
 */
export function handleClearAll(state: LayoutState): LayoutState {
  return {
    ...state,
    workspaces: new Map(),
    activeWorkspaceId: 1,
  };
}
