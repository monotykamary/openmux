/**
 * Layout calculation - computes positions for all panes with gaps
 */

import type { BSPNode, Rectangle, Padding } from '../types';
import { isPane } from '../bsp-tree';
import type { BSPConfig } from '../config';

/**
 * Calculate layout for all nodes in the tree
 *
 * Algorithm:
 * 1. Start with viewport minus outer padding
 * 2. Recursively apply split ratios
 * 3. Subtract gaps between panes
 * 4. Ensure minimum constraints are met
 *
 * @param root - Tree root
 * @param viewport - Available terminal area
 * @param config - BSP configuration
 * @returns New tree with computed rectangles
 */
export function calculateLayout(
  root: BSPNode | null,
  viewport: Rectangle,
  config: BSPConfig
): BSPNode | null {
  if (!root) return null;

  // Apply outer padding to viewport
  const contentArea: Rectangle = {
    x: viewport.x + config.outerPadding.left,
    y: viewport.y + config.outerPadding.top,
    width: viewport.width - config.outerPadding.left - config.outerPadding.right,
    height: viewport.height - config.outerPadding.top - config.outerPadding.bottom,
  };

  return applyLayout(root, contentArea, config);
}

function applyLayout(
  node: BSPNode,
  rect: Rectangle,
  config: BSPConfig
): BSPNode {
  if (isPane(node)) {
    // Leaf node gets the full rectangle
    return { ...node, rectangle: { ...rect } };
  }

  // Internal node: split the rectangle
  const { first, second, direction, ratio } = node;

  let firstRect: Rectangle;
  let secondRect: Rectangle;

  const gap = config.windowGap;

  if (direction === 'horizontal') {
    // Horizontal split: left | right
    // Available width for panes = total - gap
    const availableWidth = rect.width - gap;
    const firstWidth = Math.max(
      Math.floor(availableWidth * ratio),
      config.minPaneWidth
    );
    const secondWidth = Math.max(
      availableWidth - firstWidth,
      config.minPaneWidth
    );

    firstRect = {
      x: rect.x,
      y: rect.y,
      width: firstWidth,
      height: rect.height,
    };

    secondRect = {
      x: rect.x + firstWidth + gap,
      y: rect.y,
      width: secondWidth,
      height: rect.height,
    };
  } else {
    // Vertical split: top / bottom
    // Available height for panes = total - gap
    const availableHeight = rect.height - gap;
    const firstHeight = Math.max(
      Math.floor(availableHeight * ratio),
      config.minPaneHeight
    );
    const secondHeight = Math.max(
      availableHeight - firstHeight,
      config.minPaneHeight
    );

    firstRect = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: firstHeight,
    };

    secondRect = {
      x: rect.x,
      y: rect.y + firstHeight + gap,
      width: rect.width,
      height: secondHeight,
    };
  }

  return {
    ...node,
    rectangle: { ...rect },
    first: applyLayout(first, firstRect, config),
    second: applyLayout(second, secondRect, config),
  };
}

/**
 * Get the content rectangle (inside border) for a pane
 */
export function getContentRect(
  paneRect: Rectangle,
  borderWidth: number
): Rectangle {
  return {
    x: paneRect.x + borderWidth,
    y: paneRect.y + borderWidth,
    width: Math.max(1, paneRect.width - borderWidth * 2),
    height: Math.max(1, paneRect.height - borderWidth * 2),
  };
}

/**
 * Calculate terminal dimensions for a pane (cols x rows)
 */
export function getTerminalDimensions(
  paneRect: Rectangle,
  borderWidth: number
): { cols: number; rows: number } {
  const content = getContentRect(paneRect, borderWidth);
  return {
    cols: Math.max(1, content.width),
    rows: Math.max(1, content.height),
  };
}

/**
 * Get all pane rectangles as a flat map
 */
export function getPaneRectangles(
  node: BSPNode | null
): Map<string, Rectangle> {
  const map = new Map<string, Rectangle>();

  function traverse(n: BSPNode): void {
    if (isPane(n)) {
      if (n.rectangle) {
        map.set(n.id, n.rectangle);
      }
    } else {
      traverse(n.first);
      traverse(n.second);
    }
  }

  if (node) traverse(node);
  return map;
}
