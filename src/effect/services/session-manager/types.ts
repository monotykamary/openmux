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
export type WorkspaceLayoutNode =
  | {
      type: "split"
      id: string
      direction: "horizontal" | "vertical"
      ratio: number
      first: WorkspaceLayoutNode
      second: WorkspaceLayoutNode
    }
  | {
      id: string
      ptyId?: string
      title?: string
      cwd?: string
    }

export interface WorkspaceState {
  mainPane: WorkspaceLayoutNode | null
  stackPanes: Array<WorkspaceLayoutNode>
  focusedPaneId?: string
  layoutMode: "vertical" | "horizontal" | "stacked"
  activeStackIndex: number
  zoomed: boolean
}
