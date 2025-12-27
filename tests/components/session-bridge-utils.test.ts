import { describe, expect, it } from 'vitest';
import type { PaneData } from '../../src/core/types';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { pruneMissingPanes } from '../../src/components/session-bridge-utils';
import {
  createWorkspaceWithPanes,
  defaultViewport,
  setupLayoutReducerTest,
} from '../contexts/layout-reducer/fixtures';

describe('pruneMissingPanes', () => {
  setupLayoutReducerTest();

  it('removes missing main pane and promotes stack', () => {
    const mainPane: PaneData = { id: 'pane-1' };
    const stackPane: PaneData = { id: 'pane-2' };
    const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);

    const result = pruneMissingPanes({
      workspaces: { 1: workspace },
      activeWorkspaceId: 1,
      paneIds: ['pane-1'],
      viewport: defaultViewport,
      config: DEFAULT_CONFIG,
    });

    const updated = result.workspaces[1]!;
    expect(updated.mainPane?.id).toBe('pane-2');
    expect(updated.stackPanes).toHaveLength(0);
  });

  it('removes missing stack pane and keeps main pane', () => {
    const mainPane: PaneData = { id: 'pane-1' };
    const stackPaneA: PaneData = { id: 'pane-2' };
    const stackPaneB: PaneData = { id: 'pane-3' };
    const workspace = createWorkspaceWithPanes(1, mainPane, [stackPaneA, stackPaneB]);

    const result = pruneMissingPanes({
      workspaces: { 1: workspace },
      activeWorkspaceId: 1,
      paneIds: ['pane-2'],
      viewport: defaultViewport,
      config: DEFAULT_CONFIG,
    });

    const updated = result.workspaces[1]!;
    expect(updated.mainPane?.id).toBe('pane-1');
    expect(updated.stackPanes).toHaveLength(1);
    expect(updated.stackPanes[0]!.id).toBe('pane-3');
  });
});
