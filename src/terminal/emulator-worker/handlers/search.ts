import type { SearchMatch } from '../../emulator-interface';
import type { WorkerSession } from '../types';
import { sendMessage, sendError, convertLine, extractLineText } from '../helpers';

/**
 * Handle search request
 */
export function handleSearch(
  sessionId: string,
  query: string,
  requestId: number,
  limit: number,
  sessions: Map<string, WorkerSession>
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    sendMessage({ type: 'searchResults', requestId, matches: [], hasMore: false });
    return;
  }

  try {
    const { terminal, cols, terminalColors } = session;
    const matches: SearchMatch[] = [];
    let hasMore = false;

    if (!query) {
      sendMessage({ type: 'searchResults', requestId, matches: [], hasMore: false });
      return;
    }

    const lowerQuery = query.toLowerCase();
    const scrollbackLength = terminal.getScrollbackLength();

    for (let offset = 0; offset < scrollbackLength; offset++) {
      if (matches.length >= limit) {
        hasMore = true;
        break;
      }

      const line = terminal.getScrollbackLine(offset);
      if (!line) continue;

      const cells = convertLine(line, cols, terminalColors);
      const text = extractLineText(cells).toLowerCase();

      let pos = 0;
      while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
        if (matches.length >= limit) {
          hasMore = true;
          break;
        }
        matches.push({
          lineIndex: offset,
          startCol: pos,
          endCol: pos + query.length,
        });
        pos += 1;
      }

      if (hasMore) break;
    }

    if (!hasMore) {
      const rows = session.rows;
      for (let y = 0; y < rows; y++) {
        const line = terminal.getLine(y);
        const cells = convertLine(line, cols, terminalColors);
        const text = extractLineText(cells).toLowerCase();

        let pos = 0;
        while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
          matches.push({
            lineIndex: scrollbackLength + y,
            startCol: pos,
            endCol: pos + query.length,
          });
          pos += 1;
        }
      }
    }

    sendMessage({ type: 'searchResults', requestId, matches, hasMore });
  } catch (error) {
    sendError(`Search failed: ${error}`, sessionId, requestId);
  }
}
