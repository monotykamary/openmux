/**
 * Core type definitions for the master-stack layout system
 */

/** Split orientation - determines how space is divided */
export type SplitDirection = 'horizontal' | 'vertical';

/** Direction for navigation and operations */
export type Direction = 'north' | 'south' | 'east' | 'west';

/** Automatic split scheme when inserting new panes */
export type AutomaticScheme = 'longest_side' | 'alternate' | 'spiral';

/**
 * Layout mode - how panes are arranged in a workspace (Zellij-style)
 * - vertical: main pane left, stack panes split vertically on right
 * - horizontal: main pane top, stack panes split horizontally on bottom
 * - stacked: main pane left, stack panes tabbed on right
 */
export type LayoutMode = 'vertical' | 'horizontal' | 'stacked';

/** Workspace ID (1-9) */
export type WorkspaceId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Pane data (simplified - no tree structure needed for master-stack)
 */
export interface PaneData {
  id: NodeId;
  ptyId?: string;
  title?: string;
  rectangle?: Rectangle;
}

/**
 * Workspace using master-stack layout (like Zellij)
 * - mainPane: the primary pane (left for vertical, top for horizontal)
 * - stackPanes: secondary panes arranged based on layout mode
 */
export interface Workspace {
  id: WorkspaceId;
  mainPane: PaneData | null;
  stackPanes: PaneData[];
  focusedPaneId: NodeId | null;
  /** For stacked mode: which stack pane is visible */
  activeStackIndex: number;
  layoutMode: LayoutMode;
  /** Whether the focused pane is zoomed (fullscreen) */
  zoomed: boolean;
}

/** Rectangle representing a region in terminal coordinates */
export interface Rectangle {
  x: number;      // Column position (0-indexed)
  y: number;      // Row position (0-indexed)
  width: number;  // Width in columns
  height: number; // Height in rows
}

/** Padding/gap configuration */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Unique identifier for nodes */
export type NodeId = string;

/**
 * Split node - internal node that divides space between two children
 */
export interface SplitNode {
  type: 'split';
  id: NodeId;
  direction: SplitDirection;
  /** Split ratio from 0 to 1 (position of split from start) */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
  /** Computed layout rectangle */
  rectangle?: Rectangle;
}

/**
 * Pane node - leaf node representing an actual terminal pane
 */
export interface PaneNode {
  type: 'pane';
  id: NodeId;
  /** Reference to PTY session */
  ptyId?: string;
  /** Pane title (shell name, process, etc.) */
  title?: string;
  /** Working directory */
  cwd?: string;
  /** Computed layout rectangle */
  rectangle?: Rectangle;
}

/** Layout node - either a split or a pane */
export type LayoutNode = SplitNode | PaneNode;

/**
 * Terminal cell from libghostty-vt or fallback parser
 */
export interface TerminalCell {
  char: string;
  fg: { r: number; g: number; b: number };
  bg: { r: number; g: number; b: number };
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  blink: boolean;
  dim: boolean;
  width: 1 | 2;
  hyperlinkId?: number;
}

/**
 * Terminal cursor state
 */
export interface TerminalCursor {
  x: number;
  y: number;
  visible: boolean;
  style?: 'block' | 'underline' | 'bar';
}

/**
 * Terminal state for a pane
 */
export interface TerminalState {
  cols: number;
  rows: number;
  cells: TerminalCell[][];
  /** Version numbers for each row (for efficient React change detection) */
  rowVersions?: number[];
  cursor: TerminalCursor;
  alternateScreen: boolean;
  mouseTracking: boolean;
  /** Cursor key mode (DECCKM) - when 'application', arrow keys send \x1bOx instead of \x1b[x */
  cursorKeyMode?: 'normal' | 'application';
  title?: string;
}

/**
 * Scroll state for a terminal pane
 */
export interface TerminalScrollState {
  /** Number of lines scrolled back from bottom (0 = at bottom/live terminal) */
  viewportOffset: number;
  /** Total scrollback lines available */
  scrollbackLength: number;
  /** Whether currently at the bottom (for sticky scroll detection) */
  isAtBottom: boolean;
}

/**
 * Keyboard mode for prefix key system
 */
export type KeyMode = 'normal' | 'prefix' | 'search';

/**
 * Keyboard state
 */
export interface KeyboardState {
  mode: KeyMode;
  prefixActivatedAt?: number;
  showHints: boolean;
}

/**
 * Theme for pane styling
 */
export interface PaneTheme {
  borderColor: string;
  focusedBorderColor: string;
  urgentBorderColor: string;
  borderStyle: 'single' | 'double' | 'rounded' | 'bold';
  innerGap: number;
  outerGap: number;
  titleColor: string;
  focusedTitleColor: string;
}

/**
 * Theme for status bar
 */
export interface StatusBarTheme {
  backgroundColor: string;
  foregroundColor: string;
  activeTabColor: string;
  inactiveTabColor: string;
}

/**
 * Complete theme configuration
 */
export interface Theme {
  pane: PaneTheme;
  statusBar: StatusBarTheme;
}

/**
 * Layout state containing the layout tree
 */
export interface LayoutState {
  root: LayoutNode | null;
  focusedPaneId: NodeId | null;
  splitPreview?: {
    targetPaneId: NodeId;
    direction: SplitDirection;
    ratio: number;
  };
}

/**
 * PTY session information
 */
export interface PTYSession {
  id: string;
  pid?: number;
  cols: number;
  rows: number;
  cwd: string;
  shell: string;
}

// ============================================================================
// Session Types
// ============================================================================

/** Session ID - unique identifier */
export type SessionId = string;

/** Session metadata for persistence and UI */
export interface SessionMetadata {
  id: SessionId;
  name: string;
  createdAt: number;
  lastSwitchedAt: number;
  autoNamed: boolean;
}

/** Serializable pane state for persistence */
export interface SerializedPaneData {
  id: string;
  title?: string;
  cwd: string;
}

/** Serializable workspace state */
export interface SerializedWorkspace {
  id: WorkspaceId;
  mainPane: SerializedPaneData | null;
  stackPanes: SerializedPaneData[];
  focusedPaneId: string | null;
  activeStackIndex: number;
  layoutMode: LayoutMode;
  zoomed: boolean;
}

/** Complete session state for persistence */
export interface SerializedSession {
  metadata: SessionMetadata;
  workspaces: SerializedWorkspace[];
  activeWorkspaceId: WorkspaceId;
}

/** Session index file structure */
export interface SessionIndex {
  sessions: SessionMetadata[];
  activeSessionId: SessionId | null;
}
