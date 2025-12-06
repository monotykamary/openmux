/**
 * Resize operation - adjusts split ratios based on directional input
 */

import type { BSPNode, SplitNode, NodeId, Direction, SplitDirection } from '../types';
import { isPane, containsPane } from '../bsp-tree';
import type { BSPConfig } from '../config';

/**
 * Find the fence (split) that controls resizing in the given direction
 */
function findFence(
  root: BSPNode,
  paneId: NodeId,
  direction: Direction
): { fence: SplitNode; paneInFirst: boolean } | null {
  const isHorizontalDirection = direction === 'north' || direction === 'south';
  const needsVerticalSplit = isHorizontalDirection;

  function search(
    node: BSPNode,
    path: Array<{ split: SplitNode; isFirst: boolean }>
  ): { fence: SplitNode; paneInFirst: boolean } | null {
    if (isPane(node)) {
      if (node.id === paneId) {
        // Walk back through the path to find a suitable split
        for (let i = path.length - 1; i >= 0; i--) {
          const { split, isFirst } = path[i];
          const splitIsVertical = split.direction === 'vertical';

          if (splitIsVertical === needsVerticalSplit) {
            // Check if this split can be resized in the desired direction
            const canResize =
              (direction === 'south' && isFirst) ||
              (direction === 'north' && !isFirst) ||
              (direction === 'east' && isFirst) ||
              (direction === 'west' && !isFirst);

            if (canResize) {
              return { fence: split, paneInFirst: isFirst };
            }
          }
        }
        return null;
      }
      return null;
    }

    // Check first child
    const resultFirst = search(node.first, [
      ...path,
      { split: node, isFirst: true },
    ]);
    if (resultFirst) return resultFirst;

    // Check second child
    return search(node.second, [
      ...path,
      { split: node, isFirst: false },
    ]);
  }

  return search(root, []);
}

/**
 * Resize a pane by adjusting the relevant split ratio
 *
 * @param root - Current tree root
 * @param paneId - ID of the pane to resize
 * @param direction - Direction to grow (north/south/east/west)
 * @param delta - Amount to resize (positive = grow, negative = shrink)
 * @param config - BSP configuration for constraints
 * @returns New tree with adjusted ratios
 */
export function resizePane(
  root: BSPNode | null,
  paneId: NodeId,
  direction: Direction,
  delta: number,
  config: BSPConfig
): BSPNode | null {
  if (!root || isPane(root)) {
    return root;
  }

  const fenceInfo = findFence(root, paneId, direction);
  if (!fenceInfo) {
    return root; // Can't resize in this direction
  }

  const { fence, paneInFirst } = fenceInfo;

  // Calculate new ratio
  // Growing north/west means decreasing ratio (first child smaller)
  // Growing south/east means increasing ratio (first child larger)
  const growFirst =
    (direction === 'south' && paneInFirst) ||
    (direction === 'east' && paneInFirst) ||
    (direction === 'north' && !paneInFirst) ||
    (direction === 'west' && !paneInFirst);

  const ratioDelta = growFirst ? delta : -delta;

  // Apply the new ratio with constraints
  function updateSplit(node: BSPNode): BSPNode {
    if (isPane(node)) return node;

    if (node.id === fence.id) {
      let newRatio = node.ratio + ratioDelta;
      // Clamp to reasonable bounds
      newRatio = Math.max(0.1, Math.min(0.9, newRatio));
      return {
        ...node,
        ratio: newRatio,
        first: updateSplit(node.first),
        second: updateSplit(node.second),
      };
    }

    return {
      ...node,
      first: updateSplit(node.first),
      second: updateSplit(node.second),
    };
  }

  return updateSplit(root);
}

/**
 * Convert resize axis to directions
 */
export function axisToDirections(axis: 'horizontal' | 'vertical'): [Direction, Direction] {
  return axis === 'horizontal' ? ['west', 'east'] : ['north', 'south'];
}

/**
 * Resize in a specific axis
 */
export function resizeInAxis(
  root: BSPNode | null,
  paneId: NodeId,
  axis: 'horizontal' | 'vertical',
  delta: number,
  config: BSPConfig
): BSPNode | null {
  const [negativeDir, positiveDir] = axisToDirections(axis);
  const direction = delta > 0 ? positiveDir : negativeDir;
  return resizePane(root, paneId, direction, Math.abs(delta), config);
}
