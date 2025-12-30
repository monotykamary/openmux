/**
 * Helper functions for layout reducer
 */

import type { Direction, Rectangle, Workspace, WorkspaceId, LayoutMode, LayoutNode } from '../../types';
import type { LayoutConfig } from '../../config';
import type { LayoutState, Workspaces } from './types';
import { calculateMasterStackLayout } from '../master-stack-layout';
import { collectPanes, isSplitNode } from '../../layout-tree';

/**
 * Geometry helpers for layout-tree aware navigation and movement
 */
export function getOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function getCandidateScore(
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

let paneIdCounter = 0;
let splitIdCounter = 0;

/**
 * Generate a unique pane ID
 */
export function generatePaneId(): string {
  return `pane-${++paneIdCounter}`;
}

/**
 * Reset pane ID counter (for testing)
 */
export function resetPaneIdCounter(): void {
  paneIdCounter = 0;
}

/**
 * Reset split ID counter (for testing)
 */
export function resetSplitIdCounter(): void {
  splitIdCounter = 0;
}

/**
 * Sync pane ID counter with loaded panes to avoid ID conflicts
 * Called when loading a session with existing pane IDs
 */
export function syncPaneIdCounter(workspaces: Workspaces): void {
  let maxId = paneIdCounter;
  for (const workspace of Object.values(workspaces)) {
    if (!workspace) continue;
    const panes: LayoutNode[] = [];
    if (workspace.mainPane) panes.push(workspace.mainPane);
    panes.push(...workspace.stackPanes);
    for (const node of panes) {
      for (const pane of collectPanes(node)) {
        const match = pane.id.match(/^pane-(\d+)$/);
        if (match) {
          maxId = Math.max(maxId, parseInt(match[1]!, 10));
        }
      }
    }
  }
  paneIdCounter = maxId;
}

/**
 * Generate a unique split ID
 */
export function generateSplitId(): string {
  return `split-${++splitIdCounter}`;
}

/**
 * Sync split ID counter with loaded splits to avoid ID conflicts
 */
export function syncSplitIdCounter(workspaces: Workspaces): void {
  let maxId = splitIdCounter;
  const scan = (node: LayoutNode | null) => {
    if (!node) return;
    if (isSplitNode(node)) {
      const match = node.id.match(/^split-(\d+)$/);
      if (match) {
        maxId = Math.max(maxId, parseInt(match[1]!, 10));
      }
      scan(node.first);
      scan(node.second);
    }
  };

  for (const workspace of Object.values(workspaces)) {
    if (!workspace) continue;
    scan(workspace.mainPane);
    for (const pane of workspace.stackPanes) {
      scan(pane);
    }
  }

  splitIdCounter = maxId;
}

/**
 * Create a new empty workspace
 */
export function createWorkspace(id: WorkspaceId, layoutMode: LayoutMode): Workspace {
  return {
    id,
    mainPane: null,
    stackPanes: [],
    focusedPaneId: null,
    activeStackIndex: 0,
    layoutMode,
    zoomed: false,
  };
}

/**
 * Get the active workspace from state
 * Creates a new one if it doesn't exist
 */
export function getActiveWorkspace(state: LayoutState): Workspace {
  let workspace = state.workspaces[state.activeWorkspaceId];
  if (!workspace) {
    workspace = createWorkspace(state.activeWorkspaceId, state.config.defaultLayoutMode);
  }
  return workspace;
}

/**
 * Create a new workspaces object with the updated workspace
 */
export function updateWorkspace(state: LayoutState, workspace: Workspace): Workspaces {
  return {
    ...state.workspaces,
    [workspace.id]: workspace,
  };
}

/**
 * Recalculate layout for a workspace
 */
export function recalculateLayout(workspace: Workspace, viewport: Rectangle, config: LayoutConfig): Workspace {
  return calculateMasterStackLayout(workspace, viewport, config);
}
