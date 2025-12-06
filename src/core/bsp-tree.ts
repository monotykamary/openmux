/**
 * BSP Tree implementation for terminal pane management
 */

import type {
  BSPNode,
  SplitNode,
  PaneNode,
  NodeId,
  Rectangle,
  SplitDirection,
  Direction,
} from './types';
import { BSPConfig, DEFAULT_CONFIG } from './config';

let nodeIdCounter = 0;

/** Generate a unique node ID */
export function generateNodeId(): NodeId {
  return `node-${++nodeIdCounter}`;
}

/** Generate a unique pane ID */
export function generatePaneId(): NodeId {
  return `pane-${++nodeIdCounter}`;
}

/** Check if a node is a leaf (pane) */
export function isPane(node: BSPNode): node is PaneNode {
  return node.type === 'pane';
}

/** Check if a node is a split */
export function isSplit(node: BSPNode): node is SplitNode {
  return node.type === 'split';
}

/** Create a new pane node */
export function createPane(
  id?: NodeId,
  options?: Partial<Omit<PaneNode, 'type' | 'id'>>
): PaneNode {
  return {
    type: 'pane',
    id: id ?? generatePaneId(),
    title: options?.title ?? 'shell',
    ptyId: options?.ptyId,
    cwd: options?.cwd,
    rectangle: options?.rectangle,
  };
}

/** Create a new split node */
export function createSplit(
  first: BSPNode,
  second: BSPNode,
  direction: SplitDirection,
  ratio: number = 0.5
): SplitNode {
  return {
    type: 'split',
    id: generateNodeId(),
    direction,
    ratio,
    first,
    second,
  };
}

/** Count total number of panes in the tree */
export function getPaneCount(node: BSPNode | null): number {
  if (!node) return 0;
  if (isPane(node)) return 1;
  return getPaneCount(node.first) + getPaneCount(node.second);
}

/** Get all panes in order (left-to-right, top-to-bottom) */
export function getAllPanes(node: BSPNode | null): PaneNode[] {
  if (!node) return [];
  if (isPane(node)) return [node];
  return [...getAllPanes(node.first), ...getAllPanes(node.second)];
}

/** Find a pane by ID */
export function findPane(node: BSPNode | null, paneId: NodeId): PaneNode | null {
  if (!node) return null;
  if (isPane(node)) {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

/** Find the parent split of a pane */
export function findParentSplit(
  node: BSPNode | null,
  paneId: NodeId,
  parent: SplitNode | null = null
): { parent: SplitNode; isFirst: boolean } | null {
  if (!node) return null;

  if (isPane(node)) {
    if (node.id === paneId && parent) {
      return { parent, isFirst: parent.first.id === paneId };
    }
    return null;
  }

  // Check children
  const inFirst = findParentSplit(node.first, paneId, node);
  if (inFirst) return inFirst;

  return findParentSplit(node.second, paneId, node);
}

/** Check if a pane is contained in a subtree */
export function containsPane(node: BSPNode | null, paneId: NodeId): boolean {
  if (!node) return false;
  if (isPane(node)) return node.id === paneId;
  return containsPane(node.first, paneId) || containsPane(node.second, paneId);
}

/** Get the first pane in a subtree */
export function getFirstPane(node: BSPNode): PaneNode {
  if (isPane(node)) return node;
  return getFirstPane(node.first);
}

/** Get the last pane in a subtree */
export function getLastPane(node: BSPNode): PaneNode {
  if (isPane(node)) return node;
  return getLastPane(node.second);
}

/** Get the index of a pane (for status bar display) */
export function getPaneIndex(node: BSPNode | null, paneId: NodeId): number {
  const panes = getAllPanes(node);
  return panes.findIndex(p => p.id === paneId);
}

/**
 * BSP Tree class for managing the layout
 */
export class BSPTree {
  private root: BSPNode | null = null;
  private focusedPaneId: NodeId | null = null;
  private config: BSPConfig;

  constructor(config: Partial<BSPConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getRoot(): BSPNode | null {
    return this.root;
  }

  setRoot(node: BSPNode | null): void {
    this.root = node;
  }

  getFocusedPaneId(): NodeId | null {
    return this.focusedPaneId;
  }

  setFocusedPaneId(paneId: NodeId | null): void {
    this.focusedPaneId = paneId;
  }

  getConfig(): BSPConfig {
    return this.config;
  }

  getFocusedPane(): PaneNode | null {
    if (!this.focusedPaneId) return null;
    return findPane(this.root, this.focusedPaneId);
  }

  getPaneCount(): number {
    return getPaneCount(this.root);
  }

  getAllPanes(): PaneNode[] {
    return getAllPanes(this.root);
  }

  /** Check if tree is empty */
  isEmpty(): boolean {
    return this.root === null;
  }

  /** Clone the tree (for immutable updates) */
  clone(): BSPTree {
    const tree = new BSPTree(this.config);
    tree.root = this.root ? this.cloneNode(this.root) : null;
    tree.focusedPaneId = this.focusedPaneId;
    return tree;
  }

  private cloneNode(node: BSPNode): BSPNode {
    if (isPane(node)) {
      return { ...node };
    }
    return {
      ...node,
      first: this.cloneNode(node.first),
      second: this.cloneNode(node.second),
    };
  }
}

/**
 * Direction conversion utilities
 */
export function directionToSplitType(direction: Direction): SplitDirection {
  // North/South splits require horizontal split line
  // East/West splits require vertical split line
  return direction === 'north' || direction === 'south'
    ? 'vertical'
    : 'horizontal';
}

export function oppositeDirection(dir: Direction): Direction {
  const opposites: Record<Direction, Direction> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
  };
  return opposites[dir];
}

/** Convert hjkl to Direction */
export function keyToDirection(key: string): Direction | null {
  const map: Record<string, Direction> = {
    h: 'west',
    j: 'south',
    k: 'north',
    l: 'east',
  };
  return map[key.toLowerCase()] ?? null;
}
