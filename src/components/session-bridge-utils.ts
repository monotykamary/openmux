import type { Rectangle, WorkspaceId } from '../core/types';
import type { LayoutConfig } from '../core/config';
import {
  layoutReducer,
  type LayoutState,
  type Workspaces,
} from '../core/operations/layout-actions';
export function pruneMissingPanes(params: {
  workspaces: Workspaces;
  activeWorkspaceId: WorkspaceId;
  paneIds: string[];
  viewport: Rectangle;
  config: LayoutConfig;
}): { workspaces: Workspaces; activeWorkspaceId: WorkspaceId } {
  if (params.paneIds.length === 0) {
    return { workspaces: params.workspaces, activeWorkspaceId: params.activeWorkspaceId };
  }

  let state: LayoutState = {
    workspaces: params.workspaces,
    activeWorkspaceId: params.activeWorkspaceId,
    viewport: params.viewport,
    config: params.config,
    layoutVersion: 0,
  };

  for (const paneId of new Set(params.paneIds)) {
    state = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId });
  }

  return { workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId };
}
