/**
 * Session list/template refresh helpers.
 */

import type { SessionId, SessionMetadata } from '../core/types';
import type { SessionAction, SessionSummary } from '../core/operations/session-actions';
import type { TemplateSession } from '../effect/models';
import { deferNextTick } from '../core/scheduling';

const SUMMARY_BATCH_SIZE = 3;

export function createSessionRefreshers(params: {
  listSessions: () => Promise<SessionMetadata[]>;
  getSessionSummary: (id: SessionId) => Promise<SessionSummary | null>;
  dispatch: (action: SessionAction) => void;
  listTemplates: () => Promise<TemplateSession[]>;
  setTemplates: (templates: TemplateSession[]) => void;
}) {
  const refreshSessions = async () => {
    const sessions = await params.listSessions();
    params.dispatch({ type: 'SET_SESSIONS', sessions });

    const summaries = new Map<SessionId, SessionSummary>();
    if (sessions.length > 0) {
      let index = 0;
      await new Promise<void>((resolve) => {
        const runBatch = () => {
          const end = Math.min(index + SUMMARY_BATCH_SIZE, sessions.length);
          const batch = sessions.slice(index, end);
          index = end;

          Promise.all(
            batch.map(async (session) => {
              try {
                const summary = await params.getSessionSummary(session.id);
                if (summary) {
                  summaries.set(session.id, summary);
                }
              } catch {
                // Ignore summary errors for now.
              }
            })
          ).then(() => {
            if (index < sessions.length) {
              deferNextTick(runBatch);
              return;
            }
            resolve();
          });
        };

        runBatch();
      });
    }
    params.dispatch({ type: 'SET_SUMMARIES', summaries });
  };

  const refreshTemplates = async () => {
    const list = await params.listTemplates();
    params.setTemplates(list);
  };

  return { refreshSessions, refreshTemplates };
}
