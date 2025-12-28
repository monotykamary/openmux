/**
 * Tests for workspace-focused layout reducer actions.
 */

import { describe, it, expect } from 'vitest';
import type { PaneData, Workspace } from '../../../src/core/types';
import { layoutReducer, createWorkspace } from '../../../src/core/operations/layout-actions';
import { createInitialState, createWorkspaceWithPanes, setupLayoutReducerTest } from './fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('SET_VIEWPORT action', () => {
    it('should update viewport and recalculate all layouts', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      expect(newState.viewport).toEqual(newViewport);
      expect(newState.workspaces[1]!.mainPane!.rectangle).toEqual(newViewport);
      expect(newState.layoutGeometryVersion).toBe(1);
    });

    it('should recalculate all workspaces', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: { 1: workspace1, 2: workspace2 },
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      expect(newState.workspaces[1]!.mainPane!.rectangle).toEqual(newViewport);
      expect(newState.workspaces[2]!.mainPane!.rectangle).toEqual(newViewport);
    });

    it('should not modify empty workspaces', () => {
      const emptyWorkspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: emptyWorkspace },
      });

      const newViewport: Rectangle = { x: 0, y: 0, width: 200, height: 60 };
      const newState = layoutReducer(state, { type: 'SET_VIEWPORT', viewport: newViewport });

      // Empty workspace should remain unchanged
      expect(newState.workspaces[1]!.mainPane).toBeNull();
    });
  });

  describe('SWITCH_WORKSPACE action', () => {
    it('should switch to existing workspace', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: { 1: workspace1, 2: workspace2 },
      });

      const newState = layoutReducer(state, { type: 'SWITCH_WORKSPACE', workspaceId: 2 });
      expect(newState.activeWorkspaceId).toBe(2);
    });

    it('should create new workspace if not exists', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'SWITCH_WORKSPACE', workspaceId: 5 });

      expect(newState.activeWorkspaceId).toBe(5);
      expect(newState.workspaces[5]).toBeDefined();
      expect(newState.workspaces[5]!.mainPane).toBeNull();
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      expect(newState.workspaces[1]!.layoutMode).toBe('horizontal');
    });

    it('should recalculate layout when has panes', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      const newWorkspace = newState.workspaces[1]!;

      // Layout should be recalculated with new mode
      expect(newWorkspace.mainPane!.rectangle).toBeDefined();
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeDefined();
    });

    it('should increment layout version', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SET_LAYOUT_MODE', mode: 'stacked' });
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
        workspaces: { 3: loadedWorkspace },
        activeWorkspaceId: 3,
      });

      expect(newState.activeWorkspaceId).toBe(3);
      expect(newState.workspaces[3]).toBeDefined();
      expect(newState.workspaces[3]!.mainPane!.id).toBe('pane-100');
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
        workspaces: { 1: loadedWorkspace },
        activeWorkspaceId: 1,
      });

      // Should have calculated rectangle
      expect(newState.workspaces[1]!.mainPane!.rectangle).toBeDefined();
    });
  });

  describe('CLEAR_ALL action', () => {
    it('should clear all workspaces', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' });
      const state = createInitialState({
        workspaces: { 1: workspace1, 2: workspace2 },
        activeWorkspaceId: 2,
      });

      const newState = layoutReducer(state, { type: 'CLEAR_ALL' });

      expect(Object.keys(newState.workspaces).length).toBe(0);
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
