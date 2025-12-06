/**
 * Insert pane operation - splits an existing pane to add a new one
 */

import type { BSPNode, SplitDirection, NodeId, LayoutMode } from '../types';
import { isPane, createPane, createSplit, generatePaneId } from '../bsp-tree';

/**
 * Convert layout mode to split direction
 * - 'vertical' layout means panes are side by side (horizontal split)
 * - 'horizontal' layout means panes are stacked top/bottom (vertical split)
 * - 'stacked' layout means overlapping (no split, handled separately)
 */
function layoutModeToSplitDirection(mode: LayoutMode): SplitDirection {
  // Note: The naming is a bit confusing:
  // - 'vertical' layout = panes arranged vertically (side by side) = horizontal split
  // - 'horizontal' layout = panes arranged horizontally (top/bottom) = vertical split
  return mode === 'vertical' ? 'horizontal' : 'vertical';
}

/**
 * Insert a new pane by splitting the target pane
 *
 * @param root - Current tree root
 * @param targetPaneId - ID of the pane to split
 * @param layoutMode - Layout mode determines split direction
 * @param newPaneId - Optional ID for the new pane
 * @param ratio - Split ratio (0-1, default 0.5)
 * @returns Object with new root and new pane ID
 */
export function insertPane(
  root: BSPNode | null,
  targetPaneId: NodeId,
  options: {
    layoutMode: LayoutMode;
    newPaneId?: NodeId;
    ratio?: number;
    ptyId?: string;
    title?: string;
  }
): { root: BSPNode; newPaneId: NodeId } {
  const {
    layoutMode,
    newPaneId = generatePaneId(),
    ratio = 0.5,
    ptyId,
    title,
  } = options;

  // If no root, create the first pane
  if (!root) {
    const newPane = createPane(newPaneId, { ptyId, title });
    return { root: newPane, newPaneId };
  }

  // For stacked mode, we don't split - handled separately
  if (layoutMode === 'stacked') {
    // In stacked mode, panes overlap - just create and return
    // The rendering layer will handle showing only the focused pane
    const newPane = createPane(newPaneId, { ptyId, title });
    return { root: newPane, newPaneId };
  }

  const splitDir = layoutModeToSplitDirection(layoutMode);

  // Helper to recursively find and split the target
  function splitNode(node: BSPNode): BSPNode {
    if (isPane(node)) {
      if (node.id === targetPaneId) {
        // Found the target pane - create a split
        const newPane = createPane(newPaneId, { ptyId, title });
        // New pane always goes second (right/bottom)
        return createSplit(node, newPane, splitDir, ratio);
      }
      return node;
    }

    // Recurse into children
    return {
      ...node,
      first: splitNode(node.first),
      second: splitNode(node.second),
    };
  }

  const newRoot = splitNode(root);
  return { root: newRoot, newPaneId };
}

/**
 * Create the first pane in an empty tree
 */
export function createFirstPane(
  options: {
    paneId?: NodeId;
    ptyId?: string;
    title?: string;
  } = {}
): BSPNode {
  const { paneId = generatePaneId(), ptyId, title = 'shell' } = options;
  return createPane(paneId, { ptyId, title });
}
