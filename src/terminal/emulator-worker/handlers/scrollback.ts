import type { PackedRowUpdate } from '../../../core/types';
import type { WorkerSession } from '../types';
import { sendMessage, sendError } from '../helpers';
import {
  getPackedRowTransferables,
  clonePackedRowUpdate,
  packScrollbackLine,
  packScrollbackLines,
} from '../handler-utils';

const MAX_SCROLLBACK_CACHE = 1000;

/**
 * Handle get scrollback line request
 */
export function handleGetScrollbackLine(
  sessionId: string,
  offset: number,
  requestId: number,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendMessage({ type: 'scrollbackLine', requestId, packedRows: null });
    return;
  }

  try {
    const cached = session.scrollbackCache.get(offset);
    if (cached && cached.cols === session.cols) {
      const clone = clonePackedRowUpdate(cached);
      sendMessage(
        { type: 'scrollbackLine', requestId, packedRows: clone },
        getPackedRowTransferables(clone)
      );
      return;
    }

    const line = session.terminal.getScrollbackLine(offset);
    if (!line) {
      sendMessage({ type: 'scrollbackLine', requestId, packedRows: null });
      return;
    }

    const packed = packScrollbackLine(offset, line, session.cols, session.terminalColors);

    session.scrollbackCache.set(offset, packed);

    if (session.scrollbackCache.size > MAX_SCROLLBACK_CACHE) {
      const firstKey = session.scrollbackCache.keys().next().value;
      if (firstKey !== undefined) {
        session.scrollbackCache.delete(firstKey);
      }
    }

    const clone = clonePackedRowUpdate(packed);
    sendMessage(
      { type: 'scrollbackLine', requestId, packedRows: clone },
      getPackedRowTransferables(clone)
    );
  } catch (error) {
    sendError(`GetScrollbackLine failed: ${error}`, sessionId, requestId);
  }
}

/**
 * Handle get multiple scrollback lines request
 */
export function handleGetScrollbackLines(
  sessionId: string,
  startOffset: number,
  count: number,
  requestId: number,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendMessage({ type: 'scrollbackLines', requestId, packedRows: null });
    return;
  }

  try {
    const entries: PackedRowUpdate[] = [];

    for (let i = 0; i < count; i++) {
      const offset = startOffset + i;
      const cached = session.scrollbackCache.get(offset);
      if (cached && cached.cols === session.cols) {
        entries.push(cached);
        continue;
      }
      const line = session.terminal.getScrollbackLine(offset);
      if (!line) break;

      const packed = packScrollbackLine(offset, line, session.cols, session.terminalColors);
      session.scrollbackCache.set(offset, packed);
      entries.push(packed);
    }

    if (session.scrollbackCache.size > MAX_SCROLLBACK_CACHE) {
      const firstKey = session.scrollbackCache.keys().next().value;
      if (firstKey !== undefined) {
        session.scrollbackCache.delete(firstKey);
      }
    }

    const packedRows = packScrollbackLines(entries, session.cols);
    if (!packedRows) {
      sendMessage({ type: 'scrollbackLines', requestId, packedRows: null });
      return;
    }

    sendMessage(
      { type: 'scrollbackLines', requestId, packedRows },
      getPackedRowTransferables(packedRows)
    );
  } catch (error) {
    sendError(`GetScrollbackLines failed: ${error}`, sessionId, requestId);
  }
}
