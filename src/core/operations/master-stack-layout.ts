/**
 * Master-stack layout calculation (Zellij-style)
 *
 * Layout modes:
 * - vertical: main pane left (50%), stack panes split vertically on right
 * - horizontal: main pane top (50%), stack panes split horizontally on bottom
 * - stacked: main pane left (50%), stack panes tabbed on right (only active visible)
 */

import type { Rectangle, Workspace, PaneData, LayoutMode } from '../types';
import type { BSPConfig } from '../config';

/**
 * Calculate rectangles for all panes in a workspace
 */
export function calculateMasterStackLayout(
  workspace: Workspace,
  viewport: Rectangle,
  config: BSPConfig
): Workspace {
  const { mainPane, stackPanes, layoutMode } = workspace;

  // No panes - nothing to calculate
  if (!mainPane) {
    return workspace;
  }

  // Single pane - takes full viewport
  if (stackPanes.length === 0) {
    return {
      ...workspace,
      mainPane: {
        ...mainPane,
        rectangle: { ...viewport },
      },
    };
  }

  // Multiple panes - split based on layout mode
  const gap = config.windowGap;
  const mainRatio = config.defaultSplitRatio;

  let mainRect: Rectangle;
  let stackArea: Rectangle;

  if (layoutMode === 'vertical' || layoutMode === 'stacked') {
    // Main on left, stack on right
    const mainWidth = Math.floor((viewport.width - gap) * mainRatio);
    const stackWidth = viewport.width - mainWidth - gap;

    mainRect = {
      x: viewport.x,
      y: viewport.y,
      width: mainWidth,
      height: viewport.height,
    };

    stackArea = {
      x: viewport.x + mainWidth + gap,
      y: viewport.y,
      width: stackWidth,
      height: viewport.height,
    };
  } else {
    // Horizontal: main on top, stack on bottom
    const mainHeight = Math.floor((viewport.height - gap) * mainRatio);
    const stackHeight = viewport.height - mainHeight - gap;

    mainRect = {
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: mainHeight,
    };

    stackArea = {
      x: viewport.x,
      y: viewport.y + mainHeight + gap,
      width: viewport.width,
      height: stackHeight,
    };
  }

  // Calculate stack pane rectangles
  const updatedStackPanes = calculateStackPaneRectangles(
    stackPanes,
    stackArea,
    layoutMode,
    workspace.activeStackIndex,
    gap
  );

  return {
    ...workspace,
    mainPane: { ...mainPane, rectangle: mainRect },
    stackPanes: updatedStackPanes,
  };
}

/**
 * Calculate rectangles for stack panes
 */
function calculateStackPaneRectangles(
  stackPanes: PaneData[],
  stackArea: Rectangle,
  layoutMode: LayoutMode,
  activeStackIndex: number,
  gap: number
): PaneData[] {
  if (stackPanes.length === 0) return [];

  if (layoutMode === 'stacked') {
    // All panes take full stack area (only active one is visible)
    return stackPanes.map((pane) => ({
      ...pane,
      rectangle: { ...stackArea },
    }));
  }

  if (layoutMode === 'vertical') {
    // Stack panes split vertically (equal height)
    const totalGaps = gap * (stackPanes.length - 1);
    const availableHeight = stackArea.height - totalGaps;
    const paneHeight = Math.floor(availableHeight / stackPanes.length);

    return stackPanes.map((pane, index) => {
      const isLast = index === stackPanes.length - 1;
      // Last pane gets remaining height to avoid rounding issues
      const height = isLast
        ? stackArea.height - (paneHeight + gap) * index
        : paneHeight;

      return {
        ...pane,
        rectangle: {
          x: stackArea.x,
          y: stackArea.y + (paneHeight + gap) * index,
          width: stackArea.width,
          height,
        },
      };
    });
  }

  // Horizontal: stack panes split horizontally (equal width)
  const totalGaps = gap * (stackPanes.length - 1);
  const availableWidth = stackArea.width - totalGaps;
  const paneWidth = Math.floor(availableWidth / stackPanes.length);

  return stackPanes.map((pane, index) => {
    const isLast = index === stackPanes.length - 1;
    // Last pane gets remaining width to avoid rounding issues
    const width = isLast
      ? stackArea.width - (paneWidth + gap) * index
      : paneWidth;

    return {
      ...pane,
      rectangle: {
        x: stackArea.x + (paneWidth + gap) * index,
        y: stackArea.y,
        width,
        height: stackArea.height,
      },
    };
  });
}

/**
 * Get all panes in a workspace as a flat array
 */
export function getAllWorkspacePanes(workspace: Workspace): PaneData[] {
  const panes: PaneData[] = [];
  if (workspace.mainPane) {
    panes.push(workspace.mainPane);
  }
  panes.push(...workspace.stackPanes);
  return panes;
}

/**
 * Get total pane count in a workspace
 */
export function getWorkspacePaneCount(workspace: Workspace): number {
  return (workspace.mainPane ? 1 : 0) + workspace.stackPanes.length;
}

/**
 * Find a pane by ID in a workspace
 */
export function findPaneInWorkspace(
  workspace: Workspace,
  paneId: string
): PaneData | null {
  if (workspace.mainPane?.id === paneId) {
    return workspace.mainPane;
  }
  return workspace.stackPanes.find((p) => p.id === paneId) ?? null;
}

/**
 * Get the index of a pane (main = 0, stack panes = 1+)
 */
export function getPaneIndex(workspace: Workspace, paneId: string): number {
  if (workspace.mainPane?.id === paneId) return 0;
  const stackIndex = workspace.stackPanes.findIndex((p) => p.id === paneId);
  return stackIndex >= 0 ? stackIndex + 1 : -1;
}
