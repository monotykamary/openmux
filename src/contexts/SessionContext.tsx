/**
 * Session context for managing sessions (above workspaces)
 */

import {
  createContext,
  useContext,
  createSignal,
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
import { useConfig } from './ConfigContext';
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
  setActiveSessionIdForShim,
  listTemplates,
  saveTemplate as saveTemplateDefinition,
  deleteTemplate,
} from '../effect/bridge';
import type { TemplateSession } from '../effect/models';
import {
  type SessionState,
  type SessionAction,
  type SessionSummary,
  sessionReducer,
  createInitialState,
} from '../core/operations/session-actions';
import {
  applyTemplateToSession,
  buildTemplateFromWorkspaces,
  isLayoutEmpty as isLayoutEmptyWorkspaces,
} from './session-templates';
import { createSessionPickerActions } from './session-picker-actions';
import { createSessionRefreshers } from './session-refresh';

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
  /** Show template overlay */
  showTemplateOverlay: boolean;
  /** Templates list */
  templates: TemplateSession[];
  /** Open template overlay */
  openTemplateOverlay: () => void;
  /** Toggle template overlay */
  toggleTemplateOverlay: () => void;
  /** Close template overlay */
  closeTemplateOverlay: () => void;
  /** Refresh templates list */
  refreshTemplates: () => Promise<void>;
  /** Apply a template */
  applyTemplate: (template: TemplateSession) => Promise<void>;
  /** Save current session as a template */
  saveTemplate: (name: string) => Promise<string | null>;
  /** Delete a template */
  deleteTemplate: (templateId: string) => Promise<void>;
  /** Check if current layout is empty */
  isLayoutEmpty: () => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SessionProviderProps extends ParentProps {
  /** Function to get CWD for a PTY ID */
  getCwd: (ptyId: string) => Promise<string>;
  /** Function to get foreground process for a PTY ID */
  getForegroundProcess: (ptyId: string) => Promise<string | undefined>;
  /** Function to get current workspaces */
  getWorkspaces: () => Workspaces;
  /** Function to get active workspace ID */
  getActiveWorkspaceId: () => WorkspaceId;
  /** Callback when session is loaded */
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string
  ) => Promise<void>;
  /** Callback to suspend PTYs before switching (saves mapping, doesn't destroy) */
  onBeforeSwitch: (currentSessionId: string) => Promise<void>;
  /** Callback to cleanup PTYs when a session is deleted */
  onDeleteSession: (sessionId: string) => void;
  /** Reset layout and PTYs before applying a template */
  resetLayoutForTemplate: () => Promise<void>;
  /** Layout version counter - triggers save when changed */
  layoutVersion?: Accessor<number>;
}

export function SessionProvider(props: SessionProviderProps) {
  const [state, setState] = createStore<SessionState>(createInitialState());
  const [showTemplateOverlay, setShowTemplateOverlay] = createSignal(false);
  const [templates, setTemplates] = createSignal<TemplateSession[]>([]);
  const config = useConfig();

  // Helper to dispatch actions through the reducer
  const dispatch = (action: SessionAction) => {
    setState(produce((s) => {
      const newState = sessionReducer(s as SessionState, action);
      Object.assign(s, newState);
    }));
  };

  const {
    togglePicker,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
  } = createSessionPickerActions(dispatch);

  const { refreshSessions, refreshTemplates } = createSessionRefreshers({
    listSessions,
    getSessionSummary,
    dispatch,
    listTemplates,
    setTemplates,
  });

  const openTemplateOverlay = () => {
    setShowTemplateOverlay(true);
    refreshTemplates();
  };

  const closeTemplateOverlay = () => {
    setShowTemplateOverlay(false);
  };

  const toggleTemplateOverlay = () => {
    if (showTemplateOverlay()) {
      closeTemplateOverlay();
    } else {
      openTemplateOverlay();
    }
  };

  const isLayoutEmpty = () => isLayoutEmptyWorkspaces(props.getWorkspaces());

  const applyTemplate = (template: TemplateSession) =>
    applyTemplateToSession({
      template,
      activeSessionId: state.activeSessionId,
      resetLayoutForTemplate: props.resetLayoutForTemplate,
      onSessionLoad: props.onSessionLoad,
    });

  const saveTemplate = async (nameInput: string): Promise<string | null> => {
    const name = nameInput.trim();
    if (!name) return null;

    const result = await buildTemplateFromWorkspaces({
      name,
      workspaces: props.getWorkspaces(),
      getCwd: props.getCwd,
      getForegroundProcess: props.getForegroundProcess,
      defaultLayoutMode: config.config().layout.defaultLayoutMode,
      fallbackCwd: process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd(),
      shellPath: process.env.SHELL,
    });

    if (!result) {
      return null;
    }

    await saveTemplateDefinition(result.template);
    await refreshTemplates();
    return result.templateId;
  };

  const deleteTemplateById = async (templateId: string) => {
    await deleteTemplate(templateId);
    await refreshTemplates();
  };

  // Initialize on mount
  onMount(async () => {
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
        if (data && Object.keys(data.workspaces).length > 0) {
          // IMPORTANT: Await onSessionLoad to ensure CWD map is set before initialized
          await props.onSessionLoad(
            data.workspaces,
            data.activeWorkspaceId,
            data.cwdMap,
            new Map(),
            activeId
          );
        }
      }
    }

    dispatch({ type: 'SET_INITIALIZED' });
  });

  // Auto-save interval
  createEffect(() => {
    const intervalMs = config.config().session.autoSaveIntervalMs;
    if (!state.activeSession || intervalMs === 0) return;

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
    }, intervalMs);

    onCleanup(() => clearInterval(interval));
  });

  // Track previous layoutVersion to detect changes
  let prevLayoutVersion = props.layoutVersion?.();

  // Keep active session ID available for shim mapping
  createEffect(() => {
    setActiveSessionIdForShim(state.activeSessionId ?? null);
  });

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
    await props.onSessionLoad({}, 1, new Map(), new Map(), metadata.id);

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
      await props.onSessionLoad(data.workspaces, data.activeWorkspaceId, data.cwdMap, new Map(), id);
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
    get showTemplateOverlay() { return showTemplateOverlay(); },
    get templates() { return templates(); },
    openTemplateOverlay,
    toggleTemplateOverlay,
    closeTemplateOverlay,
    refreshTemplates,
    applyTemplate,
    saveTemplate,
    deleteTemplate: deleteTemplateById,
    isLayoutEmpty,
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
