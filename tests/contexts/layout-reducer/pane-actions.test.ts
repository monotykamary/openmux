/**
 * Tests for pane-focused layout reducer actions.
 */

import { describe, it, expect } from 'vitest';
import type { PaneData, SplitNode } from '../../../src/core/types';
import { layoutReducer, createWorkspace, generatePaneId } from '../../../src/core/operations/layout-actions';
import { collectPanes, isSplitNode } from '../../../src/core/layout-tree';
import {
  createInitialState,
  createWorkspaceWithPanes,
  defaultViewport,
  setupLayoutReducerTest,
} from './fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('NEW_PANE action', () => {
    it('should create first pane as main pane', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces[1]!;
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
      const newWorkspace = newState.workspaces[1]!;

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

      const workspace = newState.workspaces[1]!;
      expect(workspace.mainPane!.ptyId).toBe('pty-123');
      expect(workspace.mainPane!.title).toBe('my-shell');
    });

    it('should default title to shell', () => {
      const state = createInitialState();
      const newState = layoutReducer(state, { type: 'NEW_PANE' });

      const workspace = newState.workspaces[1]!;
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
      expect(newState.workspaces[1]!.mainPane!.rectangle).toEqual(defaultViewport);

      // Add second pane - should split
      newState = layoutReducer(newState, { type: 'NEW_PANE' });
      const workspace = newState.workspaces[1]!;

      expect(workspace.mainPane!.rectangle!.width).toBeLessThan(defaultViewport.width);
      expect(workspace.stackPanes[0]!.rectangle).toBeDefined();
    });
  });

  describe('SPLIT_PANE action', () => {
    it('should split the focused main pane into a split node', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      const newWorkspace = newState.workspaces[1]!;
      const mainNode = newWorkspace.mainPane!;

      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect(split.direction).toBe('vertical');

      const firstPane = split.first as PaneData;
      const secondPane = split.second as PaneData;
      expect(firstPane.id).toBe(mainPane.id);
      expect(secondPane.id).toBe('pane-2');
      expect(newWorkspace.focusedPaneId).toBe('pane-2');

      expect(firstPane.rectangle).toBeDefined();
      expect(secondPane.rectangle).toBeDefined();
      expect(firstPane.rectangle!.height).toBe(defaultViewport.height);
      expect(secondPane.rectangle!.height).toBe(defaultViewport.height);
      expect(firstPane.rectangle!.width + secondPane.rectangle!.width).toBe(defaultViewport.width);
    });

    it('should split a stack pane in stacked layout', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
        focusedPaneId: stackPane.id,
        activeStackIndex: 0,
        layoutMode: 'stacked',
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });
      const newWorkspace = newState.workspaces[1]!;
      const stackNode = newWorkspace.stackPanes[0]!;

      expect(isSplitNode(stackNode)).toBe(true);
      const split = stackNode as SplitNode;
      expect(split.direction).toBe('horizontal');

      const firstPane = split.first as PaneData;
      const secondPane = split.second as PaneData;
      expect(firstPane.id).toBe(stackPane.id);
      expect(secondPane.id).toBe('pane-3');
      expect(newWorkspace.focusedPaneId).toBe('pane-3');

      expect(split.rectangle).toBeDefined();
      expect(firstPane.rectangle).toBeDefined();
      expect(secondPane.rectangle).toBeDefined();
      expect(firstPane.rectangle!.width).toBe(split.rectangle!.width);
      expect(secondPane.rectangle!.width).toBe(split.rectangle!.width);
      expect(firstPane.rectangle!.height + secondPane.rectangle!.height).toBe(split.rectangle!.height);
    });

    it('should support nested splits within main pane', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      let state = createInitialState({
        workspaces: { 1: workspace },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });

      const mainNode = state.workspaces[1]!.mainPane!;
      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect(split.direction).toBe('vertical');

      expect(isSplitNode(split.second)).toBe(true);
      const nested = split.second as SplitNode;
      expect(nested.direction).toBe('horizontal');
      expect((nested.first as PaneData).id).toBe('pane-2');
      expect((nested.second as PaneData).id).toBe('pane-3');

      const panes = collectPanes(mainNode);
      expect(panes).toHaveLength(3);
      panes.forEach((pane) => {
        expect(pane.rectangle).toBeDefined();
      });
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.stackPanes).toHaveLength(0);
      expect(newWorkspace.focusedPaneId).toBe('pane-1');
    });

    it('should focus sibling when closing inside a split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const workspace = createWorkspaceWithPanes(1, mainPane, [], {
        focusedPaneId: mainPane.id,
      });
      let state = createInitialState({
        workspaces: { 1: workspace },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.focusedPaneId).toBe('pane-2');
    });

    it('should clear workspace when closing only pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE' });

      // Workspace should be removed from object
      expect(newState.workspaces[1]).toBeUndefined();
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

      // Active index should be adjusted
      expect(newWorkspace.activeStackIndex).toBe(1);
      expect(newWorkspace.focusedPaneId).toBe('pane-4');
    });

    it('should return same state when pane not found', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-1' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.mainPane!.id).toBe('pane-2');
      expect(newWorkspace.stackPanes).toHaveLength(0);
    });

    it('should close pane in a non-active workspace', () => {
      const workspace1 = createWorkspaceWithPanes(1, { id: 'pane-1' });
      const workspace2 = createWorkspaceWithPanes(2, { id: 'pane-2' }, [{ id: 'pane-3' }], {
        focusedPaneId: 'pane-3',
        activeStackIndex: 0,
      });
      const state = createInitialState({
        workspaces: { 1: workspace1, 2: workspace2 },
        activeWorkspaceId: 1,
      });

      const newState = layoutReducer(state, { type: 'CLOSE_PANE_BY_ID', paneId: 'pane-3' });
      const updatedWorkspace2 = newState.workspaces[2]!;

      expect(updatedWorkspace2.stackPanes).toHaveLength(0);
      expect(updatedWorkspace2.focusedPaneId).toBe('pane-2');
    });
  });

  describe('SET_PANE_PTY action', () => {
    it('should set ptyId on main pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const workspace = createWorkspaceWithPanes(1, mainPane);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-1',
        ptyId: 'pty-123',
      });

      expect(newState.workspaces[1]!.mainPane!.ptyId).toBe('pty-123');
    });

    it('should set ptyId on stack pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-456',
      });

      expect(newState.workspaces[1]!.stackPanes[0]!.ptyId).toBe('pty-456');
    });

    it('should not modify other panes', () => {
      const mainPane: PaneData = { id: 'pane-1', ptyId: 'pty-original' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-new',
      });

      expect(newState.workspaces[1]!.mainPane!.ptyId).toBe('pty-original');
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState).toBe(state);
    });

    it('should return same state when no main pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'SWAP_MAIN' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

  describe('MOVE_PANE action', () => {
    it('should swap within main split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [], { focusedPaneId: mainPane.id }),
        },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'vertical' });
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'west' });
      const mainNode = moved.workspaces[1]!.mainPane!;

      expect(isSplitNode(mainNode)).toBe(true);
      const split = mainNode as SplitNode;
      expect((split.first as PaneData).id).toBe('pane-2');
      expect((split.second as PaneData).id).toBe('pane-1');
      expect(moved.workspaces[1]!.focusedPaneId).toBe('pane-2');
    });

    it('should swap within stack split tree', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPane: PaneData = { id: generatePaneId() };
      let state = createInitialState({
        workspaces: {
          1: createWorkspaceWithPanes(1, mainPane, [stackPane], {
            focusedPaneId: stackPane.id,
            activeStackIndex: 0,
          }),
        },
      });

      state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });
      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'north' });
      const stackNode = moved.workspaces[1]!.stackPanes[0]!;

      expect(isSplitNode(stackNode)).toBe(true);
      const split = stackNode as SplitNode;
      expect((split.first as PaneData).id).toBe('pane-3');
      expect((split.second as PaneData).id).toBe('pane-2');
      expect(moved.workspaces[1]!.focusedPaneId).toBe('pane-3');
    });

    it('should reorder stack entries when no sibling in direction', () => {
      const mainPane: PaneData = { id: generatePaneId() };
      const stackPanes: PaneData[] = [
        { id: generatePaneId() },
        { id: generatePaneId() },
      ];
      const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
        focusedPaneId: stackPanes[1]!.id,
        activeStackIndex: 1,
      });
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const moved = layoutReducer(state, { type: 'MOVE_PANE', direction: 'north' });
      const newWorkspace = moved.workspaces[1]!;

      expect((newWorkspace.stackPanes[0] as PaneData).id).toBe(stackPanes[1]!.id);
      expect((newWorkspace.stackPanes[1] as PaneData).id).toBe(stackPanes[0]!.id);
      expect(newWorkspace.activeStackIndex).toBe(0);
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      const newWorkspace = newState.workspaces[1]!;

      expect(newWorkspace.zoomed).toBe(false);
      // Should recalculate normal layout
      expect(newWorkspace.stackPanes[0]!.rectangle).toBeDefined();
    });

    it('should return same state when no focused pane', () => {
      const workspace = createWorkspace(1, 'vertical');
      const state = createInitialState({
        workspaces: { 1: workspace },
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'TOGGLE_ZOOM' });
      expect(newState.layoutVersion).toBe(1);
    });
  });

});
