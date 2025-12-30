/**
 * Session CRUD operations.
 */

import type { SessionId, SessionMetadata, WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import type { SessionState, SessionAction } from '../core/operations/session-actions';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  renameSessionLegacy as renameSessionOnDisk,
  deleteSessionLegacy as deleteSessionOnDisk,
  saveCurrentSession,
  loadSessionData,
  switchToSession,
} from '../effect/bridge';

export interface SessionOperationsParams {
  getState: () => SessionState;
  dispatch: (action: SessionAction) => void;
  getCwd: (ptyId: string) => Promise<string>;
  getWorkspaces: () => Workspaces;
  getActiveWorkspaceId: () => WorkspaceId;
  shouldPersistSession: (workspaces: Workspaces) => boolean;
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => Promise<void>;
  onBeforeSwitch: (currentSessionId: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
}

export function createSessionOperations(params: SessionOperationsParams) {
  const {
    getState,
    dispatch,
    getCwd,
    getWorkspaces,
    getActiveWorkspaceId,
    shouldPersistSession,
    onSessionLoad,
    onBeforeSwitch,
    onDeleteSession,
    refreshSessions,
  } = params;

  const createSession = async (name?: string): Promise<SessionMetadata> => {
    const state = getState();

    // Save current session first
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspaces();
      const activeWorkspaceId = getActiveWorkspaceId();
      if (shouldPersistSession(workspaces)) {
        await saveCurrentSession(
          state.activeSession,
          workspaces,
          activeWorkspaceId,
          getCwd
        );
      }

      // Suspend PTYs for current session before switching
      await onBeforeSwitch(state.activeSessionId);
    }

    const metadata = await createSessionOnDisk(name);
    await refreshSessions();
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });

    // Load empty workspaces for new session
    await onSessionLoad({}, 1, new Map(), new Map(), metadata.id, { allowPrune: false });

    return metadata;
  };

  const switchSessionInternal = async (
    id: SessionId,
    options: { skipSave?: boolean; skipBeforeSwitch?: boolean } = {}
  ): Promise<void> => {
    const state = getState();
    if (id === state.activeSessionId) return;

    // Save current session
    if (state.activeSession && state.activeSessionId) {
      const workspaces = getWorkspaces();
      const activeWorkspaceId = getActiveWorkspaceId();
      if (!options.skipSave && shouldPersistSession(workspaces)) {
        await saveCurrentSession(
          state.activeSession,
          workspaces,
          activeWorkspaceId,
          getCwd
        );
      }

      // Suspend PTYs for current session (save mapping, don't destroy)
      if (!options.skipBeforeSwitch) {
        await onBeforeSwitch(state.activeSessionId);
      }
    }

    // Mark switching in progress to prevent "No panes" flash
    dispatch({ type: 'SET_SWITCHING', switching: true });

    try {
      // Load new session
      await switchToSession(id);
      const data = await loadSessionData(id);

      if (data) {
        dispatch({ type: 'SET_ACTIVE_SESSION', id, session: data.metadata });
        // IMPORTANT: Await onSessionLoad to ensure CWD map is set before switching completes
        await onSessionLoad(
          data.workspaces,
          data.activeWorkspaceId,
          data.cwdMap,
          new Map(),
          id,
          { allowPrune: true }
        );
      } else {
        // Load failure - keep layout consistent by clearing to an empty session
        const fallbackSession = state.sessions.find((session) => session.id === id);
        if (fallbackSession) {
          dispatch({ type: 'SET_ACTIVE_SESSION', id, session: fallbackSession });
        }
        await onSessionLoad({}, 1, new Map(), new Map(), id, { allowPrune: false });
      }

      dispatch({ type: 'CLOSE_SESSION_PICKER' });
      await refreshSessions();
    } finally {
      // Mark switching complete
      dispatch({ type: 'SET_SWITCHING', switching: false });
    }
  };

  const switchSession = async (id: SessionId): Promise<void> =>
    switchSessionInternal(id);

  const renameSession = async (id: SessionId, name: string): Promise<void> => {
    await renameSessionOnDisk(id, name);
    await refreshSessions();

    const state = getState();
    if (state.activeSessionId === id && state.activeSession) {
      dispatch({
        type: 'SET_ACTIVE_SESSION',
        id,
        session: { ...state.activeSession, name, autoNamed: false },
      });
    }

    dispatch({ type: 'CANCEL_RENAME' });
  };

  const deleteSession = async (id: SessionId): Promise<void> => {
    const state = getState();
    const isActive = state.activeSessionId === id;
    if (isActive) {
      dispatch({ type: 'SET_SWITCHING', switching: true });
    }

    try {
      // If deleting the active session, suspend before cleanup to capture PTYs.
      if (isActive && state.activeSessionId) {
        await onBeforeSwitch(state.activeSessionId);
      }

      // Clean up PTYs for the deleted session
      onDeleteSession(id);

      await deleteSessionOnDisk(id);
      await refreshSessions();

      // If deleting active session, switch to another
      if (isActive) {
        const sessions = await listSessions();
        const nextSession = sessions.find((session) => session.id !== id) ?? null;
        if (nextSession) {
          await switchSessionInternal(nextSession.id, { skipSave: true, skipBeforeSwitch: true });
        } else {
          const metadata = await createSessionOnDisk();
          dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
          await onSessionLoad({}, 1, new Map(), new Map(), metadata.id, { allowPrune: false });
          await refreshSessions();
        }
      }
    } finally {
      if (isActive) {
        dispatch({ type: 'SET_SWITCHING', switching: false });
      }
    }
  };

  const saveSession = async (): Promise<void> => {
    const state = getState();
    if (!state.activeSession) return;

    const workspaces = getWorkspaces();
    const activeWorkspaceId = getActiveWorkspaceId();

    if (shouldPersistSession(workspaces)) {
      await saveCurrentSession(
        state.activeSession,
        workspaces,
        activeWorkspaceId,
        getCwd
      );
      await refreshSessions();
    }
  };

  return {
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
  };
}
