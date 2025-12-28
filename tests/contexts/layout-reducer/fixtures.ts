import { beforeEach } from 'vitest';
import type { Rectangle, Workspace, WorkspaceId, PaneData } from '../../../src/core/types';
import { DEFAULT_CONFIG } from '../../../src/core/config';
import {
  resetPaneIdCounter,
  resetSplitIdCounter,
  type LayoutState,
} from '../../../src/core/operations/layout-actions';
import { calculateMasterStackLayout } from '../../../src/core/operations/master-stack-layout';

export const defaultViewport: Rectangle = { x: 0, y: 0, width: 120, height: 40 };

export function createInitialState(overrides?: Partial<LayoutState>): LayoutState {
  return {
    workspaces: {},
    activeWorkspaceId: 1,
    viewport: defaultViewport,
    config: DEFAULT_CONFIG,
    layoutVersion: 0,
    layoutGeometryVersion: 0,
    ...overrides,
  };
}

export function createWorkspaceWithPanes(
  id: WorkspaceId,
  mainPane: PaneData | null,
  stackPanes: PaneData[] = [],
  options?: Partial<Workspace> & { skipLayout?: boolean }
): Workspace {
  const workspace: Workspace = {
    id,
    mainPane,
    stackPanes,
    focusedPaneId: mainPane?.id ?? null,
    activeStackIndex: 0,
    layoutMode: 'vertical',
    zoomed: false,
    ...options,
  };

  if (!workspace.mainPane || options?.skipLayout) {
    return workspace;
  }

  return calculateMasterStackLayout(workspace, defaultViewport, DEFAULT_CONFIG);
}

export function setupLayoutReducerTest(): void {
  beforeEach(() => {
    // Reset pane ID counter before each test for determinism
    resetPaneIdCounter();
    resetSplitIdCounter();
  });
}
