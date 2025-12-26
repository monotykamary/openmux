/**
 * Tests for focus and navigation layout reducer actions.
 */

import { describe, it, expect } from 'vitest';
import type { PaneData } from '../../../src/core/types';
import { layoutReducer, generatePaneId } from '../../../src/core/operations/layout-actions';
import {
  createInitialState,
  createWorkspaceWithPanes,
  defaultViewport,
  setupLayoutReducerTest,
} from './fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();
  describe('FOCUS_PANE action', () => {
    it('should focus the specified pane', () => {
      const mainPane: PaneData = { id: 'pane-1' };
      const stackPane: PaneData = { id: 'pane-2' };
      const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane]);
      const state = createInitialState({
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-4' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-1' });
      const newWorkspace = newState.workspaces[1]!;

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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'FOCUS_PANE', paneId: 'pane-2' });
      const newWorkspace = newState.workspaces[1]!;

      // When zoomed, focused pane should get full viewport
      expect(newWorkspace.stackPanes[0]?.rectangle).toEqual(defaultViewport);
      expect(newWorkspace.mainPane?.rectangle).toBeUndefined();
    });
  });

  describe('NAVIGATE action', () => {
    describe('vertical layout', () => {
      it('should navigate east from main to stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-1',
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');
      });

      it('should navigate west from stack to main', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-2',
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'west' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-1');
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
          workspaces: { 1: workspace },
        });

        // Navigate north (up in stack)
        let newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');

        // Navigate south (down in stack)
        newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-4');
      });

      it('should not navigate north when at top of stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-2',
          activeStackIndex: 0,
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');
      });

      it('should not navigate south when at bottom of stack', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [{ id: 'pane-2' }, { id: 'pane-3' }];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-3',
          activeStackIndex: 1,
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-3');
      });

      it('should navigate to closest stack pane from main', () => {
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
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-3');
      });
    });

    describe('stacked layout', () => {
      it('should cycle stack panes with north/south', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPanes: PaneData[] = [
          { id: 'pane-2' },
          { id: 'pane-3' },
          { id: 'pane-4' },
        ];
        const workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: 'pane-2',
          activeStackIndex: 0,
          layoutMode: 'stacked',
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        let newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-4');
        expect(newState.workspaces[1]!.activeStackIndex).toBe(2);

        newState = layoutReducer(newState, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');
        expect(newState.workspaces[1]!.activeStackIndex).toBe(0);
      });

      it('should navigate within split tree before cycling tabs', () => {
        const mainPane: PaneData = { id: generatePaneId() };
        const stackPanes: PaneData[] = [
          { id: generatePaneId() },
          { id: generatePaneId() },
        ];
        let workspace = createWorkspaceWithPanes(1, mainPane, stackPanes, {
          focusedPaneId: stackPanes[0]!.id,
          activeStackIndex: 0,
          layoutMode: 'stacked',
        });
        let state = createInitialState({
          workspaces: { 1: workspace },
        });

        state = layoutReducer(state, { type: 'SPLIT_PANE', direction: 'horizontal' });
        const splitWorkspace = state.workspaces[1]!;
        expect(splitWorkspace.focusedPaneId).toBe('pane-4');

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe(stackPanes[0]!.id);
        expect(newState.workspaces[1]!.activeStackIndex).toBe(0);
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
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'south' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');
      });

      it('should navigate north from stack to main', () => {
        const mainPane: PaneData = { id: 'pane-1' };
        const stackPane: PaneData = { id: 'pane-2' };
        const workspace = createWorkspaceWithPanes(1, mainPane, [stackPane], {
          focusedPaneId: 'pane-2',
          layoutMode: 'horizontal',
        });
        const state = createInitialState({
          workspaces: { 1: workspace },
        });

        const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'north' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-1');
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
          workspaces: { 1: workspace },
        });

        // Navigate west
        let newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'west' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-2');

        // Navigate east
        newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
        expect(newState.workspaces[1]!.focusedPaneId).toBe('pane-4');
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
        workspaces: { 1: workspace },
      });

      const newState = layoutReducer(state, { type: 'NAVIGATE', direction: 'east' });
      expect(newState).toBe(state);
    });
  });

});
