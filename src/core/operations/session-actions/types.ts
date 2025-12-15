/**
 * Session state and action types
 */

import type { SessionId, SessionMetadata } from '../../types';

export interface SessionSummary {
  workspaceCount: number;
  paneCount: number;
}

export interface SessionState {
  /** List of all session metadata */
  sessions: SessionMetadata[];
  /** Currently active session ID */
  activeSessionId: SessionId | null;
  /** Currently active session metadata */
  activeSession: SessionMetadata | null;
  /** Whether the session picker is shown */
  showSessionPicker: boolean;
  /** Search query for filtering sessions */
  searchQuery: string;
  /** Currently selected index in picker */
  selectedIndex: number;
  /** Whether currently in rename mode */
  isRenaming: boolean;
  /** Rename input value */
  renameValue: string;
  /** Session ID being renamed */
  renamingSessionId: SessionId | null;
  /** Session summaries cache (workspace/pane counts) */
  summaries: Map<SessionId, SessionSummary>;
  /** Whether initial load is complete */
  initialized: boolean;
}

export type SessionAction =
  | { type: 'SET_SESSIONS'; sessions: SessionMetadata[] }
  | { type: 'SET_ACTIVE_SESSION'; id: SessionId; session: SessionMetadata }
  | { type: 'SET_SUMMARIES'; summaries: Map<SessionId, SessionSummary> }
  | { type: 'TOGGLE_SESSION_PICKER' }
  | { type: 'CLOSE_SESSION_PICKER' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'NAVIGATE_UP' }
  | { type: 'NAVIGATE_DOWN' }
  | { type: 'SET_SELECTED_INDEX'; index: number }
  | { type: 'START_RENAME'; sessionId: SessionId; currentName: string }
  | { type: 'UPDATE_RENAME_VALUE'; value: string }
  | { type: 'CANCEL_RENAME' }
  | { type: 'SET_INITIALIZED' };
