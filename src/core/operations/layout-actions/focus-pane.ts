/**
 * FOCUS_PANE action handler
 */

import type { Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { containsPane } from '../../layout-tree';

/**
 * Handle FOCUS_PANE action
 * Updates the focused pane and activeStackIndex
 */
export function handleFocusPane(state: LayoutState, paneId: string): LayoutState {
  const workspace = getActiveWorkspace(state);

  // Early return if pane is already focused (prevents unnecessary state recreation)
  if (workspace.focusedPaneId === paneId) {
    return state;
  }

  // Update activeStackIndex if focusing a stack pane
  let activeStackIndex = workspace.activeStackIndex;
  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, paneId));
  const stackIndexChanged = stackIndex >= 0 && stackIndex !== workspace.activeStackIndex;
  if (stackIndex >= 0) {
    activeStackIndex = stackIndex;
  }

  let updated: Workspace = {
    ...workspace,
    focusedPaneId: paneId,
    activeStackIndex,
  };

  // In stacked layout, switching active stack entry needs a layout pass to set rectangles.
  const needsStackedRecalc = workspace.layoutMode === 'stacked' && stackIndexChanged;
  const needsRecalc = workspace.zoomed || needsStackedRecalc;
  // If zoomed/stacked, recalculate layout so new focused pane gets updated geometry
  if (needsRecalc) {
    updated = recalculateLayout(updated, state.viewport, state.config);
    return {
      ...state,
      workspaces: updateWorkspace(state, updated),
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}
