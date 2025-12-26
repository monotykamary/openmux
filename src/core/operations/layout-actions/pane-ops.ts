/**
 * Pane operations action handlers
 * SET_LAYOUT_MODE, SET_PANE_PTY, SET_PANE_TITLE, SWAP_MAIN, MOVE_PANE, TOGGLE_ZOOM
 */

import type { Direction, LayoutMode, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { containsPane, swapPaneInDirection, updatePaneInNode } from '../../layout-tree';

/**
 * Handle SET_LAYOUT_MODE action
 * Changes the layout mode and recalculates layout
 */
export function handleSetLayoutMode(state: LayoutState, mode: LayoutMode): LayoutState {
  const workspace = getActiveWorkspace(state);
  let updated: Workspace = { ...workspace, layoutMode: mode };
  if (updated.mainPane) {
    updated = recalculateLayout(updated, state.viewport, state.config);
  }
  return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
}

/**
 * Handle SET_PANE_PTY action
 * Associates a PTY with a pane
 */
export function handleSetPanePty(state: LayoutState, paneId: string, ptyId: string): LayoutState {
  const workspace = getActiveWorkspace(state);

  let updated: Workspace = workspace;

  if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
    updated = {
      ...workspace,
      mainPane: updatePaneInNode(workspace.mainPane, paneId, pane => ({ ...pane, ptyId })),
    };
  } else {
    updated = {
      ...workspace,
      stackPanes: workspace.stackPanes.map((pane) =>
        containsPane(pane, paneId)
          ? updatePaneInNode(pane, paneId, target => ({ ...target, ptyId }))
          : pane
      ),
    };
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}

/**
 * Handle SET_PANE_TITLE action
 * Updates the title of a pane
 */
export function handleSetPaneTitle(state: LayoutState, paneId: string, title: string): LayoutState {
  const workspace = getActiveWorkspace(state);

  let updated: Workspace = workspace;

  if (workspace.mainPane && containsPane(workspace.mainPane, paneId)) {
    updated = {
      ...workspace,
      mainPane: updatePaneInNode(workspace.mainPane, paneId, pane => ({ ...pane, title })),
    };
  } else {
    updated = {
      ...workspace,
      stackPanes: workspace.stackPanes.map((pane) =>
        containsPane(pane, paneId)
          ? updatePaneInNode(pane, paneId, target => ({ ...target, title }))
          : pane
      ),
    };
  }

  return { ...state, workspaces: updateWorkspace(state, updated) };
}

/**
 * Handle SWAP_MAIN action
 * Swaps the focused stack pane with main pane
 */
export function handleSwapMain(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;
  if (containsPane(workspace.mainPane, workspace.focusedPaneId)) return state;

  const focusedStackIndex = workspace.stackPanes.findIndex(
    p => containsPane(p, workspace.focusedPaneId!)
  );
  if (focusedStackIndex === -1) return state;

  const focusedPane = workspace.stackPanes[focusedStackIndex]!;
  const newStack = [...workspace.stackPanes];
  newStack[focusedStackIndex] = workspace.mainPane;

  let updated: Workspace = {
    ...workspace,
    mainPane: focusedPane,
    stackPanes: newStack,
  };

  updated = recalculateLayout(updated, state.viewport, state.config);
  return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
}

/**
 * Handle MOVE_PANE action
 * Moves the focused pane within the stack or swaps between main/stack
 */
export function handleMovePane(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;

  const focusedId = workspace.focusedPaneId;
  const isMain = containsPane(workspace.mainPane, focusedId);
  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, focusedId));
  const stackCount = workspace.stackPanes.length;
  const focusedRoot = stackIndex >= 0 ? workspace.stackPanes[stackIndex]! : workspace.mainPane;

  if (focusedRoot) {
    const result = swapPaneInDirection(focusedRoot, focusedId, direction);
    if (result.swapped) {
      let updated: Workspace;
      if (stackIndex >= 0) {
        const newStack = workspace.stackPanes.map((pane, index) =>
          index === stackIndex ? result.node : pane
        );
        updated = {
          ...workspace,
          stackPanes: newStack,
          activeStackIndex: stackIndex >= 0 ? stackIndex : workspace.activeStackIndex,
        };
      } else {
        updated = {
          ...workspace,
          mainPane: result.node,
        };
      }

      updated = recalculateLayout(updated, state.viewport, state.config);
      return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
    }
  }

  if ((direction === 'north' || direction === 'south') && stackIndex === -1) {
    return state;
  }

  if (direction === 'north' || direction === 'south') {
    const delta = direction === 'north' ? -1 : 1;
    const targetIndex = stackIndex + delta;
    if (targetIndex < 0 || targetIndex >= stackCount) return state;

    const newStack = [...workspace.stackPanes];
    const temp = newStack[stackIndex];
    newStack[stackIndex] = newStack[targetIndex]!;
    newStack[targetIndex] = temp!;

    let updated: Workspace = {
      ...workspace,
      stackPanes: newStack,
      activeStackIndex: targetIndex,
    };

    updated = recalculateLayout(updated, state.viewport, state.config);
    return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
  }

  if (direction === 'west' || direction === 'east') {
    if (stackCount === 0) return state;

    if (isMain) {
      if (direction === 'west') return state;
      const targetIndex = Math.min(
        Math.max(workspace.activeStackIndex, 0),
        stackCount - 1
      );
      const newStack = [...workspace.stackPanes];
      const newMain = newStack[targetIndex]!;
      newStack[targetIndex] = workspace.mainPane;

      let updated: Workspace = {
        ...workspace,
        mainPane: newMain,
        stackPanes: newStack,
        activeStackIndex: targetIndex,
      };

      updated = recalculateLayout(updated, state.viewport, state.config);
      return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
    }

    if (stackIndex === -1) return state;
    if (direction === 'east') return state;

    const newStack = [...workspace.stackPanes];
    const focusedPane = newStack[stackIndex]!;
    newStack[stackIndex] = workspace.mainPane;

    let updated: Workspace = {
      ...workspace,
      mainPane: focusedPane,
      stackPanes: newStack,
    };

    updated = recalculateLayout(updated, state.viewport, state.config);
    return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
  }

  return state;
}

/**
 * Handle TOGGLE_ZOOM action
 * Toggles zoom on the focused pane
 */
export function handleToggleZoom(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.focusedPaneId) return state;

  let updated: Workspace = {
    ...workspace,
    zoomed: !workspace.zoomed,
  };

  updated = recalculateLayout(updated, state.viewport, state.config);
  return { ...state, workspaces: updateWorkspace(state, updated), layoutVersion: state.layoutVersion + 1 };
}
