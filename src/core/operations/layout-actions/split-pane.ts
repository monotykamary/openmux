/**
 * SPLIT_PANE action handler
 */

import type { PaneData, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout, generatePaneId, generateSplitId } from './helpers';
import { containsPane, replacePaneWithSplit } from '../../layout-tree';

export function handleSplitPane(
  state: LayoutState,
  direction: 'horizontal' | 'vertical',
  ptyId?: string,
  title?: string
): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.focusedPaneId) return state;
  if (!workspace.mainPane) return state;

  const newPaneId = generatePaneId();
  const newPane: PaneData = {
    id: newPaneId,
    ptyId,
    title: title ?? 'shell',
  };

  let updated: Workspace | null = null;
  const splitId = generateSplitId();

  if (containsPane(workspace.mainPane, workspace.focusedPaneId)) {
    updated = {
      ...workspace,
      mainPane: replacePaneWithSplit(
        workspace.mainPane,
        workspace.focusedPaneId,
        newPane,
        direction,
        state.config.defaultSplitRatio,
        splitId
      ),
      focusedPaneId: newPaneId,
    };
  } else {
    const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, workspace.focusedPaneId!));
    if (stackIndex < 0) return state;

    const newStack = workspace.stackPanes.map((pane, index) =>
      index === stackIndex
        ? replacePaneWithSplit(
            pane,
            workspace.focusedPaneId!,
            newPane,
            direction,
            state.config.defaultSplitRatio,
            splitId
          )
        : pane
    );

    updated = {
      ...workspace,
      stackPanes: newStack,
      focusedPaneId: newPaneId,
      activeStackIndex: stackIndex,
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
