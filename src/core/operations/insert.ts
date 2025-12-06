/**
 * Insert pane operation - splits an existing pane to add a new one
 */

import type { BSPNode, SplitNode, PaneNode, SplitDirection, NodeId, Direction, AutomaticScheme, Rectangle } from '../types';
import { isPane, isSplit, createPane, createSplit, generatePaneId, directionToSplitType } from '../bsp-tree';

/**
 * Determine split direction based on automatic scheme
 */
function determineSplitDirection(
  pane: PaneNode,
  scheme: AutomaticScheme,
  parentSplit?: SplitNode
): SplitDirection {
  const rect = pane.rectangle ?? { width: 80, height: 24 };

  switch (scheme) {
    case 'longest_side':
      // Split along the longest dimension
      return rect.width >= rect.height ? 'horizontal' : 'vertical';

    case 'alternate':
    case 'spiral':
      // Alternate from parent's split direction
      if (parentSplit) {
        return parentSplit.direction === 'horizontal' ? 'vertical' : 'horizontal';
      }
      return 'horizontal';

    default:
      return 'horizontal';
  }
}

/**
 * Insert a new pane by splitting the target pane
 *
 * @param root - Current tree root
 * @param targetPaneId - ID of the pane to split
 * @param direction - Optional explicit split direction
 * @param newPaneId - Optional ID for the new pane
 * @param ratio - Split ratio (0-1, default 0.5)
 * @param scheme - Automatic split scheme if direction not specified
 * @returns Object with new root and new pane ID
 */
export function insertPane(
  root: BSPNode | null,
  targetPaneId: NodeId,
  options: {
    direction?: SplitDirection | Direction;
    newPaneId?: NodeId;
    ratio?: number;
    scheme?: AutomaticScheme;
    ptyId?: string;
    title?: string;
  } = {}
): { root: BSPNode; newPaneId: NodeId } {
  const {
    direction,
    newPaneId = generatePaneId(),
    ratio = 0.5,
    scheme = 'spiral',
    ptyId,
    title,
  } = options;

  // If no root, create the first pane
  if (!root) {
    const newPane = createPane(newPaneId, { ptyId, title });
    return { root: newPane, newPaneId };
  }

  // Helper to recursively find and split the target
  function splitNode(
    node: BSPNode,
    parentSplit?: SplitNode
  ): BSPNode {
    if (isPane(node)) {
      if (node.id === targetPaneId) {
        // Found the target pane - create a split
        const newPane = createPane(newPaneId, { ptyId, title });

        // Determine split direction
        let splitDir: SplitDirection;
        if (direction) {
          // If direction is hjkl style, convert it
          if (direction === 'north' || direction === 'south' ||
              direction === 'east' || direction === 'west') {
            splitDir = directionToSplitType(direction as Direction);
          } else {
            splitDir = direction as SplitDirection;
          }
        } else {
          splitDir = determineSplitDirection(node, scheme, parentSplit);
        }

        // Determine order (new pane first or second)
        // For north/west, new pane comes first; for south/east, second
        const newFirst = direction === 'north' || direction === 'west';

        if (newFirst) {
          return createSplit(newPane, node, splitDir, ratio);
        } else {
          return createSplit(node, newPane, splitDir, ratio);
        }
      }
      return node;
    }

    // Recurse into children
    return {
      ...node,
      first: splitNode(node.first, node),
      second: splitNode(node.second, node),
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
