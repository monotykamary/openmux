/**
 * Session context for managing sessions (above workspaces)
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { SessionId, SessionMetadata, Workspace, WorkspaceId } from '../core/types';
import { DEFAULT_CONFIG } from '../core/config';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  getActiveSessionIdLegacy as getActiveSessionId,
  renameSessionLegacy as renameSessionOnDisk,
  deleteSessionLegacy as deleteSessionOnDisk,
  saveCurrentSession,
  loadSessionData,
  switchToSession,
  getSessionSummary,
} from '../effect/bridge';

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

type SessionAction =
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

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
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
      // Alt+tab behavior: when opening, select the previous session (index 1)
      // Sessions are sorted by lastSwitchedAt, so index 0 is current, index 1 is previous
      const newSelectedIndex = !state.showSessionPicker && state.sessions.length > 1 ? 1 : 0;
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

interface SessionContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
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
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps {
  children: ReactNode;
  /** Function to get CWD for a PTY ID */
  getCwd: (ptyId: string) => Promise<string>;
  /** Function to get current workspaces */
  getWorkspaces: () => Map<WorkspaceId, Workspace>;
  /** Function to get active workspace ID */
  getActiveWorkspaceId: () => WorkspaceId;
  /** Callback when session is loaded */
  onSessionLoad: (
    workspaces: Map<WorkspaceId, Workspace>,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>
  ) => void;
  /** Callback to destroy all PTYs before switching */
  onBeforeSwitch: () => void;
}

