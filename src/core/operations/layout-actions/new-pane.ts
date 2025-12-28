/**
 * NEW_PANE action handler
 */

import type { PaneData, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout, generatePaneId } from './helpers';

/**
 * Handle NEW_PANE action
 * Creates a new pane, either as main or in stack
 */
export function handleNewPane(state: LayoutState, ptyId?: string, title?: string): LayoutState {
  const workspace = getActiveWorkspace(state);
  const newPaneId = generatePaneId();
  const newPane: PaneData = {
    id: newPaneId,
    ptyId,
    title: title ?? 'shell',
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
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}
