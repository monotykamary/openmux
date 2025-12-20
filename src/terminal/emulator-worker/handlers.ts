/**
 * Message handlers for the Emulator Worker
 */

import { Ghostty, type GhosttyTerminal } from 'ghostty-web';
import type { WorkerTerminalColors, SearchMatch } from '../emulator-interface';
import type { TerminalCell, TerminalScrollState } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import type { WorkerSession } from './types';
import { SCROLLBACK_LIMIT } from './types';
import { createTitleParser } from '../title-parser';
import { packCells, packTerminalState } from '../cell-serialization';
import { sendMessage, sendError, convertLine, getModes, extractLineText } from './helpers';
import { checkModeChanges, sendDirtyUpdate, sendFullUpdate } from './updates';
import { stripProblematicOscSequences } from './osc-stripping';

// Threshold for yielding before large writes (64KB)
const LARGE_WRITE_THRESHOLD = 64 * 1024;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function containsOscStart(bytes: Uint8Array): boolean {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5d) {
      return true;
    }
  }
  return false;
}

/**
 * Handle session initialization
 */
export async function handleInit(
  sessionId: string,
  cols: number,
  rows: number,
  colors: WorkerTerminalColors,
  ghostty: Ghostty | null,
  sessions: Map<string, WorkerSession>
): Promise<void> {
  if (!ghostty) {
    sendError('Ghostty not initialized', sessionId);
    return;
  }

  if (sessions.has(sessionId)) {
    sendError(`Session ${sessionId} already exists`, sessionId);
    return;
  }

  try {
    // Convert colors to ghostty format (0xRRGGBB)
    const fgColor = (colors.foreground.r << 16) | (colors.foreground.g << 8) | colors.foreground.b;
    const bgColor = (colors.background.r << 16) | (colors.background.g << 8) | colors.background.b;
    const palette = colors.palette.map(c => (c.r << 16) | (c.g << 8) | c.b);

    // Create TerminalColors format for cell converter
    const terminalColors: TerminalColors = {
      foreground: fgColor,
      background: bgColor,
      palette,
      isDefault: false,
    };

    const terminal = ghostty.createTerminal(cols, rows, {
      scrollbackLimit: 2000,
      bgColor,
      fgColor,
      palette,
    });

    const titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        const session = sessions.get(sessionId);
        if (session) {
          session.currentTitle = title;
          // Title notifications go to TitleContext (plain Map) which avoids
          // layout store updates that cause SolidJS reactivity cascades
          sendMessage({ type: 'titleChange', sessionId, title });
        }
      },
    });

    const session: WorkerSession = {
      terminal,
      cols,
      rows,
      workerColors: colors,
      terminalColors,
      titleParser,
      currentTitle: '',
      lastModes: getModes(terminal),
      scrollbackCache: new Map(),
      lastScrollbackLength: 0,
    };

    sessions.set(sessionId, session);

    // IMPORTANT: Clear the terminal buffer before reading initial state.
    // When WASM memory is reused after a terminal is freed, the new terminal's
    // buffer may contain stale data from the previous terminal. This causes
    // "smearing" artifacts where text from closed panes appears in new ones.
    // Writing a clear sequence ensures we start with a clean slate.
    // Using ED2 (clear entire screen) + CUP (cursor home) instead of RIS
    // to avoid side effects like resetting modes.
    terminal.write(new TextEncoder().encode('\x1b[2J\x1b[H'));
    terminal.clearDirty(); // Clear dirty flags from the clear operation

    sendMessage({ type: 'initialized', sessionId });

    // Send initial full state so main thread has valid state immediately
    sendFullUpdate(sessionId, session);
  } catch (error) {
    sendError(`Failed to create session: ${error}`, sessionId);
  }
}

/**
 * Handle write to terminal
 */
