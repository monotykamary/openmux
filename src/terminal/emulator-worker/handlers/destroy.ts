import type { WorkerSession } from '../types';
import { sendMessage, sendError } from '../helpers';

/**
 * Handle session destroy
 */
export function handleDestroy(
  sessionId: string,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  try {
    session.terminal.free();
    session.scrollbackCache.clear();
    sessions.delete(sessionId);
    sendMessage({ type: 'destroyed', sessionId });
  } catch (error) {
    sendError(`Destroy failed: ${error}`, sessionId);
  }
}
