/**
 * Navigation operation - vim-style hjkl navigation between panes
 */

import type { BSPNode, PaneNode, NodeId, Direction, Rectangle } from '../types';
import { isPane, getAllPanes } from '../bsp-tree';

interface PaneWithBounds {
  id: NodeId;
  bounds: Rectangle;
}

/**
 * Get all panes with their computed bounds
 */
function getAllPanesWithBounds(
  node: BSPNode | null,
  defaultBounds: Rectangle = { x: 0, y: 0, width: 100, height: 100 }
): PaneWithBounds[] {
  if (!node) return [];

  if (isPane(node)) {
    return [{
      id: node.id,
      bounds: node.rectangle ?? defaultBounds,
    }];
  }

  // For split nodes, get bounds from children
  return [
    ...getAllPanesWithBounds(node.first, defaultBounds),
    ...getAllPanesWithBounds(node.second, defaultBounds),
  ];
}

/**
 * Check if two rectangles overlap vertically
 */
function overlapsVertically(a: Rectangle, b: Rectangle): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Check if two rectangles overlap horizontally
 */
function overlapsHorizontally(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

/**
 * Calculate distance between rectangles in a direction
 */
function distance(a: Rectangle, b: Rectangle, direction: Direction): number {
  switch (direction) {
    case 'west':
      return b.x - (a.x + a.width);
    case 'east':
      return a.x - (b.x + b.width);
    case 'north':
      return b.y - (a.y + a.height);
    case 'south':
      return a.y - (b.y + b.height);
  }
}

/**
 * Find adjacent pane in the given direction
 *
 * @param root - Tree root with computed rectangles
 * @param currentPaneId - ID of the currently focused pane
 * @param direction - Direction to navigate (north/south/east/west)
 * @returns ID of the adjacent pane, or null if none found
 */
export function findAdjacentPane(
  root: BSPNode | null,
  currentPaneId: NodeId,
  direction: Direction
): NodeId | null {
  if (!root) return null;

  const panes = getAllPanesWithBounds(root);
  const currentPane = panes.find(p => p.id === currentPaneId);

  if (!currentPane) return null;

  // Find panes in the target direction
  const candidates = panes.filter(p => {
    if (p.id === currentPaneId) return false;

    switch (direction) {
      case 'west':
        return (
          p.bounds.x + p.bounds.width <= currentPane.bounds.x &&
          overlapsVertically(p.bounds, currentPane.bounds)
        );
      case 'east':
        return (
          p.bounds.x >= currentPane.bounds.x + currentPane.bounds.width &&
          overlapsVertically(p.bounds, currentPane.bounds)
        );
      case 'north':
        return (
          p.bounds.y + p.bounds.height <= currentPane.bounds.y &&
          overlapsHorizontally(p.bounds, currentPane.bounds)
        );
      case 'south':
        return (
          p.bounds.y >= currentPane.bounds.y + currentPane.bounds.height &&
          overlapsHorizontally(p.bounds, currentPane.bounds)
        );
    }
  });

  if (candidates.length === 0) return null;

  // Return the closest candidate
  candidates.sort((a, b) => {
    const distA = Math.abs(distance(a.bounds, currentPane.bounds, direction));
    const distB = Math.abs(distance(b.bounds, currentPane.bounds, direction));
    return distA - distB;
  });

  return candidates[0].id;
}

/**
 * Navigate from current pane in a direction
 *
 * @param root - Tree root
 * @param currentPaneId - Current focused pane ID
 * @param direction - Direction to navigate
 * @returns New focused pane ID (current if no neighbor found)
 */
export function navigate(
  root: BSPNode | null,
  currentPaneId: NodeId | null,
  direction: Direction
): NodeId | null {
  if (!root || !currentPaneId) {
    // If no current focus, focus the first pane
    const panes = getAllPanes(root);
    return panes.length > 0 ? panes[0].id : null;
  }

  const adjacentId = findAdjacentPane(root, currentPaneId, direction);
  return adjacentId ?? currentPaneId;
}

/**
 * Focus the next pane in order
 */
export function focusNext(
  root: BSPNode | null,
  currentPaneId: NodeId | null
): NodeId | null {
  const panes = getAllPanes(root);
  if (panes.length === 0) return null;
  if (!currentPaneId) return panes[0].id;

  const currentIndex = panes.findIndex(p => p.id === currentPaneId);
  const nextIndex = (currentIndex + 1) % panes.length;
  return panes[nextIndex].id;
}

/**
 * Focus the previous pane in order
 */
export function focusPrevious(
  root: BSPNode | null,
  currentPaneId: NodeId | null
): NodeId | null {
  const panes = getAllPanes(root);
  if (panes.length === 0) return null;
  if (!currentPaneId) return panes[panes.length - 1].id;

  const currentIndex = panes.findIndex(p => p.id === currentPaneId);
  const prevIndex = (currentIndex - 1 + panes.length) % panes.length;
  return panes[prevIndex].id;
}

/**
 * Focus a specific pane by index (1-indexed for user display)
 */
export function focusByIndex(
  root: BSPNode | null,
  index: number
): NodeId | null {
  const panes = getAllPanes(root);
  // Convert to 0-indexed
  const idx = index - 1;
  if (idx >= 0 && idx < panes.length) {
    return panes[idx].id;
  }
  return null;
}
