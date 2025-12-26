/**
 * CLOSE_PANE and CLOSE_PANE_BY_ID action handlers
 * Consolidated to avoid code duplication
 */

import type { Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';

/**
 * Handle CLOSE_PANE action
 * Closes the currently focused pane
 */
export function handleClosePane(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.focusedPaneId) return state;

  return closePaneById(state, workspace, workspace.focusedPaneId, true);
}

/**
 * Handle CLOSE_PANE_BY_ID action
 * Closes a specific pane by ID
 */
export function handleClosePaneById(state: LayoutState, paneId: string): LayoutState {
  for (const workspace of Object.values(state.workspaces)) {
    if (!workspace) continue;
    if (workspace.mainPane?.id === paneId || workspace.stackPanes.some((pane) => pane.id === paneId)) {
      return closePaneById(state, workspace, paneId, paneId === workspace.focusedPaneId);
    }
  }
  return state;
}

/**
 * Core logic for closing a pane
 * Handles both main and stack pane closure
 */
function closePaneById(
  state: LayoutState,
  workspace: Workspace,
  paneId: string,
  closingFocusedPane: boolean
): LayoutState {
  let updated: Workspace;

  if (workspace.mainPane?.id === paneId) {
    // Closing main pane
    updated = closeMainPane(workspace);
  } else {
    // Closing a stack pane
    const result = closeStackPane(workspace, paneId, closingFocusedPane);
    if (!result) return state; // Pane not found
    updated = result;
  }

  if (updated.mainPane) {
    updated = recalculateLayout(updated, state.viewport, state.config);
    return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
  }

  // Workspace is now empty - remove it
  const remainingWorkspaces = { ...state.workspaces };
  delete remainingWorkspaces[workspace.id];
  return { ...state, workspaces: remainingWorkspaces, layoutVersion: state.layoutVersion + 1 };
}

/**
 * Close the main pane and promote first stack pane
 */
function closeMainPane(workspace: Workspace): Workspace {
  if (workspace.stackPanes.length > 0) {
    // Promote first stack pane to main
    const [newMain, ...remainingStack] = workspace.stackPanes;
    return {
      ...workspace,
      mainPane: newMain!,
      stackPanes: remainingStack,
      focusedPaneId: newMain!.id,
      activeStackIndex: Math.min(workspace.activeStackIndex, Math.max(0, remainingStack.length - 1)),
    };
  }
  // No more panes
  return {
    ...workspace,
    mainPane: null,
    focusedPaneId: null,
  };
}

/**
 * Close a stack pane and adjust focus/indices
 */
function closeStackPane(
  workspace: Workspace,
  paneId: string,
  closingFocusedPane: boolean
): Workspace | null {
  const closeIndex = workspace.stackPanes.findIndex(p => p.id === paneId);
  if (closeIndex < 0) return null;

  const newStack = workspace.stackPanes.filter((_, i) => i !== closeIndex);
  let newFocusId: string | null = workspace.focusedPaneId;
  let newActiveIndex = workspace.activeStackIndex;

  if (closingFocusedPane) {
    // Closing the focused pane - need to update focus
    if (newStack.length > 0) {
      newActiveIndex = Math.min(closeIndex, newStack.length - 1);
      newFocusId = newStack[newActiveIndex]?.id ?? workspace.mainPane?.id ?? null;
    } else {
      newFocusId = workspace.mainPane?.id ?? null;
      newActiveIndex = 0;
    }
  } else if (closeIndex <= workspace.activeStackIndex) {
    // Closing pane before active - adjust index
    newActiveIndex = Math.max(0, workspace.activeStackIndex - 1);
  }

  return {
    ...workspace,
    stackPanes: newStack,
    focusedPaneId: newFocusId,
    activeStackIndex: newActiveIndex,
  };
}
