import type { SessionId, SessionMetadata, WorkspaceId } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { SessionAction, SessionSummary } from '../../core/operations/session-actions';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  getActiveSessionIdLegacy as getActiveSessionId,
  switchToSession,
  loadSessionData,
  getSessionSummary,
} from '../../effect/bridge';

export function createSessionRefresher(dispatch: (action: SessionAction) => void) {
  return async () => {
    const sessions = await listSessions();
    dispatch({ type: 'SET_SESSIONS', sessions });

    const summaries = new Map<SessionId, SessionSummary>();
    for (const session of sessions) {
      const summary = await getSessionSummary(session.id);
      if (summary) {
        summaries.set(session.id, summary);
      }
    }
    dispatch({ type: 'SET_SUMMARIES', summaries });
  };
}

interface InitializeSessionParams {
  refreshSessions: () => Promise<void>;
  dispatch: (action: SessionAction) => void;
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    sessionId: string
  ) => Promise<void>;
}

export async function initializeSessionContext(params: InitializeSessionParams): Promise<void> {
  const { refreshSessions, dispatch, onSessionLoad } = params;

  await refreshSessions();

  let activeId = await getActiveSessionId();
  const sessions = await listSessions();

  if (!activeId && sessions.length === 0) {
    const metadata = await createSessionOnDisk();
    activeId = metadata.id;
    dispatch({ type: 'SET_SESSIONS', sessions: [metadata] });
    dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
  } else if (activeId) {
    const session = sessions.find(s => s.id === activeId);
    if (session) {
      dispatch({ type: 'SET_ACTIVE_SESSION', id: activeId, session });

      await switchToSession(activeId);
      await refreshSessions();

      const data = await loadSessionData(activeId);
      if (data && Object.keys(data.workspaces).length > 0) {
        await onSessionLoad(data.workspaces, data.activeWorkspaceId, data.cwdMap, activeId);
      }
    }
  }
}

export type { SessionMetadata };