export async function handleWrite(
  sessionId: string,
  data: ArrayBuffer,
  sessions: Map<string, WorkerSession>
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId);
    return;
  }

  try {
    const bytes = new Uint8Array(data);
    const hasOscStart = containsOscStart(bytes);

    // Fast path: no OSC sequences and no pending OSC parse state.
    if (!hasOscStart && !session.titleParser.isInOscSequence()) {
      if (bytes.length > LARGE_WRITE_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      session.terminal.write(bytes);
    } else {
      // Parse for title changes (needs to see full data including OSC 0/1/2)
      const text = textDecoder.decode(bytes);
      session.titleParser.processData(text);

      // Strip problematic OSC sequences before sending to ghostty-web to prevent flash
      let outputBytes: Uint8Array | null = null;
      const strippedText = stripProblematicOscSequences(text);
      if (strippedText.length > 0) {
        outputBytes = strippedText === text ? bytes : textEncoder.encode(strippedText);
      }

      if (outputBytes && outputBytes.length > 0) {
        // Yield before large writes to allow GC and prevent memory pressure
        if (outputBytes.length > LARGE_WRITE_THRESHOLD) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        session.terminal.write(outputBytes);
      }
    }

    // Check for mode changes
    checkModeChanges(sessionId, session);

    // HYBRID FIX: Clear worker cache when scrollback length changes
    // This ensures the worker-side cache doesn't serve stale content
    const currentScrollbackLength = session.terminal.getScrollbackLength();
    if (currentScrollbackLength !== session.lastScrollbackLength) {
      session.scrollbackCache.clear();
      session.lastScrollbackLength = currentScrollbackLength;
    }

    // Send dirty update
    sendDirtyUpdate(sessionId, session);
  } catch (error) {
    sendError(`Write failed: ${error}`, sessionId);
  }
}

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

    // Don't clear scrollback cache on resize - ghostty handles reflow internally
    // and clearing causes flash when scrolled up. Cache will naturally refresh
    // as lines are re-fetched with new dimensions.

    // Send full refresh for visible terminal area
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
    // Send full reset sequence
    session.terminal.write('\x1bc');
    session.currentTitle = '';
    session.scrollbackCache.clear();
    session.lastModes = getModes(session.terminal);

    // Send full refresh
    sendFullUpdate(sessionId, session);
  } catch (error) {
    sendError(`Reset failed: ${error}`, sessionId);
  }
}

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
    sendMessage({ type: 'scrollbackLine', requestId, cells: null });
    return;
  }

  try {
    // Check cache
    const cached = session.scrollbackCache.get(offset);
    if (cached) {
      // Need to clone since we're transferring
      const clone = cached.slice(0);
      sendMessage({ type: 'scrollbackLine', requestId, cells: clone }, [clone]);
      return;
    }

    // Fetch from terminal
    const line = session.terminal.getScrollbackLine(offset);
    if (!line) {
      sendMessage({ type: 'scrollbackLine', requestId, cells: null });
      return;
    }

    const cells = convertLine(line, session.cols, session.terminalColors);
    const packed = packCells(cells);

    // Cache it
    session.scrollbackCache.set(offset, packed.slice(0));

    // Limit cache size (simple LRU eviction)
    if (session.scrollbackCache.size > 1000) {
      const firstKey = session.scrollbackCache.keys().next().value;
      if (firstKey !== undefined) {
        session.scrollbackCache.delete(firstKey);
      }
    }

    sendMessage({ type: 'scrollbackLine', requestId, cells: packed }, [packed]);
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
    sendMessage({ type: 'scrollbackLines', requestId, cells: [], offsets: [] });
    return;
  }

  try {
    const cells: ArrayBuffer[] = [];
    const offsets: number[] = [];

    for (let i = 0; i < count; i++) {
      const offset = startOffset + i;
      const line = session.terminal.getScrollbackLine(offset);
      if (!line) break;

      const converted = convertLine(line, session.cols, session.terminalColors);
      const packed = packCells(converted);
      cells.push(packed);
      offsets.push(offset);
    }

    sendMessage({ type: 'scrollbackLines', requestId, cells, offsets }, cells);
  } catch (error) {
    sendError(`GetScrollbackLines failed: ${error}`, sessionId, requestId);
  }
}

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

    const cells: TerminalCell[][] = [];
    for (let y = 0; y < rows; y++) {
      const line = terminal.getLine(y);
      cells.push(convertLine(line, cols, terminalColors));
    }

    const state = {
      cols,
      rows,
      cells,
      cursor: {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: 'block' as const,
      },
      alternateScreen: modes.alternateScreen,
      mouseTracking: modes.mouseTracking,
      cursorKeyMode: modes.cursorKeyMode,
    };

    const packed = packTerminalState(state);
    sendMessage({ type: 'terminalState', requestId, state: packed }, [packed]);
  } catch (error) {
    sendError(`GetTerminalState failed: ${error}`, sessionId, requestId);
  }
}

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

    // Search scrollback (from oldest to newest) with limit
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

    // Search visible area (always include, doesn't count toward limit)
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
