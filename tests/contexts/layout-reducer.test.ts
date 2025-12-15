/**
 * Tests for the layout reducer and helper functions.
 * These tests verify all reducer actions and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Rectangle, Workspace, WorkspaceId, LayoutMode, PaneData } from '../../src/core/types';
import type { LayoutConfig } from '../../src/core/config';
import { DEFAULT_CONFIG } from '../../src/core/config';

// We'll import from the extracted module once refactoring is complete
// For now, we define the reducer types and test the pure logic

interface LayoutState {
  workspaces: Map<WorkspaceId, Workspace>;
  activeWorkspaceId: WorkspaceId;
  viewport: Rectangle;
  config: LayoutConfig;
  layoutVersion: number;
}

type LayoutAction =
  | { type: 'FOCUS_PANE'; paneId: string }
  | { type: 'NAVIGATE'; direction: 'north' | 'south' | 'east' | 'west' }
  | { type: 'NEW_PANE'; ptyId?: string; title?: string }
  | { type: 'CLOSE_PANE' }
  | { type: 'CLOSE_PANE_BY_ID'; paneId: string }
  | { type: 'SET_VIEWPORT'; viewport: Rectangle }
  | { type: 'SWITCH_WORKSPACE'; workspaceId: WorkspaceId }
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'SET_PANE_PTY'; paneId: string; ptyId: string }
  | { type: 'SWAP_MAIN' }
  | { type: 'TOGGLE_ZOOM' }
  | { type: 'LOAD_SESSION'; workspaces: Map<WorkspaceId, Workspace>; activeWorkspaceId: WorkspaceId }
  | { type: 'CLEAR_ALL' };

// Import the extracted reducer once ready
import {
  layoutReducer,
  createWorkspace,
  getActiveWorkspace,
  updateWorkspace,
  generatePaneId,
  resetPaneIdCounter,
} from '../../src/core/operations/layout-actions';

describe('Layout Reducer', () => {
  const defaultViewport: Rectangle = { x: 0, y: 0, width: 120, height: 40 };

  function createInitialState(overrides?: Partial<LayoutState>): LayoutState {
    return {
      workspaces: new Map(),
      activeWorkspaceId: 1,
      viewport: defaultViewport,
      config: DEFAULT_CONFIG,
      layoutVersion: 0,
      ...overrides,
    };
  }

  function createWorkspaceWithPanes(
    id: WorkspaceId,
    mainPane: PaneData | null,
    stackPanes: PaneData[] = [],
    options?: Partial<Workspace>
  ): Workspace {
    return {
      id,
      mainPane,
      stackPanes,
      focusedPaneId: mainPane?.id ?? null,
      activeStackIndex: 0,
      layoutMode: 'vertical',
      zoomed: false,
      ...options,
    };
  }

  beforeEach(() => {
    // Reset pane ID counter before each test for determinism
    resetPaneIdCounter();
  });

  describe('Helper functions', () => {
    describe('generatePaneId', () => {
      it('should generate sequential IDs', () => {
        expect(generatePaneId()).toBe('pane-1');
        expect(generatePaneId()).toBe('pane-2');
        expect(generatePaneId()).toBe('pane-3');
      });
    });

    describe('createWorkspace', () => {
      it('should create empty workspace with default values', () => {
        const workspace = createWorkspace(1, 'vertical');
        expect(workspace).toEqual({
          id: 1,
          mainPane: null,
          stackPanes: [],
          focusedPaneId: null,
          activeStackIndex: 0,
          layoutMode: 'vertical',
          zoomed: false,
        });
      });

      it('should respect provided layout mode', () => {
        expect(createWorkspace(2, 'horizontal').layoutMode).toBe('horizontal');
        expect(createWorkspace(3, 'stacked').layoutMode).toBe('stacked');
      });
    });

    describe('getActiveWorkspace', () => {
      it('should return existing workspace', () => {
        const workspace = createWorkspaceWithPanes(1, { id: 'pane-1', title: 'test' });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });
        expect(getActiveWorkspace(state)).toBe(workspace);
      });

      it('should create new workspace if not exists', () => {
        const state = createInitialState();
        const workspace = getActiveWorkspace(state);
        expect(workspace.id).toBe(1);
        expect(workspace.mainPane).toBeNull();
      });
    });
  });

  describe('FOCUS_PANE action', () => {
    it('should focus the specified pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.focusedPaneId).toBe('pane-2');
    });

    it('should update activeStackIndex when focusing stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [
        { id: 'pane-2' },
        { id: 'pane-3' },
        { id: 'pane-4' },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-4' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.activeStackIndex).toBe(2);
    });

    it('should not update activeStackIndex when focusing main pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-1' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.focusedPaneId).toBe('pane-1');
      expect(newWorkspace.activeStackIndex).toBe(0); // Unchanged
    });

    it('should recalculate layout when zoomed', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        zoomed: true,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces.get(1)!;

      // When zoomed, focused pane should get full viewport
      expect(newWorkspace.stackPanes[0]?.rectangle).toEqual(defaultViewport);
      expect(newWorkspace.mainPane?.rectangle).toBeUndefined();
    });
  });

  describe('NAVIGATE action', () => {
    describe('vertical/stacked layout', () => {
      it('should navigate east from main to stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-1',
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-2');
      });

      it('should navigate west from stack to main', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-2',
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'west' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-1');
      });

      it('should navigate north/south within stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [
          { id: 'pane-2' },
          { id: 'pane-3' },
          { id: 'pane-4' },
        ];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-3',
          activeStackIndex: 1,
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        // Navigate north (up in stack)
        let newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-2');

        // Navigate south (down in stack)
        newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-4');
      });

      it('should not navigate north when at top of stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-2',
          activeStackIndex: 0,
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-2');
      });

      it('should not navigate south when at bottom of stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-3',
          activeStackIndex: 1,
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-3');
      });

      it('should navigate to correct stack pane using activeStackIndex', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [
          { id: 'pane-2' },
          { id: 'pane-3' },
          { id: 'pane-4' },
        ];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-1',
          activeStackIndex: 2, // Remember last focused stack pane
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-4');
      });
    });

    describe('horizontal layout', () => {
      it('should navigate south from main to stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-1',
          layoutMode: 'horizontal',
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-2');
      });

      it('should navigate north from stack to main', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-2',
          layoutMode: 'horizontal',
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-1');
      });

      it('should navigate west/east within stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [
          { id: 'pane-2' },
          { id: 'pane-3' },
          { id: 'pane-4' },
        ];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-3',
          activeStackIndex: 1,
          layoutMode: 'horizontal',
        });
        const state = createInitialState({
          workspaces: new Map([[1, workspace]]),
        });

        // Navigate west
        let newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'west' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-2');

        // Navigate east
        newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces.get(1)!.focusedPaneId).toBe('pane-4');
      });
    });

    it('should return same state when no panes', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
      expect(newState).toBe(state);
    });

    it('should return same state when focused pane not found', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: 'non-existent',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
      expect(newState).toBe(state);
    });
  });

  describe('NEW_PANE action', () => {
    it('should create first pane as main pane', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces.get(1)!;
      expect(workspace.mainPane).not.toBeNull();
      expect(workspace.mainPane!.id).toBe('pane-1');
      expect(workspace.focusedPaneId).toBe('pane-1');
      expect(workspace.stackPanes).toHaveLength(0);
    });

    it('should add subsequent panes to stack', () => {
      // First create a pane using NEW_PANE to sync the counter
      const initialState = createInitialState();
      const stateWithMain = layoutReducer(initialState, { type: 'NEW_PANE' });

      // Now add second pane
      const newState = layoutReducer(stateWithMain, { type: 'NEW_PANE' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.mainPane!.id).toBe('pane-1');
      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-2');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');
      expect(newWorkspace.activeStackIndex).toBe(0);
    });

    it('should use provided ptyId and title', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, {
        type: 'NEW_PANE',
        ptyId: 'pty-123',
        title: 'my-shell',
      });

      const workspace = newState.workspaces.get(1)!;
      expect(workspace.mainPane!.ptyId).toBe('pty-123');
      expect(workspace.mainPane!.title).toBe('my-shell');
    });

    it('should default title to shell', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces.get(1)!;
      expect(workspace.mainPane!.title).toBe('shell');
    });

    it('should increment layout version', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });
      expect(newState.layoutVersion).toBe(1);
    });

    it('should calculate layout rectangles', () => {
      const state = createInitialState();
      let newState = layoutReducer(state, { type: 'NEW_PANE' });

      // Single pane gets full viewport
      expect(newState.workspaces.get(1)!.mainPane!.rectangle).toEqual(defaultViewport);

      // Add second pane - should split
      newState = layoutReducer(newState, { type: 'NEW_PANE' });
      const workspace = newState.workspaces.get(1)!;

      expect(workspace.mainPane!.rectangle!.width).toBeLessThan(defaultViewport.width);
      expect(workspace.stackPanes[0]!.rectangle).toBeDefined();
    });
  });

  describe('CLOSE_PANE action', () => {
    it('should close main pane and promote first stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-1',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');
    });

    it('should close stack pane and adjust focus', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      // Should focus adjacent pane or main
      expect(newWorkspace.focusedPaneId).toBe('pane-3');
    });

    it('should focus main when closing last stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.stackPanes).toHaveLength(0);
      expect(newWorkspace.focusedPaneId).toBe('pane-1');
    });

    it('should clear workspace when closing only pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });

      // Workspace should be removed from map
      expect(newState.workspaces.has(1)).toBe(false);
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      expect(newState).toBe(state);
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-2',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('CLOSE_PANE_BY_ID action', () => {
    it('should close pane by specific ID', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-1', // Focus main, but close stack pane
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.stackPanes).toHaveLength(1);
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-1'); // Focus unchanged
    });

    it('should update focus when closing focused pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.focusedPaneId).toBe('pane-3');
    });

    it('should adjust activeStackIndex when closing pane before it', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [
        { id: 'pane-2' },
        { id: 'pane-3' },
        { id: 'pane-4' },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-4',
        activeStackIndex: 2,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces.get(1)!;

      // Active index should be adjusted
      expect(newWorkspace.activeStackIndex).toBe(1);
      expect(newWorkspace.focusedPaneId).toBe('pane-4');
    });

    it('should return same state when pane not found', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'non-existent' });
      expect(newState).toBe(state);
    });

    it('should close main pane and promote stack', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPanes: PaneData[] = [{ id: 'pane-2' }];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: 'pane-2',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-1' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes).toHaveLength(0);
    });
  });

  describe('SET_VIEWPORT action', () => {
    it('should update viewport and recalculate all layouts', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      expect(newState.viewport).toEqual(newViewport);
      expect(newState.workspaces.get(1)!.mainPane!.rectangle).toEqual(newViewport);
    });

    it('should recalculate all workspaces', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: new Map([
          [1, workspace1],
          [2, workspace2],
        ]),
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      expect(newState.workspaces.get(1)!.mainPane!.rectangle).toEqual(newViewport);
      expect(newState.workspaces.get(2)!.mainPane!.rectangle).toEqual(newViewport);
    });

    it('should not modify empty workspaces', () => {
      const emptyWorkspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: new Map([[1, emptyWorkspace]]),
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      // Empty workspace should remain unchanged
      expect(newState.workspaces.get(1)!.mainPane).toBeNull();
    });
  });

  describe('SWITCH_WORKSPACE action', () => {
    it('should switch to existing workspace', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: new Map([
          [1, workspace1],
          [2, workspace2],
        ]),
      });

      const newState = layoutReducer(state, { type: 'SWITCH_WORKSPACE', workspaceId: 2 });
      expect(newState.activeWorkspaceId).toBe(2);
    });

    it('should create new workspace if not exists', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'SWITCH_WORKSPACE', workspaceId: 5 });

      expect(newState.activeWorkspaceId).toBe(5);
      expect(newState.workspaces.has(5)).toBe(true);
      expect(newState.workspaces.get(5)!.mainPane).toBeNull();
    });

    it('should increment layout version', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'SWITCH_WORKSPACE', workspaceId: 2 });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('SET_LAYOUT_MODE action', () => {
    it('should change layout mode', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      expect(newState.workspaces.get(1)!.layoutMode).toBe('horizontal');
    });

    it('should recalculate layout when has panes', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      const newWorkspace = newState.workspaces.get(1)!;

      // Layout should be recalculated with new mode
      expect(newWorkspace.mainPane!.rectangle).toBeDefined();
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeDefined();
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'stacked' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('SET_PANE_PTY action', () => {
    it('should set ptyId on main pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-1',
        ptyId: 'pty-123',
      });

      expect(newState.workspaces.get(1)!.mainPane!.ptyId).toBe('pty-123');
    });

    it('should set ptyId on stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-456',
      });

      expect(newState.workspaces.get(1)!.stackPanes[0]!.ptyId).toBe('pty-456');
    });

    it('should not modify other panes', () => {
      const mainPane: PaneData = { id: 'pane-1', ptyId: 'pty-original' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-new',
      });

      expect(newState.workspaces.get(1)!.mainPane!.ptyId).toBe('pty-original');
    });
  });

  describe('SWAP_MAIN action', () => {
    it('should swap focused stack pane with main', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-2',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes[0]!.id).toBe('pane-1');
    });

    it('should return same state when main pane is focused', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1', // Main is focused
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should return same state when no main pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should return same state when no focused pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: null,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-2',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('TOGGLE_ZOOM action', () => {
    it('should toggle zoom on', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1',
        zoomed: false,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.zoomed).toBe(true);
      // Focused pane should get full viewport
      expect(newWorkspace.mainPane!.rectangle).toEqual(defaultViewport);
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeUndefined();
    });

    it('should toggle zoom off', () => {
      const mainPane: PaneData = { id: 'pane-1', rectangle: defaultViewport };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: 'pane-1',
        zoomed: true,
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces.get(1)!;

      expect(newWorkspace.zoomed).toBe(false);
      // Should recalculate normal layout
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeDefined();
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      expect(newState).toBe(state);
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: 'pane-1',
      });
      const state = createInitialState({
        workspaces: new Map([[1, workspace]]),
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('LOAD_SESSION action', () => {
    it('should load workspaces from session', () => {
      const state = createInitialState();
      const loadedWorkspace: Workspace = {
        id: 3,
        mainPane: { id: 'pane-100' },
        stackPanes: [{ id: 'pane-101' }],
        focusedPaneId: 'pane-100',
        activeStackIndex: 0,
        layoutMode: 'horizontal',
        zoomed: false,
      };

      const newState = layoutReducer(state, {
        type: 'LOAD_SESSION',
        workspaces: new Map([[3, loadedWorkspace]]),
        activeWorkspaceId: 3,
      });

      expect(newState.activeWorkspaceId).toBe(3);
      expect(newState.workspaces.has(3)).toBe(true);
      expect(newState.workspaces.get(3)!.mainPane!.id).toBe('pane-100');
    });

    it('should recalculate layouts for loaded workspaces', () => {
      const state = createInitialState();
      const loadedWorkspace: Workspace = {
        id: 1,
        mainPane: { id: 'pane-1' },
        stackPanes: [],
        focusedPaneId: 'pane-1',
        activeStackIndex: 0,
        layoutMode: 'vertical',
        zoomed: false,
      };

      const newState = layoutReducer(state, {
        type: 'LOAD_SESSION',
        workspaces: new Map([[1, loadedWorkspace]]),
        activeWorkspaceId: 1,
      });

      // Should have calculated rectangle
      expect(newState.workspaces.get(1)!.mainPane!.rectangle).toBeDefined();
    });
  });

  describe('CLEAR_ALL action', () => {
    it('should clear all workspaces', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: new Map([
          [1, workspace1],
          [2, workspace2],
        ]),
        activeWorkspaceId: 2,
      });

      const newState = layoutReducer(state, { type: 'CLEAR_ALL' });

      expect(newState.workspaces.size).toBe(0);
      expect(newState.activeWorkspaceId).toBe(1);
    });
  });

  describe('Unknown action', () => {
    it('should return same state for unknown action', () => {
      const state = createInitialState();
      // @ts-expect-error - Testing unknown action
      const newState = layoutReducer(state, { type: 'UNKNOWN_ACTION' });
      expect(newState).toBe(state);
    });
  });
});
