/**
 * Master-stack layout calculation (Zellij-style)
 *
 * Layout modes:
 * - vertical: main pane left (50%), stack panes split vertically on right
 * - horizontal: main pane top (50%), stack panes split horizontally on bottom
 * - stacked: main pane left (50%), stack panes tabbed on right (only active visible)
 */

import type { Rectangle, Workspace, PaneData, LayoutMode } from '../types';
import type { LayoutConfig } from '../config';

/**
 * Check if two rectangles are equal (structural equality)
 * Used to avoid creating new pane objects when rectangle hasn't changed
 */
function rectanglesEqual(a: Rectangle | undefined, b: Rectangle | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Update pane rectangle only if it changed (structural sharing)
 * Returns the same pane reference if rectangle is unchanged
 */
function updatePaneRectangle(pane: PaneData, newRect: Rectangle | undefined): PaneData {
  if (rectanglesEqual(pane.rectangle, newRect)) {
    return pane; // No change - reuse existing object
  }
  return { ...pane, rectangle: newRect ? { ...newRect } : undefined };
}

/**
 * Calculate rectangles for all panes in a workspace
 */
export function calculateMasterStackLayout(
  workspace: Workspace,
  viewport: Rectangle,
  config: LayoutConfig
): Workspace {
  const { mainPane, stackPanes, layoutMode, zoomed, focusedPaneId } = workspace;
  const padding = config.outerPadding;
  const paddedViewport: Rectangle = {
    x: viewport.x + padding.left,
    y: viewport.y + padding.top,
    width: Math.max(1, viewport.width - padding.left - padding.right),
    height: Math.max(1, viewport.height - padding.top - padding.bottom),
  };

  // No panes - nothing to calculate
  if (!mainPane) {
    return workspace;
  }

  // Zoomed mode - focused pane takes full viewport
  if (zoomed && focusedPaneId) {
    const focusedIsMain = mainPane.id === focusedPaneId;
    const focusedStackIndex = stackPanes.findIndex(p => p.id === focusedPaneId);

    if (focusedIsMain) {
      const updatedMain = updatePaneRectangle(mainPane, paddedViewport);
      const updatedStack = stackPanes.map(p => updatePaneRectangle(p, undefined));
      // Only create new workspace if something changed
      if (updatedMain === mainPane && updatedStack.every((p, i) => p === stackPanes[i])) {
        return workspace;
      }
      return { ...workspace, mainPane: updatedMain, stackPanes: updatedStack };
    } else if (focusedStackIndex >= 0) {
      const updatedMain = updatePaneRectangle(mainPane, undefined);
      const updatedStack = stackPanes.map((p, i) =>
        updatePaneRectangle(p, i === focusedStackIndex ? paddedViewport : undefined)
      );
      if (updatedMain === mainPane && updatedStack.every((p, i) => p === stackPanes[i])) {
        return workspace;
      }
      return { ...workspace, mainPane: updatedMain, stackPanes: updatedStack };
    }
  }

  // Single pane - takes full viewport
  if (stackPanes.length === 0) {
    const updatedMain = updatePaneRectangle(mainPane, paddedViewport);
    if (updatedMain === mainPane) return workspace;
    return { ...workspace, mainPane: updatedMain };
  }

  // Multiple panes - split based on layout mode
  const gap = config.windowGap;
  const mainRatio = config.defaultSplitRatio;

  let mainRect: Rectangle;
  let stackArea: Rectangle;

  if (layoutMode === 'vertical' || layoutMode === 'stacked') {
    // Main on left, stack on right
    const mainWidth = Math.floor((paddedViewport.width - gap) * mainRatio);
    const stackWidth = paddedViewport.width - mainWidth - gap;

    mainRect = {
      x: paddedViewport.x,
      y: paddedViewport.y,
      width: mainWidth,
      height: paddedViewport.height,
    };

    stackArea = {
      x: paddedViewport.x + mainWidth + gap,
      y: paddedViewport.y,
      width: stackWidth,
      height: paddedViewport.height,
    };
  } else {
    // Horizontal: main on top, stack on bottom
    const mainHeight = Math.floor((paddedViewport.height - gap) * mainRatio);
    const stackHeight = paddedViewport.height - mainHeight - gap;

    mainRect = {
      x: paddedViewport.x,
      y: paddedViewport.y,
      width: paddedViewport.width,
      height: mainHeight,
    };

    stackArea = {
      x: paddedViewport.x,
      y: paddedViewport.y + mainHeight + gap,
      width: paddedViewport.width,
      height: stackHeight,
    };
  }

  // Calculate stack pane rectangles with structural sharing
  const updatedStackPanes = calculateStackPaneRectangles(
    stackPanes,
    stackArea,
    layoutMode,
    workspace.activeStackIndex,
    gap
  );

  // Update main pane with structural sharing
  const updatedMain = updatePaneRectangle(mainPane, mainRect);

  // Only create new workspace if something changed
  const stackChanged = updatedStackPanes.some((p, i) => p !== stackPanes[i]);
  if (updatedMain === mainPane && !stackChanged) {
    return workspace;
  }

  return {
    ...workspace,
    mainPane: updatedMain,
    stackPanes: stackChanged ? updatedStackPanes : stackPanes,
  };
}

/**
 * Calculate rectangles for stack panes (with structural sharing)
 */
function calculateStackPaneRectangles(
  stackPanes: PaneData[],
  stackArea: Rectangle,
  layoutMode: LayoutMode,
  activeStackIndex: number,
  gap: number
): PaneData[] {
  if (stackPanes.length === 0) return stackPanes;

  if (layoutMode === 'stacked') {
    // All panes take full stack area minus 1 row for tab bar (only active one is visible)
    // Tab bar occupies the first row of stackArea, pane content starts at y+1
    const stackedRect: Rectangle = {
      x: stackArea.x,
      y: stackArea.y + 1,
      width: stackArea.width,
      height: Math.max(1, stackArea.height - 1),
    };
    return stackPanes.map((pane) => updatePaneRectangle(pane, stackedRect));
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

      const rect: Rectangle = {
        x: stackArea.x,
        y: stackArea.y + (paneHeight + gap) * index,
        width: stackArea.width,
        height,
      };
      return updatePaneRectangle(pane, rect);
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

    const rect: Rectangle = {
      x: stackArea.x + (paneWidth + gap) * index,
      y: stackArea.y,
      width,
      height: stackArea.height,
    };
    return updatePaneRectangle(pane, rect);
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
