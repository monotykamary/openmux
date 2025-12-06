/**
 * Remove pane operation - removes a pane and promotes sibling
 */

import type { BSPNode, NodeId } from '../types';
import { isPane, getFirstPane, containsPane } from '../bsp-tree';

/**
 * Remove a pane from the tree
 *
 * Algorithm:
 * 1. If the pane is the root (only pane), return null
 * 2. Find the parent split of the pane
 * 3. Replace the parent with the sibling
 * 4. Return new root and ID of pane to focus
 *
 * @param root - Current tree root
 * @param paneId - ID of the pane to remove
 * @returns Object with new root and new focus pane ID, or null if tree is now empty
 */
export function removePane(
  root: BSPNode | null,
  paneId: NodeId
): { root: BSPNode | null; newFocusId: NodeId | null } {
  if (!root) {
    return { root: null, newFocusId: null };
  }

  // If root is a pane and it's the one to remove, tree becomes empty
  if (isPane(root)) {
    if (root.id === paneId) {
      return { root: null, newFocusId: null };
    }
    // Pane not found, return unchanged
    return { root, newFocusId: root.id };
  }

  // Check if the pane to remove is a direct child of root
  if (isPane(root.first) && root.first.id === paneId) {
    // Promote second child to root
    const newFocusId = getFirstPane(root.second).id;
    return { root: root.second, newFocusId };
  }

  if (isPane(root.second) && root.second.id === paneId) {
    // Promote first child to root
    const newFocusId = getFirstPane(root.first).id;
    return { root: root.first, newFocusId };
  }

  // Recursively find and remove from subtrees
  function removeFromNode(node: BSPNode): { node: BSPNode | null; removedFrom: 'first' | 'second' | null } {
    if (isPane(node)) {
      return { node, removedFrom: null };
    }

    // Check first child
    if (isPane(node.first) && node.first.id === paneId) {
      return { node: node.second, removedFrom: 'first' };
    }

    // Check second child
    if (isPane(node.second) && node.second.id === paneId) {
      return { node: node.first, removedFrom: 'second' };
    }

    // Check if pane is in first subtree
    if (containsPane(node.first, paneId)) {
      const result = removeFromNode(node.first);
      if (result.node === null) {
        return { node: node.second, removedFrom: 'first' };
      }
      return {
        node: { ...node, first: result.node },
        removedFrom: null,
      };
    }

    // Check if pane is in second subtree
    if (containsPane(node.second, paneId)) {
      const result = removeFromNode(node.second);
      if (result.node === null) {
        return { node: node.first, removedFrom: 'second' };
      }
      return {
        node: { ...node, second: result.node },
        removedFrom: null,
      };
    }

    // Pane not found in this subtree
    return { node, removedFrom: null };
  }

  const result = removeFromNode(root);

  if (result.node === null) {
    return { root: null, newFocusId: null };
  }

  // Find the new pane to focus (first pane in the remaining tree)
  const newFocusId = getFirstPane(result.node).id;

  return { root: result.node, newFocusId };
}

/**
 * Close the currently focused pane
 */
export function closeFocusedPane(
  root: BSPNode | null,
  focusedPaneId: NodeId | null
): { root: BSPNode | null; newFocusId: NodeId | null } {
  if (!root || !focusedPaneId) {
    return { root, newFocusId: null };
  }

  return removePane(root, focusedPaneId);
}
