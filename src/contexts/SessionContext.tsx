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
import { Effect, Schedule, Stream, Duration } from 'effect';
import type { SessionMetadata, WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import { useConfig } from './ConfigContext';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  getActiveSessionIdLegacy as getActiveSessionId,
  saveCurrentSession,
  loadSessionData,
  switchToSession,
  getSessionSummary,
  setActiveSessionIdForShim,
  listTemplates,
  saveTemplate as saveTemplateDefinition,
  deleteTemplate,
} from '../effect/bridge';
import { runStream } from '../effect/stream-utils';
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
import { createSessionOperations } from './session-operations';

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
  switchSession: (id: string) => Promise<void>;
  /** Rename a session */
  renameSession: (id: string, name: string) => Promise<void>;
  /** Delete a session */
  deleteSession: (id: string) => Promise<void>;
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
  startRename: (id: string, currentName: string) => void;
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
  /** Function to get last shell command captured for a PTY ID */
  getLastCommand: (ptyId: string) => Promise<string | undefined>;
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

  const hasAnyPanes = (workspaces: Workspaces): boolean =>
    Object.values(workspaces).some(
      (workspace) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0)
    );

  const shouldPersistSession = (workspaces: Workspaces): boolean =>
    state.initialized && !state.switching && !!state.activeSession && hasAnyPanes(workspaces);

  // Picker actions
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

  // Refresh helpers
  const { refreshSessions, refreshTemplates } = createSessionRefreshers({
    listSessions,
    getSessionSummary,
    dispatch,
    listTemplates,
    setTemplates,
  });

  // Session CRUD operations
  const sessionOps = createSessionOperations({
    getState: () => state,
    dispatch,
    getCwd: props.getCwd,
    getWorkspaces: props.getWorkspaces,
    getActiveWorkspaceId: props.getActiveWorkspaceId,
    shouldPersistSession,
    onSessionLoad: props.onSessionLoad,
    onBeforeSwitch: props.onBeforeSwitch,
    onDeleteSession: props.onDeleteSession,
    refreshSessions,
  });

  // Template overlay actions
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
      getLastCommand: props.getLastCommand,
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
    let activeSession = activeId
      ? sessions.find(s => s.id === activeId) ?? null
      : null;

    if (!activeSession && sessions.length > 0) {
      activeSession = sessions[0] ?? null;
      activeId = activeSession?.id ?? null;
    }

    if (!activeSession) {
      // First run - create default session
      const metadata = await createSessionOnDisk();
      activeId = metadata.id;
      dispatch({ type: 'SET_SESSIONS', sessions: [metadata] });
      dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
      await props.onSessionLoad({}, 1, new Map(), new Map(), metadata.id);
      await refreshSessions();
    } else if (activeId) {
      // Load existing session
      dispatch({ type: 'SET_ACTIVE_SESSION', id: activeId, session: activeSession });

      // Update lastSwitchedAt so this session is properly marked as most recent
      await switchToSession(activeId);
      await refreshSessions();

      // Load session data and notify parent
      const data = await loadSessionData(activeId);
      if (data) {
        // IMPORTANT: Await onSessionLoad to ensure CWD map is set before initialized
        await props.onSessionLoad(
          data.workspaces,
          data.activeWorkspaceId,
          data.cwdMap,
          new Map(),
          activeId
        );
      } else {
        // Session failed to load - create a fresh session instead of overwriting
        const metadata = await createSessionOnDisk();
        dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
        await props.onSessionLoad({}, 1, new Map(), new Map(), metadata.id);
        await refreshSessions();
      }
    }

    dispatch({ type: 'SET_INITIALIZED' });
  });

  // Auto-save interval
  createEffect(() => {
    const intervalMs = config.config().session.autoSaveIntervalMs;
    if (!state.activeSession || intervalMs === 0) return;

    const autosaveStream = Stream.repeatEffectWithSchedule(
      Effect.tryPromise(async () => {
        const workspaces = props.getWorkspaces();
        const activeWorkspaceId = props.getActiveWorkspaceId();

        if (state.activeSession && shouldPersistSession(workspaces)) {
          await saveCurrentSession(
            state.activeSession,
            workspaces,
            activeWorkspaceId,
            props.getCwd
          );
        }
      }),
      Schedule.fixed(Duration.millis(intervalMs))
    );

    const stop = runStream(autosaveStream, { label: 'session-autosave' });
    onCleanup(() => stop());
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

    if (shouldPersistSession(workspaces)) {
      saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        props.getCwd
      );
    }
  });

  // Computed values
  const filteredSessions = createMemo(() =>
    state.sessions.filter(s =>
      s.name.toLowerCase().includes(state.searchQuery.toLowerCase())
    )
  );

  const value: SessionContextValue = {
    get state() { return state; },
    get filteredSessions() { return filteredSessions(); },
    ...sessionOps,
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
