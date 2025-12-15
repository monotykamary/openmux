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
import {
  type SessionState,
  type SessionAction,
  type SessionSummary,
  sessionReducer,
  createInitialState,
} from '../core/operations/session-actions';

// Re-export types for external consumers
export type { SessionState, SessionSummary };

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
    cwdMap: Map<string, string>,
    sessionId: string
  ) => void;
  /** Callback to suspend PTYs before switching (saves mapping, doesn't destroy) */
  onBeforeSwitch: (currentSessionId: string) => void;
  /** Callback to cleanup PTYs when a session is deleted */
  onDeleteSession: (sessionId: string) => void;
  /** Layout version counter - triggers save when changed */
  layoutVersion?: number;
}

export function SessionProvider({
  children,
  getCwd,
  getWorkspaces,
  getActiveWorkspaceId,
  onSessionLoad,
  onBeforeSwitch,
  onDeleteSession,
  layoutVersion,
}: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialState);

  // Keep refs for callbacks to avoid stale closures
  const getCwdRef = useRef(getCwd);
  const getWorkspacesRef = useRef(getWorkspaces);
  const getActiveWorkspaceIdRef = useRef(getActiveWorkspaceId);
  const onSessionLoadRef = useRef(onSessionLoad);
  const onBeforeSwitchRef = useRef(onBeforeSwitch);
  const onDeleteSessionRef = useRef(onDeleteSession);

  useEffect(() => {
    getCwdRef.current = getCwd;
    getWorkspacesRef.current = getWorkspaces;
    getActiveWorkspaceIdRef.current = getActiveWorkspaceId;
    onSessionLoadRef.current = onSessionLoad;
    onBeforeSwitchRef.current = onBeforeSwitch;
    onDeleteSessionRef.current = onDeleteSession;
  }, [getCwd, getWorkspaces, getActiveWorkspaceId, onSessionLoad, onBeforeSwitch, onDeleteSession]);

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

          // Update lastSwitchedAt so this session is properly marked as most recent
          await switchToSession(activeId);
          await refreshSessions();

          // Load session data and notify parent
          const data = await loadSessionData(activeId);
          if (data && data.workspaces.size > 0) {
            onSessionLoadRef.current(data.workspaces, data.activeWorkspaceId, data.cwdMap, activeId);
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

  // Track previous layoutVersion to detect changes
  const prevLayoutVersionRef = useRef(layoutVersion);

  // Immediate save when layoutVersion changes (pane/workspace changes)
  useEffect(() => {
    // Skip on initial render or if no active session
    if (prevLayoutVersionRef.current === layoutVersion || !state.activeSession) {
      prevLayoutVersionRef.current = layoutVersion;
      return;
    }

    prevLayoutVersionRef.current = layoutVersion;

    // Save immediately when layout changes
    const workspaces = getWorkspacesRef.current();
    const activeWorkspaceId = getActiveWorkspaceIdRef.current();

    if (workspaces.size > 0) {
      saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwdRef.current
      );
    }
  }, [layoutVersion, state.activeSession]);

  const createSession = useCallback(async (name?: string) => {
    // Save current session first
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspacesRef.current();
      const activeWorkspaceId = getActiveWorkspaceIdRef.current();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwdRef.current
      );

      // Suspend PTYs for current session before switching
      onBeforeSwitchRef.current(state.activeSessionId);
    }

    const metadata = await createSessionOnDisk(name);
    await refreshSessions();
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });

    // Load empty workspaces for new session
    onSessionLoadRef.current(new Map(), 1, new Map(), metadata.id);

    return metadata;
  }, [state.activeSession, state.activeSessionId, refreshSessions]);

  const switchSession = useCallback(async (id: SessionId) => {
    if (id === state.activeSessionId) return;

    // Save current session
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspacesRef.current();
      const activeWorkspaceId = getActiveWorkspaceIdRef.current();
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwdRef.current
      );

      // Suspend PTYs for current session (save mapping, don't destroy)
      onBeforeSwitchRef.current(state.activeSessionId);
    }

    // Load new session
    await switchToSession(id);
    const data = await loadSessionData(id);

    if (data) {
      dispatch({ type: 'SET_ACTIVE_SESSION', id, session: data.metadata });
      onSessionLoadRef.current(data.workspaces, data.activeWorkspaceId, data.cwdMap, id);
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
    // Clean up PTYs for the deleted session
    onDeleteSessionRef.current(id);

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
