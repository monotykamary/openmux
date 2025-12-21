import type { WorkerSession } from '../types';
import { sendMessage, sendError, getModes } from '../helpers';
import { packGhosttyTerminalState } from '../packing';

/**
 * Handle get terminal state request
 */
export function handleGetTerminalState(
  sessionId: string,
  requestId: number,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId, requestId);
    return;
  }

  try {
    const { terminal, cols, rows, terminalColors } = session;
    const cursor = terminal.getCursor();
    const modes = getModes(terminal);
    const packed = packGhosttyTerminalState(
      terminal,
      cols,
      rows,
      terminalColors,
      { x: cursor.x, y: cursor.y, visible: cursor.visible },
      modes
    );
    sendMessage({ type: 'terminalState', requestId, state: packed }, [packed]);
  } catch (error) {
    sendError(`GetTerminalState failed: ${error}`, sessionId, requestId);
  }
}
