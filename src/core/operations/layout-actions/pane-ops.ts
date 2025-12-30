/**
 * Pane operations action handlers
 * SET_LAYOUT_MODE, SET_PANE_PTY, SET_PANE_TITLE, SWAP_MAIN, MOVE_PANE, TOGGLE_ZOOM
 */

import type { Direction, LayoutMode, Rectangle, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';
import {
  containsPane,
  findPane,
  swapPaneInDirection,
  swapTwoPanesById,
  updatePaneInNode,
} from '../../layout-tree';

/**
 * Geometry helpers for layout-tree aware pane movement
 */
function getOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function getCandidateScore(
  current: Rectangle,
  candidate: Rectangle,
  direction: Direction
): number | null {
  let primaryDistance = 0;
  let secondaryDistance = 0;
  let overlap = 0;

  if (direction === 'west') {
    primaryDistance = current.x - (candidate.x + candidate.width);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height);
    secondaryDistance = Math.abs(
      current.y + current.height / 2 - (candidate.y + candidate.height / 2)
    );
  } else if (direction === 'east') {
    primaryDistance = candidate.x - (current.x + current.width);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.y, current.y + current.height, candidate.y, candidate.y + candidate.height);
    secondaryDistance = Math.abs(
      current.y + current.height / 2 - (candidate.y + candidate.height / 2)
    );
  } else if (direction === 'north') {
    primaryDistance = current.y - (candidate.y + candidate.height);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width);
    secondaryDistance = Math.abs(
      current.x + current.width / 2 - (candidate.x + candidate.width / 2)
    );
  } else {
    primaryDistance = candidate.y - (current.y + current.height);
    if (primaryDistance < 0) return null;
    overlap = getOverlap(current.x, current.x + current.width, candidate.x, candidate.x + candidate.width);
    secondaryDistance = Math.abs(
      current.x + current.width / 2 - (candidate.x + candidate.width / 2)
    );
  }

  const overlapPenalty = overlap > 0 ? 0 : 1000;
  return primaryDistance * 1000 + secondaryDistance + overlapPenalty;
}

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
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
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
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle MOVE_PANE action
 * Moves the focused pane in the given direction using layout-tree aware logic:
 * 1. First tries within-tree swap using split direction
 * 2. Falls back to geometry-based swap with nearest pane in direction
 */
export function handleMovePane(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.mainPane || !workspace.focusedPaneId) return state;

  const focusedId = workspace.focusedPaneId;
  const stackIndex = workspace.stackPanes.findIndex(p => containsPane(p, focusedId));
  const focusedRoot = stackIndex >= 0 ? workspace.stackPanes[stackIndex]! : workspace.mainPane;

  // Step 1: Try within-tree swap using split direction
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
          activeStackIndex: stackIndex,
        };
      } else {
        updated = {
          ...workspace,
          mainPane: result.node,
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
  }

  // Step 2: Geometry-based cross-tree swap
  const allPanes = getAllWorkspacePanes(workspace).filter(p => p.rectangle);
  if (allPanes.length === 0) return state;

  const currentPane = allPanes.find(p => p.id === focusedId);
  if (!currentPane?.rectangle) return state;

  // Find best target pane in the direction using geometry
  let bestPane = currentPane;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of allPanes) {
    if (pane.id === currentPane.id || !pane.rectangle) continue;
    const score = getCandidateScore(currentPane.rectangle, pane.rectangle, direction);
    if (score !== null && score < bestScore) {
      bestScore = score;
      bestPane = pane;
    }
  }

  // No valid target found
  if (bestPane.id === currentPane.id) return state;

  // Find the pane data objects for swapping
  const focusedPaneData = workspace.mainPane
    ? findPane(workspace.mainPane, focusedId) ??
      workspace.stackPanes.reduce<ReturnType<typeof findPane>>(
        (found, node) => found ?? findPane(node, focusedId),
        null
      )
    : null;

  const targetPaneData = workspace.mainPane
    ? findPane(workspace.mainPane, bestPane.id) ??
      workspace.stackPanes.reduce<ReturnType<typeof findPane>>(
        (found, node) => found ?? findPane(node, bestPane.id),
        null
      )
    : null;

  if (!focusedPaneData || !targetPaneData) return state;

  // Prepare pane data for swapping (without rectangle - will be recalculated)
  const pane1Data = { id: focusedPaneData.id, ptyId: focusedPaneData.ptyId, title: focusedPaneData.title };
  const pane2Data = { id: targetPaneData.id, ptyId: targetPaneData.ptyId, title: targetPaneData.title };

  // Swap both panes in a single pass through all trees
  // This handles both same-tree and cross-tree swaps correctly
  const newMainPane = swapTwoPanesById(workspace.mainPane, focusedId, pane1Data, bestPane.id, pane2Data);
  const newStackPanes = workspace.stackPanes.map(node =>
    swapTwoPanesById(node, focusedId, pane1Data, bestPane.id, pane2Data)
  );

  // Update activeStackIndex if target is in a different stack entry
  const targetStackIndex = workspace.stackPanes.findIndex(p => containsPane(p, bestPane.id));
  const newActiveStackIndex = targetStackIndex >= 0 ? targetStackIndex : workspace.activeStackIndex;

  let updated: Workspace = {
    ...workspace,
    mainPane: newMainPane,
    stackPanes: newStackPanes,
    activeStackIndex: newActiveStackIndex,
  };

  updated = recalculateLayout(updated, state.viewport, state.config);
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
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
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}