export function SessionProvider({
  children,
  getCwd,
  getWorkspaces,
  getActiveWorkspaceId,
  onSessionLoad,
  onBeforeSwitch,
}: SessionProviderProps) {
  const initialState: SessionState = {
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    showSessionPicker: false,
    searchQuery: '',
    selectedIndex: 0,
    isRenaming: false,
    renameValue: '',
    renamingSessionId: null,
    summaries: new Map(),
    initialized: false,
  };

  const [state, dispatch] = useReducer(sessionReducer, initialState);

  // Keep refs for callbacks to avoid stale closures
  const getCwdRef = useRef(getCwd);
  const getWorkspacesRef = useRef(getWorkspaces);
  const getActiveWorkspaceIdRef = useRef(getActiveWorkspaceId);
  const onSessionLoadRef = useRef(onSessionLoad);
  const onBeforeSwitchRef = useRef(onBeforeSwitch);

  useEffect(() => {
    getCwdRef.current = getCwd;
    getWorkspacesRef.current = getWorkspaces;
    getActiveWorkspaceIdRef.current = getActiveWorkspaceId;
    onSessionLoadRef.current = onSessionLoad;
    onBeforeSwitchRef.current = onBeforeSwitch;
  }, [getCwd, getWorkspaces, getActiveWorkspaceId, onSessionLoad, onBeforeSwitch]);

  const refreshSessions = useCallback(async () => {
    const sessions = await listSessions();
    dispatch({ type: 'SET_SESSIONS', sessions });

    // Load summaries for all sessions
    const summaries = new Map<SessionId, SessionSummary>();
    for (const session of sessions) {
      const summary = await getSessionSummary(session.id);
      if (summary) {
        summaries.set(session.id, summary);
      }
    }
    dispatch({ type: 'SET_SUMMARIES', summaries });
  }, []);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      await refreshSessions();

      // Get active session or create default
      let activeId = await getActiveSessionId();
      const sessions = await listSessions();

      if (!activeId && sessions.length === 0) {
        // First run - create default session
        const metadata = await createSessionOnDisk();
        activeId = metadata.id;
        dispatch({ type: 'SET_SESSIONS', sessions: [metadata] });
        dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
      } else if (activeId) {
        // Load existing session
        const session = sessions.find(s => s.id === activeId);
        if (session) {
          dispatch({ type: 'SET_ACTIVE_SESSION', id: activeId, session });

          // Load session data and notify parent
          const data = await loadSessionData(activeId);
          if (data && data.workspaces.size > 0) {
            onSessionLoadRef.current(data.workspaces, data.activeWorkspaceId, data.cwdMap);
          }
        }
      }

      dispatch({ type: 'SET_INITIALIZED' });
    };

    init();
  }, [refreshSessions]);

  // Auto-save interval
  useEffect(() => {
    if (!state.activeSession || DEFAULT_CONFIG.autoSaveInterval === 0) return;

    const interval = setInterval(async () => {
      const workspaces = getWorkspacesRef.current();
      const activeWorkspaceId = getActiveWorkspaceIdRef.current();

      if (state.activeSession && workspaces.size > 0) {
        await saveCurrentSession(
          state.activeSession,
          workspaces,
          activeWorkspaceId,
          getCwdRef.current
        );
      }
    }, DEFAULT_CONFIG.autoSaveInterval);

    return () => clearInterval(interval);
  }, [state.activeSession]);

  const createSession = useCallback(async (name?: string) => {
    // Save current session first
    if (state.activeSession) {
      const workspaces = getWorkspacesRef.current();
      const activeWorkspaceId = getActiveWorkspaceIdRef.current();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwdRef.current
      );
    }

    const metadata = await createSessionOnDisk(name);
    await refreshSessions();
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });

    // Clear current workspaces for new session
    onBeforeSwitchRef.current();
    onSessionLoadRef.current(new Map(), 1, new Map());

    return metadata;
  }, [state.activeSession, refreshSessions]);

  const switchSession = useCallback(async (id: SessionId) => {
    if (id === state.activeSessionId) return;

    // Save current session
    if (state.activeSession) {
      const workspaces = getWorkspacesRef.current();
      const activeWorkspaceId = getActiveWorkspaceIdRef.current();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwdRef.current
      );
    }

    // Destroy current PTYs
    onBeforeSwitchRef.current();

    // Load new session
    await switchToSession(id);
    const data = await loadSessionData(id);

    if (data) {
      dispatch({ type: 'SET_ACTIVE_SESSION', id, session: data.metadata });
      onSessionLoadRef.current(data.workspaces, data.activeWorkspaceId, data.cwdMap);
    }

    dispatch({ type: 'CLOSE_SESSION_PICKER' });

    await refreshSessions();
  }, [state.activeSessionId, state.activeSession, refreshSessions]);

  const renameSession = useCallback(async (id: SessionId, name: string) => {
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
  }, [state.activeSessionId, state.activeSession, refreshSessions]);

  const deleteSession = useCallback(async (id: SessionId) => {
    await deleteSessionOnDisk(id);
    await refreshSessions();

    // If deleting active session, switch to another
    if (state.activeSessionId === id) {
      const sessions = await listSessions();
      if (sessions.length > 0) {
        await switchSession(sessions[0]!.id);
      }
    }
  }, [state.activeSessionId, refreshSessions, switchSession]);

  const saveSession = useCallback(async () => {
    if (!state.activeSession) return;

    const workspaces = getWorkspacesRef.current();
    const activeWorkspaceId = getActiveWorkspaceIdRef.current();

    await saveCurrentSession(
      state.activeSession,
      workspaces,
      activeWorkspaceId,
      getCwdRef.current
    );

    await refreshSessions();
  }, [state.activeSession, refreshSessions]);

  const togglePicker = useCallback(() => {
    dispatch({ type: 'TOGGLE_SESSION_PICKER' });
  }, []);

  const closePicker = useCallback(() => {
    dispatch({ type: 'CLOSE_SESSION_PICKER' });
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const filteredSessions = state.sessions.filter(s =>
      s.name.toLowerCase().includes(state.searchQuery.toLowerCase())
    );

    return {
      state,
      dispatch,
      filteredSessions,
      createSession,
      switchSession,
      renameSession,
      deleteSession,
      saveSession,
      refreshSessions,
      togglePicker,
      closePicker,
    };
  }, [
    state,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
    refreshSessions,
    togglePicker,
    closePicker,
  ]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

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
