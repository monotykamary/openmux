/**
 * FOCUS_PANE action handler
 */

import type { Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';

/**
 * Handle FOCUS_PANE action
 * Updates the focused pane and activeStackIndex
 */
export function handleFocusPane(state: LayoutState, paneId: string): LayoutState {
  const workspace = getActiveWorkspace(state);

  // Update activeStackIndex if focusing a stack pane
  let activeStackIndex = workspace.activeStackIndex;
  const stackIndex = workspace.stackPanes.findIndex(p => p.id === paneId);
  if (stackIndex >= 0) {
    activeStackIndex = stackIndex;
  }

  let updated: Workspace = {
    ...workspace,
    focusedPaneId: paneId,
    activeStackIndex,
  };

  // If zoomed, recalculate layout so new focused pane gets fullscreen
  if (workspace.zoomed) {
    updated = recalculateLayout(updated, state.viewport, state.config);
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}
