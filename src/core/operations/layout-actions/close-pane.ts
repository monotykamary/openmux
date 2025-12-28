/**
 * CLOSE_PANE and CLOSE_PANE_BY_ID action handlers
 * Consolidated to avoid code duplication
 */

import type { Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { containsPane, removePaneFromNode, getFirstPane, findSiblingPane } from '../../layout-tree';

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
    if (
      (workspace.mainPane && containsPane(workspace.mainPane, paneId)) ||
      workspace.stackPanes.some((pane) => containsPane(pane, paneId))
    ) {
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

  if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
    // Closing main pane
    updated = closeMainPane(workspace, paneId, closingFocusedPane);
  } else {
    // Closing a stack pane
    const result = closeStackPane(workspace, paneId, closingFocusedPane);
    if (!result) return state; // Pane not found
    updated = result;
  }

  if (updated.mainPane) {
    updated = recalculateLayout(updated, state.viewport, state.config);
    return {
      ...state,
      workspaces: updateWorkspace(state, updated),
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  // Workspace is now empty - remove it
  const remainingWorkspaces = { ...state.workspaces };
  delete remainingWorkspaces[workspace.id];
  return {
    ...state,
    workspaces: remainingWorkspaces,
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Close the main pane and promote first stack pane
 */
function closeMainPane(workspace: Workspace, paneId: string, closingFocusedPane: boolean): Workspace {
  if (!workspace.mainPane) return workspace;

  const siblingPane = closingFocusedPane ? findSiblingPane(workspace.mainPane, paneId) : null;
  const updatedMain = removePaneFromNode(workspace.mainPane, paneId);
  if (updatedMain) {
    const nextFocus = closingFocusedPane
      ? siblingPane?.id ?? getFirstPane(updatedMain)?.id ?? null
      : workspace.focusedPaneId;
    return {
      ...workspace,
      mainPane: updatedMain,
      focusedPaneId: nextFocus ?? workspace.focusedPaneId,
    };
  }

  if (workspace.stackPanes.length > 0) {
    const [newMain, ...remainingStack] = workspace.stackPanes;
    const newFocusId = getFirstPane(newMain)?.id ?? null;
    return {
      ...workspace,
      mainPane: newMain!,
      stackPanes: remainingStack,
      focusedPaneId: newFocusId,
      activeStackIndex: Math.min(workspace.activeStackIndex, Math.max(0, remainingStack.length - 1)),
    };
  }

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
  const closeIndex = workspace.stackPanes.findIndex(p => containsPane(p, paneId));
  if (closeIndex < 0) return null;

  const siblingPane = closingFocusedPane ? findSiblingPane(workspace.stackPanes[closeIndex]!, paneId) : null;
  const updatedStackEntry = removePaneFromNode(workspace.stackPanes[closeIndex]!, paneId);
  const newStack = updatedStackEntry
    ? workspace.stackPanes.map((pane, index) => (index === closeIndex ? updatedStackEntry : pane))
    : workspace.stackPanes.filter((_, i) => i !== closeIndex);
  let newFocusId: string | null = workspace.focusedPaneId;
  let newActiveIndex = workspace.activeStackIndex;

  if (closingFocusedPane) {
    // Closing the focused pane - need to update focus
    if (updatedStackEntry) {
      const mainFallback = workspace.mainPane ? getFirstPane(workspace.mainPane)?.id ?? null : null;
      newFocusId = siblingPane?.id ?? getFirstPane(updatedStackEntry)?.id ?? mainFallback;
      newActiveIndex = closeIndex;
    } else if (newStack.length > 0) {
      newActiveIndex = Math.min(closeIndex, newStack.length - 1);
      newFocusId = getFirstPane(newStack[newActiveIndex]!)?.id ?? getFirstPane(workspace.mainPane)?.id ?? null;
    } else {
      newFocusId = getFirstPane(workspace.mainPane)?.id ?? null;
      newActiveIndex = 0;
    }
  } else if (!updatedStackEntry && closeIndex <= workspace.activeStackIndex) {
    newActiveIndex = Math.max(0, workspace.activeStackIndex - 1);
  }

  return {
    ...workspace,
    stackPanes: newStack,
    focusedPaneId: newFocusId,
    activeStackIndex: newActiveIndex,
  };
}
