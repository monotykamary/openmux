/**
 * Session reducer
 */

import type { SessionState, SessionAction, SessionSummary } from './types';
import type { SessionId } from '../../types';

/**
 * Initial state for session context
 */
export function createInitialState(): SessionState {
  return {
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    showSessionPicker: false,
    searchQuery: '',
    selectedIndex: 0,
    isRenaming: false,
    renameValue: '',
    renamingSessionId: null,
    summaries: new Map<SessionId, SessionSummary>(),
    initialized: false,
  };
}

/**
 * Session state reducer
 */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions };

    case 'SET_ACTIVE_SESSION':
      return {
        ...state,
        activeSessionId: action.id,
        activeSession: action.session,
      };

    case 'SET_SUMMARIES':
      return { ...state, summaries: action.summaries };

    case 'TOGGLE_SESSION_PICKER': {
      // Alt+tab behavior: when opening, select the first session that is NOT the current one
      // Sessions are sorted by lastSwitchedAt (most recent first), so we find the first different session
      let newSelectedIndex = 0;
      if (!state.showSessionPicker && state.sessions.length > 1) {
        // Find the first session that is not the currently active one
        const otherSessionIndex = state.sessions.findIndex(s => s.id !== state.activeSessionId);
        newSelectedIndex = otherSessionIndex !== -1 ? otherSessionIndex : 0;
      }
      return {
        ...state,
        showSessionPicker: !state.showSessionPicker,
        searchQuery: '',
        selectedIndex: newSelectedIndex,
        isRenaming: false,
        renameValue: '',
        renamingSessionId: null,
      };
    }

    case 'CLOSE_SESSION_PICKER':
      return {
        ...state,
        showSessionPicker: false,
        searchQuery: '',
        selectedIndex: 0,
        isRenaming: false,
        renameValue: '',
        renamingSessionId: null,
      };

    case 'SET_SEARCH_QUERY': {
      return {
        ...state,
        searchQuery: action.query,
        selectedIndex: 0,
      };
    }

    case 'NAVIGATE_UP':
      return {
        ...state,
        selectedIndex: Math.max(0, state.selectedIndex - 1),
      };

    case 'NAVIGATE_DOWN': {
      const filteredCount = state.sessions.filter(s =>
        s.name.toLowerCase().includes(state.searchQuery.toLowerCase())
      ).length;
      return {
        ...state,
        selectedIndex: Math.min(filteredCount - 1, state.selectedIndex + 1),
      };
    }

    case 'SET_SELECTED_INDEX':
      return { ...state, selectedIndex: action.index };

    case 'START_RENAME':
      return {
        ...state,
        isRenaming: true,
        renamingSessionId: action.sessionId,
        renameValue: action.currentName,
      };

    case 'UPDATE_RENAME_VALUE':
      return { ...state, renameValue: action.value };

    case 'CANCEL_RENAME':
      return {
        ...state,
        isRenaming: false,
        renamingSessionId: null,
        renameValue: '',
      };

    case 'SET_INITIALIZED':
      return { ...state, initialized: true };

    default:
      return state;
  }
}
