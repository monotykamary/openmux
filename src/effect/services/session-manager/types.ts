/**
 * Types for SessionManager service
 */

import type {
  SessionStorageError,
  SessionNotFoundError,
  SessionCorruptedError,
} from "../../errors"

/**
 * Union type for all session-related errors
 */
export type SessionError =
  | SessionStorageError
  | SessionNotFoundError
  | SessionCorruptedError

/**
 * Workspace state for serialization
 * Represents the in-memory state of a workspace
 */
export interface WorkspaceState {
  mainPane: { id: string; ptyId?: string; title?: string } | null
  stackPanes: Array<{ id: string; ptyId?: string; title?: string }>
  focusedPaneId?: string
  layoutMode: "vertical" | "horizontal" | "stacked"
  activeStackIndex: number
  zoomed: boolean
}
