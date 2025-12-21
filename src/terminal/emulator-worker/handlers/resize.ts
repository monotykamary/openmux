import type { WorkerSession } from '../types';
import { sendError } from '../helpers';
import { sendFullUpdate } from '../updates';
import { getModes } from '../helpers';

/**
 * Handle terminal resize
 */
export function handleResize(
  sessionId: string,
  cols: number,
  rows: number,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId);
    return;
  }

  try {
    session.terminal.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;

    sendFullUpdate(sessionId, session);
  } catch (error) {
    sendError(`Resize failed: ${error}`, sessionId);
  }
}

/**
 * Handle terminal reset
 */
export function handleReset(
  sessionId: string,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId);
    return;
  }

  try {
    session.terminal.write('\x1bc');
    session.currentTitle = '';
    session.scrollbackCache.clear();
    session.lastModes = getModes(session.terminal);

    sendFullUpdate(sessionId, session);
  } catch (error) {
    sendError(`Reset failed: ${error}`, sessionId);
  }
}
