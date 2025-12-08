/**
 * Branded types for type-safe identifiers and domain primitives.
 * These prevent mixing values that have the same underlying type.
 */
import { Schema } from "effect"

// =============================================================================
// Entity IDs
// =============================================================================

/** Unique identifier for a pane */
export const PaneId = Schema.String.pipe(Schema.brand("PaneId"))
export type PaneId = typeof PaneId.Type

/** Unique identifier for a PTY session */
export const PtyId = Schema.String.pipe(Schema.brand("PtyId"))
export type PtyId = typeof PtyId.Type

/** Workspace identifier (1-9) */
export const WorkspaceId = Schema.Int.pipe(
  Schema.between(1, 9),
  Schema.brand("WorkspaceId")
)
export type WorkspaceId = typeof WorkspaceId.Type

/** Unique identifier for a session */
export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

// =============================================================================
// Terminal Dimensions
// =============================================================================

/** Terminal column count (must be positive) */
export const Cols = Schema.Int.pipe(
  Schema.greaterThan(0),
  Schema.brand("Cols")
)
export type Cols = typeof Cols.Type

/** Terminal row count (must be positive) */
export const Rows = Schema.Int.pipe(
  Schema.greaterThan(0),
  Schema.brand("Rows")
)
export type Rows = typeof Rows.Type

// =============================================================================
// Layout Types
// =============================================================================

/** Layout mode for workspace pane arrangement */
export const LayoutMode = Schema.Literal("vertical", "horizontal", "stacked")
export type LayoutMode = typeof LayoutMode.Type

// =============================================================================
// ID Generation Helpers
// =============================================================================

/** Generate a new PaneId */
export const makePaneId = (counter: number): PaneId =>
  PaneId.make(`pane-${counter}`)

/** Generate a new PtyId */
export const makePtyId = (): PtyId =>
  PtyId.make(`pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

/** Generate a new SessionId */
export const makeSessionId = (): SessionId =>
  SessionId.make(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
