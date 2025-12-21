/**
 * Session context for managing sessions (above workspaces)
 */

import {
  createContext,
  useContext,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  type ParentProps,
  type Accessor,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { SessionId, SessionMetadata, WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import { DEFAULT_CONFIG } from '../core/config';
import {
  createSessionLegacy as createSessionOnDisk,
  renameSessionLegacy as renameSessionOnDisk,
  deleteSessionLegacy as deleteSessionOnDisk,
  saveCurrentSession,
} from '../effect/bridge';
import {
  type SessionState,
  type SessionAction,
  type SessionSummary,
  sessionReducer,
  createInitialState,
} from '../core/operations/session-actions';
import { createSessionRefresher, initializeSessionContext } from './session/bootstrap';

// Re-export types for external consumers
export type { SessionState, SessionSummary };

// =============================================================================
// Context Value Interface
// =============================================================================

interface SessionContextValue {
  state: SessionState;
  /** Filter sessions by search query */
  filteredSessions: SessionMetadata[];
  /** Create a new session */
  createSession: (name?: string) => Promise<SessionMetadata>;
  /** Switch to a session */
  switchSession: (id: SessionId) => Promise<void>;
  /** Rename a session */
  renameSession: (id: SessionId, name: string) => Promise<void>;
  /** Delete a session */
  deleteSession: (id: SessionId) => Promise<void>;
  /** Save the current session */
  saveSession: () => Promise<void>;
  /** Refresh sessions list */
  refreshSessions: () => Promise<void>;
  /** Toggle session picker */
  togglePicker: () => void;
  /** Close session picker */
  closePicker: () => void;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Start rename mode */
  startRename: (id: SessionId, currentName: string) => void;
  /** Cancel rename */
  cancelRename: () => void;
  /** Update rename value */
  updateRenameValue: (value: string) => void;
  /** Navigate up in picker */
  navigateUp: () => void;
  /** Navigate down in picker */
  navigateDown: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SessionProviderProps extends ParentProps {
  /** Function to get CWD for a PTY ID */
  getCwd: (ptyId: string) => Promise<string>;
  /** Function to get current workspaces */
  getWorkspaces: () => Workspaces;
  /** Function to get active workspace ID */
  getActiveWorkspaceId: () => WorkspaceId;
  /** Callback when session is loaded */
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    sessionId: string
  ) => Promise<void>;
  /** Callback to suspend PTYs before switching (saves mapping, doesn't destroy) */
  onBeforeSwitch: (currentSessionId: string) => Promise<void>;
  /** Callback to cleanup PTYs when a session is deleted */
  onDeleteSession: (sessionId: string) => void;
  /** Layout version counter - triggers save when changed */
  layoutVersion?: Accessor<number>;
}

export function SessionProvider(props: SessionProviderProps) {
  const [state, setState] = createStore<SessionState>(createInitialState());

  // Helper to dispatch actions through the reducer
  const dispatch = (action: SessionAction) => {
    setState(produce((s) => {
      const newState = sessionReducer(s as SessionState, action);
      Object.assign(s, newState);
    }));
  };

  // Actions
  const refreshSessions = createSessionRefresher(dispatch);

  // Initialize on mount
  onMount(async () => {
    await initializeSessionContext({
      refreshSessions,
      dispatch,
      onSessionLoad: props.onSessionLoad,
    });

    dispatch({ type: 'SET_INITIALIZED' });
  });

  // Auto-save interval
  createEffect(() => {
    if (!state.activeSession || DEFAULT_CONFIG.autoSaveInterval === 0) return;

    const interval = setInterval(async () => {
      const workspaces = props.getWorkspaces();
      const activeWorkspaceId = props.getActiveWorkspaceId();

      if (state.activeSession && Object.keys(workspaces).length > 0) {
        await saveCurrentSession(
          state.activeSession,
          workspaces,
          activeWorkspaceId,
          props.getCwd
        );
      }
    }, DEFAULT_CONFIG.autoSaveInterval);

    onCleanup(() => clearInterval(interval));
  });

  // Track previous layoutVersion to detect changes
  let prevLayoutVersion = props.layoutVersion?.();

  // Immediate save when layoutVersion changes (pane/workspace changes)
  createEffect(() => {
    const layoutVersion = props.layoutVersion?.();

    // Skip on initial render or if no active session
    if (prevLayoutVersion === layoutVersion || !state.activeSession) {
      prevLayoutVersion = layoutVersion;
      return;
    }

    prevLayoutVersion = layoutVersion;

    // Save immediately when layout changes
    const workspaces = props.getWorkspaces();
    const activeWorkspaceId = props.getActiveWorkspaceId();

    if (Object.keys(workspaces).length > 0) {
      saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        props.getCwd
      );
    }
  });

  const createSession = async (name?: string) => {
    // Save current session first
    if (state.activeSession && state.activeSessionId) {
      const workspaces = props.getWorkspaces();
      const activeWorkspaceId = props.getActiveWorkspaceId();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        props.getCwd
      );

      // Suspend PTYs for current session before switching
      await props.onBeforeSwitch(state.activeSessionId);
    }

    const metadata = await createSessionOnDisk(name);
    await refreshSessions();
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });

    // Load empty workspaces for new session
    await props.onSessionLoad({}, 1, new Map(), metadata.id);

    return metadata;
  };

  const switchSession = async (id: SessionId) => {
    if (id === state.activeSessionId) return;

    // Mark switching in progress to prevent "No panes" flash
    dispatch({ type: 'SET_SWITCHING', switching: true });

    // Save current session
    if (state.activeSession && state.activeSessionId) {
      const workspaces = props.getWorkspaces();
      const activeWorkspaceId = props.getActiveWorkspaceId();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        props.getCwd
      );

      // Suspend PTYs for current session (save mapping, don't destroy)
      await props.onBeforeSwitch(state.activeSessionId);
    }

    // Load new session
    await switchToSession(id);
    const data = await loadSessionData(id);

    if (data) {
      dispatch({ type: 'SET_ACTIVE_SESSION', id, session: data.metadata });
      // IMPORTANT: Await onSessionLoad to ensure CWD map is set before switching completes
      await props.onSessionLoad(data.workspaces, data.activeWorkspaceId, data.cwdMap, id);
    }

    // Mark switching complete
    dispatch({ type: 'SET_SWITCHING', switching: false });

    dispatch({ type: 'CLOSE_SESSION_PICKER' });

    await refreshSessions();
  };

  const renameSession = async (id: SessionId, name: string) => {
    await renameSessionOnDisk(id, name);
    await refreshSessions();

    if (state.activeSessionId === id && state.activeSession) {
      dispatch({
        type: 'SET_ACTIVE_SESSION',
        id,
        session: { ...state.activeSession, name, autoNamed: false },
      });
    }

    dispatch({ type: 'CANCEL_RENAME' });
  };

  const deleteSession = async (id: SessionId) => {
    // Clean up PTYs for the deleted session
    props.onDeleteSession(id);

    await deleteSessionOnDisk(id);
    await refreshSessions();

    // If deleting active session, switch to another
    if (state.activeSessionId === id) {
      const sessions = await listSessions();
      if (sessions.length > 0) {
        await switchSession(sessions[0]!.id);
      }
    }
  };

  const saveSession = async () => {
    if (!state.activeSession) return;

    const workspaces = props.getWorkspaces();
    const activeWorkspaceId = props.getActiveWorkspaceId();

    await saveCurrentSession(
      state.activeSession,
      workspaces,
      activeWorkspaceId,
      props.getCwd
    );

    await refreshSessions();
  };

  const togglePicker = () => {
    dispatch({ type: 'TOGGLE_SESSION_PICKER' });
  };

  const closePicker = () => {
    dispatch({ type: 'CLOSE_SESSION_PICKER' });
  };

  const setSearchQuery = (query: string) => {
    dispatch({ type: 'SET_SEARCH_QUERY', query });
  };

  const startRename = (id: SessionId, currentName: string) => {
    dispatch({ type: 'START_RENAME', sessionId: id, currentName });
  };

  const cancelRename = () => {
    dispatch({ type: 'CANCEL_RENAME' });
  };

  const updateRenameValue = (value: string) => {
    dispatch({ type: 'UPDATE_RENAME_VALUE', value });
  };

  const navigateUp = () => {
    dispatch({ type: 'NAVIGATE_UP' });
  };

  const navigateDown = () => {
    dispatch({ type: 'NAVIGATE_DOWN' });
  };

  // Computed values
  const filteredSessions = createMemo(() =>
    state.sessions.filter(s =>
      s.name.toLowerCase().includes(state.searchQuery.toLowerCase())
    )
  );

  const value: SessionContextValue = {
    get state() { return state; },
    get filteredSessions() { return filteredSessions(); },
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
    refreshSessions,
    togglePicker,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
  };

  return (
    <SessionContext.Provider value={value}>
      {props.children}
    </SessionContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

export function useSessionState(): SessionState {
  const { state } = useSession();
  return state;
}
