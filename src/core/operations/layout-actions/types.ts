/**
 * Types for layout reducer
 */

import type { Direction, Rectangle, Workspace, WorkspaceId, LayoutMode, NodeId, SplitDirection } from '../../types';
import type { LayoutConfig } from '../../config';

/** Workspaces stored as plain object for better SolidJS reactivity */
export type Workspaces = { [K in WorkspaceId]?: Workspace };

export interface LayoutState {
  workspaces: Workspaces;
  activeWorkspaceId: WorkspaceId;
  viewport: Rectangle;
  config: LayoutConfig;
  /** Version counter that increments on save-worthy changes */
  layoutVersion: number;
  /** Version counter that increments when pane geometry changes */
  layoutGeometryVersion: number;
}

export type LayoutAction =
  | { type: 'FOCUS_PANE'; paneId: NodeId }
  | { type: 'NAVIGATE'; direction: Direction }
  | { type: 'MOVE_PANE'; direction: Direction }
  | { type: 'NEW_PANE'; ptyId?: string; title?: string }
  | { type: 'SPLIT_PANE'; direction: SplitDirection; ptyId?: string; title?: string }
  | { type: 'CLOSE_PANE' }
  | { type: 'CLOSE_PANE_BY_ID'; paneId: NodeId }
  | { type: 'SET_VIEWPORT'; viewport: Rectangle }
  | { type: 'SWITCH_WORKSPACE'; workspaceId: WorkspaceId }
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'SET_PANE_PTY'; paneId: NodeId; ptyId: string }
  | { type: 'SET_PANE_TITLE'; paneId: NodeId; title: string }
  | { type: 'SWAP_MAIN' }
  | { type: 'TOGGLE_ZOOM' }
  | { type: 'LOAD_SESSION'; workspaces: Workspaces; activeWorkspaceId: WorkspaceId }
  | { type: 'CLEAR_ALL' };
