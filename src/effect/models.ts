/**
 * Domain models using Schema.Class for validation and serialization.
 */
import { Schema } from "effect"
import { PaneId, PtyId, WorkspaceId, SessionId, LayoutMode, Cols, Rows } from "./types"

// =============================================================================
// Layout Models
// =============================================================================

/** Rectangle dimensions for pane positioning */
export class Rectangle extends Schema.Class<Rectangle>("Rectangle")({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int.pipe(Schema.greaterThan(0)),
  height: Schema.Int.pipe(Schema.greaterThan(0)),
}) {
  /** Check if a point is within this rectangle */
  contains(px: number, py: number): boolean {
    return px >= this.x && px < this.x + this.width &&
           py >= this.y && py < this.y + this.height
  }
}

/** Pane data with optional PTY and layout info */
export class PaneData extends Schema.Class<PaneData>("PaneData")({
  id: PaneId,
  ptyId: Schema.optional(PtyId),
  title: Schema.optional(Schema.String),
  rectangle: Schema.optional(Rectangle),
}) {}

// =============================================================================
// PTY Models
// =============================================================================

/** PTY session information */
export class PtySession extends Schema.Class<PtySession>("PtySession")({
  id: PtyId,
  pid: Schema.Int,
  cols: Cols,
  rows: Rows,
  cwd: Schema.String,
  shell: Schema.String,
}) {}

// =============================================================================
// Session Persistence Models
// =============================================================================

/** Serialized pane data for persistence */
export class SerializedPaneData extends Schema.Class<SerializedPaneData>("SerializedPaneData")({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  cwd: Schema.String,
}) {}

/** Serialized workspace for persistence - matches legacy core/types.ts */
export class SerializedWorkspace extends Schema.Class<SerializedWorkspace>("SerializedWorkspace")({
  id: WorkspaceId,
  mainPane: Schema.NullOr(SerializedPaneData),
  stackPanes: Schema.Array(SerializedPaneData),
  focusedPaneId: Schema.NullOr(Schema.String),
  activeStackIndex: Schema.Int,
  layoutMode: LayoutMode,
  zoomed: Schema.Boolean,
}) {}

/** Session metadata for listing - matches legacy core/types.ts */
export class SessionMetadata extends Schema.Class<SessionMetadata>("SessionMetadata")({
  id: SessionId,
  name: Schema.String,
  createdAt: Schema.Number,
  lastSwitchedAt: Schema.Number,
  autoNamed: Schema.Boolean,
}) {}

/** Full serialized session for persistence - matches legacy core/types.ts */
export class SerializedSession extends Schema.Class<SerializedSession>("SerializedSession")({
  metadata: SessionMetadata,
  workspaces: Schema.Array(SerializedWorkspace),
  activeWorkspaceId: WorkspaceId,
}) {}

/** Session index for tracking all sessions */
export class SessionIndex extends Schema.Class<SessionIndex>("SessionIndex")({
  sessions: Schema.Array(SessionMetadata),
  activeSessionId: Schema.NullOr(SessionId),
}) {
  /** Create an empty session index */
  static empty(): SessionIndex {
    return SessionIndex.make({
      sessions: [],
      activeSessionId: null,
    })
  }
}

// =============================================================================
// Template Models
// =============================================================================

/** Template pane definition for layout templates */
export class TemplatePaneData extends Schema.Class<TemplatePaneData>("TemplatePaneData")({
  role: Schema.Literal("main", "stack"),
  cwd: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
}) {}

/** Template workspace definition */
export class TemplateWorkspace extends Schema.Class<TemplateWorkspace>("TemplateWorkspace")({
  id: WorkspaceId,
  layoutMode: LayoutMode,
  panes: Schema.Array(TemplatePaneData),
}) {}

/** Template defaults for workspace/pane counts */
export class TemplateDefaults extends Schema.Class<TemplateDefaults>("TemplateDefaults")({
  workspaceCount: Schema.Int.pipe(Schema.between(1, 9)),
  paneCount: Schema.Int.pipe(Schema.greaterThan(0)),
  layoutMode: LayoutMode,
  cwd: Schema.optional(Schema.String),
}) {}

/** Full template session definition */
export class TemplateSession extends Schema.Class<TemplateSession>("TemplateSession")({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  defaults: TemplateDefaults,
  workspaces: Schema.Array(TemplateWorkspace),
}) {}

// =============================================================================
// Terminal State Models
// =============================================================================

/** Terminal cell data */
export class TerminalCell extends Schema.Class<TerminalCell>("TerminalCell")({
  char: Schema.String,
  fg: Schema.Int,
  bg: Schema.Int,
  bold: Schema.Boolean,
  italic: Schema.Boolean,
  underline: Schema.Boolean,
  strikethrough: Schema.Boolean,
}) {}

/** Terminal cursor position */
export class CursorPosition extends Schema.Class<CursorPosition>("CursorPosition")({
  x: Schema.Int,
  y: Schema.Int,
  visible: Schema.Boolean,
}) {}
