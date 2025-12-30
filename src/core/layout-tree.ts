/**
 * Layout tree helpers for split panes.
 */

import type { Direction, LayoutNode, PaneData, SplitDirection, SplitNode } from './types';

export function isSplitNode(node: LayoutNode): node is SplitNode {
  return (node as SplitNode).type === 'split';
}

export function collectPanes(node: LayoutNode | null, panes: PaneData[] = []): PaneData[] {
  if (!node) return panes;
  if (!isSplitNode(node)) {
    panes.push(node);
    return panes;
  }
  collectPanes(node.first, panes);
  collectPanes(node.second, panes);
  return panes;
}

export function containsPane(node: LayoutNode | null, paneId: string): boolean {
  if (!node) return false;
  if (!isSplitNode(node)) {
    return node.id === paneId;
  }
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}

export function findPane(node: LayoutNode | null, paneId: string): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

export function updatePaneInNode(
  node: LayoutNode,
  paneId: string,
  update: (pane: PaneData) => PaneData
): LayoutNode {
  if (!isSplitNode(node)) {
    if (node.id !== paneId) return node;
    const updated = update(node);
    return updated === node ? node : updated;
  }

  const updatedFirst = updatePaneInNode(node.first, paneId, update);
  const updatedSecond = updatePaneInNode(node.second, paneId, update);
  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function replacePaneWithSplit(
  node: LayoutNode,
  paneId: string,
  newPane: PaneData,
  direction: SplitDirection,
  ratio: number,
  splitId: string
): LayoutNode {
  if (!isSplitNode(node)) {
    if (node.id !== paneId) return node;
    return {
      type: 'split',
      id: splitId,
      direction,
      ratio,
      first: node,
      second: newPane,
    };
  }

  const updatedFirst = replacePaneWithSplit(node.first, paneId, newPane, direction, ratio, splitId);
  const updatedSecond = replacePaneWithSplit(node.second, paneId, newPane, direction, ratio, splitId);
  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function removePaneFromNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (!isSplitNode(node)) {
    return node.id === paneId ? null : node;
  }

  const updatedFirst = removePaneFromNode(node.first, paneId);
  const updatedSecond = removePaneFromNode(node.second, paneId);

  if (!updatedFirst && !updatedSecond) return null;
  if (!updatedFirst) return updatedSecond;
  if (!updatedSecond) return updatedFirst;

  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}

export function getFirstPane(node: LayoutNode | null): PaneData | null {
  if (!node) return null;
  if (!isSplitNode(node)) return node;
  return getFirstPane(node.first) ?? getFirstPane(node.second);
}

export function findSiblingPane(node: LayoutNode, paneId: string): PaneData | null {
  if (!isSplitNode(node)) return null;

  const search = (current: LayoutNode): PaneData | null => {
    if (!isSplitNode(current)) return null;
    if (containsPane(current.first, paneId)) {
      return search(current.first) ?? getFirstPane(current.second);
    }
    if (containsPane(current.second, paneId)) {
      return search(current.second) ?? getFirstPane(current.first);
    }
    return null;
  };

  return search(node);
}

function getSiblingForDirection(
  split: SplitNode,
  side: 'first' | 'second',
  direction: Direction
): LayoutNode | null {
  if (split.direction === 'vertical') {
    if (direction === 'west' && side === 'second') return split.first;
    if (direction === 'east' && side === 'first') return split.second;
    return null;
  }

  if (direction === 'north' && side === 'second') return split.first;
  if (direction === 'south' && side === 'first') return split.second;
  return null;
}

export function findSiblingInDirection(
  node: LayoutNode,
  paneId: string,
  direction: Direction
): LayoutNode | null {
  if (!isSplitNode(node)) return null;

  if (containsPane(node.first, paneId)) {
    const nested = findSiblingInDirection(node.first, paneId, direction);
    if (nested) return nested;
    return getSiblingForDirection(node, 'first', direction);
  }

  if (containsPane(node.second, paneId)) {
    const nested = findSiblingInDirection(node.second, paneId, direction);
    if (nested) return nested;
    return getSiblingForDirection(node, 'second', direction);
  }

  return null;
}

export function swapPaneInDirection(
  node: LayoutNode,
  paneId: string,
  direction: Direction
): { node: LayoutNode; swapped: boolean } {
  if (!isSplitNode(node)) return { node, swapped: false };

  if (containsPane(node.first, paneId)) {
    const result = swapPaneInDirection(node.first, paneId, direction);
    if (result.swapped) {
      const nextNode = result.node === node.first ? node : { ...node, first: result.node };
      return { node: nextNode, swapped: true };
    }
    // Only swap if both siblings are simple panes (not splits)
    // Otherwise, fall through to geometry-based swap which swaps individual pane data
    if (getSiblingForDirection(node, 'first', direction) && !isSplitNode(node.first) && !isSplitNode(node.second)) {
      return { node: { ...node, first: node.second, second: node.first }, swapped: true };
    }
    return { node, swapped: false };
  }

  if (containsPane(node.second, paneId)) {
    const result = swapPaneInDirection(node.second, paneId, direction);
    if (result.swapped) {
      const nextNode = result.node === node.second ? node : { ...node, second: result.node };
      return { node: nextNode, swapped: true };
    }
    // Only swap if both siblings are simple panes (not splits)
    if (getSiblingForDirection(node, 'second', direction) && !isSplitNode(node.first) && !isSplitNode(node.second)) {
      return { node: { ...node, first: node.second, second: node.first }, swapped: true };
    }
    return { node, swapped: false };
  }

  return { node, swapped: false };
}

/**
 * Swap two panes by ID in a single pass (handles both panes being in the same tree).
 * pane1Data replaces pane with paneId2, pane2Data replaces pane with paneId1.
 */
export function swapTwoPanesById(
  node: LayoutNode,
  paneId1: string,
  pane1Data: PaneData,
  paneId2: string,
  pane2Data: PaneData
): LayoutNode {
  if (!isSplitNode(node)) {
    if (node.id === paneId1) {
      // Replace pane1 position with pane2's data
      return { ...pane2Data, rectangle: node.rectangle };
    }
    if (node.id === paneId2) {
      // Replace pane2 position with pane1's data
      return { ...pane1Data, rectangle: node.rectangle };
    }
    return node;
  }

  const updatedFirst = swapTwoPanesById(node.first, paneId1, pane1Data, paneId2, pane2Data);
  const updatedSecond = swapTwoPanesById(node.second, paneId1, pane1Data, paneId2, pane2Data);
  if (updatedFirst === node.first && updatedSecond === node.second) return node;
  return { ...node, first: updatedFirst, second: updatedSecond };
}
