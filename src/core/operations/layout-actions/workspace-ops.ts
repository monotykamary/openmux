/**
 * Workspace operations action handlers
 * SET_VIEWPORT, SWITCH_WORKSPACE, LOAD_SESSION, CLEAR_ALL
 */

import type { Rectangle, WorkspaceId } from '../../types';
import type { LayoutState, Workspaces } from './types';
import { createWorkspace, updateWorkspace, recalculateLayout, syncPaneIdCounter, syncSplitIdCounter } from './helpers';

/**
 * Handle SET_VIEWPORT action
 * Updates viewport and recalculates all layouts
 */
export function handleSetViewport(state: LayoutState, viewport: Rectangle): LayoutState {
  const newWorkspaces: Workspaces = {};
  for (const [idStr, workspace] of Object.entries(state.workspaces)) {
    if (!workspace) continue;
    const id = Number(idStr) as WorkspaceId;
    if (workspace.mainPane) {
      newWorkspaces[id] = recalculateLayout(workspace, viewport, state.config);
    } else {
      newWorkspaces[id] = workspace;
    }
  }
  return {
    ...state,
    workspaces: newWorkspaces,
    viewport,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle SWITCH_WORKSPACE action
 * Switches to existing workspace or creates new one
 */
export function handleSwitchWorkspace(state: LayoutState, workspaceId: WorkspaceId): LayoutState {
  if (state.workspaces[workspaceId] === undefined) {
    const newWorkspace = createWorkspace(workspaceId, state.config.defaultLayoutMode);
    return {
      ...state,
      workspaces: updateWorkspace(state, newWorkspace),
      activeWorkspaceId: workspaceId,
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }
  return {
    ...state,
    activeWorkspaceId: workspaceId,
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle LOAD_SESSION action
 * Loads workspaces from a saved session
 */
export function handleLoadSession(
  state: LayoutState,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId
): LayoutState {
  const newWorkspaces: Workspaces = {};
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const id = Number(idStr) as WorkspaceId;
    if (workspace.mainPane) {
      newWorkspaces[id] = recalculateLayout(workspace, state.viewport, state.config);
    } else {
      newWorkspaces[id] = workspace;
    }
  }
  // Sync pane ID counter to avoid conflicts with existing pane IDs
  syncPaneIdCounter(newWorkspaces);
  syncSplitIdCounter(newWorkspaces);
  return {
    ...state,
    workspaces: newWorkspaces,
    activeWorkspaceId,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle CLEAR_ALL action
 * Clears all workspaces for session switch
 */
export function handleClearAll(state: LayoutState): LayoutState {
  return {
    ...state,
    workspaces: {},
    activeWorkspaceId: 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}
