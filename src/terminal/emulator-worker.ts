/**
 * Emulator Worker - Web Worker for terminal emulation
 *
 * This worker handles all VT parsing using ghostty-web WASM,
 * freeing the main thread for smooth rendering and user interaction.
 *
 * Communication:
 * - Main thread sends: init, write, resize, reset, getScrollbackLine, search, destroy
 * - Worker sends: ready, update, titleChange, modeChange, scrollbackLine, searchResults, error
 */

import { Ghostty, type GhosttyTerminal } from 'ghostty-web';
import type {
  WorkerInbound,
  WorkerOutbound,
  WorkerTerminalColors,
  SearchMatch,
  TerminalModes,
} from './emulator-interface';
import type { TerminalCell, TerminalScrollState } from '../core/types';
import { createTitleParser } from './title-parser';
import {
  packCells,
  packDirtyUpdate,
  packTerminalState,
  getTransferables,
} from './cell-serialization';
import {
  convertLine as convertGhosttyLine,
  createEmptyRow,
} from './ghostty-emulator/cell-converter';
import type { TerminalColors } from './terminal-colors';

// ============================================================================
// Worker Session
// ============================================================================

// Scrollback limit constant - ghostty-web default
const SCROLLBACK_LIMIT = 2000;

interface WorkerSession {
  terminal: GhosttyTerminal;
  cols: number;
  rows: number;
  /** Worker colors in RGB object format */
  workerColors: WorkerTerminalColors;
  /** TerminalColors format for cell converter (0xRRGGBB) */
  terminalColors: TerminalColors;
  titleParser: ReturnType<typeof createTitleParser>;
  currentTitle: string;
  lastModes: TerminalModes;
  // Scrollback cache (LRU would be better, but Map is simpler for now)
  scrollbackCache: Map<number, ArrayBuffer>;
  // Track scrollback length for cache invalidation
  lastScrollbackLength: number;
}

// ============================================================================
// Global State
// ============================================================================

let ghostty: Ghostty | null = null;
const sessions = new Map<string, WorkerSession>();

// Typed self for worker context
declare const self: Worker;

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(msg: WorkerOutbound, transfer?: ArrayBuffer[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

function sendError(message: string, sessionId?: string, requestId?: number): void {
  sendMessage({ type: 'error', message, sessionId, requestId });
}

/**
 * Convert GhosttyCell line to TerminalCell array using the shared cell converter
 */
function convertLine(
  line: ReturnType<GhosttyTerminal['getLine']>,
  cols: number,
  colors: TerminalColors
): TerminalCell[] {
  if (!line) {
    return createEmptyRow(cols, colors);
  }
  return convertGhosttyLine(line, cols, colors);
}

/**
 * Extract text from a row of terminal cells, skipping wide character placeholders
 */
function extractLineText(cells: TerminalCell[]): string {
  const chars: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    chars.push(cells[i].char);
    // Skip placeholder for wide characters (width=2 takes two cells)
    if (cells[i].width === 2) {
      i++;
    }
  }
  return chars.join('');
}

/**
 * Get current terminal modes
 */
function getModes(terminal: GhosttyTerminal): TerminalModes {
  return {
    mouseTracking:
      terminal.getMode(1000, false) ||
      terminal.getMode(1002, false) ||
      terminal.getMode(1003, false),
    cursorKeyMode: terminal.getMode(1, false) ? 'application' : 'normal',
    alternateScreen: terminal.isAlternateScreen(),
    inBandResize: terminal.getMode(2048, false),
  };
}

/**
 * Check if modes changed and send notification if so
 */
function checkModeChanges(sessionId: string, session: WorkerSession): void {
  const newModes = getModes(session.terminal);
  if (
    newModes.mouseTracking !== session.lastModes.mouseTracking ||
    newModes.cursorKeyMode !== session.lastModes.cursorKeyMode ||
    newModes.alternateScreen !== session.lastModes.alternateScreen ||
    newModes.inBandResize !== session.lastModes.inBandResize
  ) {
    session.lastModes = newModes;
    sendMessage({ type: 'modeChange', sessionId, modes: newModes });
  }
}

/**
 * Build dirty update and send to main thread
 */
function sendDirtyUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  // Get dirty lines from terminal
  const ghosttyDirty = terminal.getDirtyLines();
  const cursor = terminal.getCursor();

  // Build dirty rows map
  const dirtyRows = new Map<number, TerminalCell[]>();
  for (const [y, line] of ghosttyDirty) {
    if (y >= 0 && y < rows) {
      dirtyRows.set(y, convertLine(line, cols, terminalColors));
    }
  }

  terminal.clearDirty();

  // Build update
  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT,
  };

  const update = {
    dirtyRows,
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block' as const,
    },
    scrollState,
    cols,
    rows,
    isFull: false,
    alternateScreen: terminal.isAlternateScreen(),
    mouseTracking: session.lastModes.mouseTracking,
    cursorKeyMode: session.lastModes.cursorKeyMode,
    inBandResize: session.lastModes.inBandResize,
  };

  // Pack and send
  const packed = packDirtyUpdate(update);
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}

/**
 * Send full refresh update
 */
function sendFullUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  // Build full cell grid
  const cells: TerminalCell[][] = [];
  for (let y = 0; y < rows; y++) {
    const line = terminal.getLine(y);
    cells.push(convertLine(line, cols, terminalColors));
  }

  terminal.clearDirty();

  const cursor = terminal.getCursor();
  const modes = getModes(terminal);

  const fullState = {
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

  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT,
  };

  const update = {
    dirtyRows: new Map<number, TerminalCell[]>(),
    cursor: fullState.cursor,
    scrollState,
    cols,
    rows,
    isFull: true,
    fullState,
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: modes.cursorKeyMode,
    inBandResize: modes.inBandResize,
  };

  const packed = packDirtyUpdate(update);
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}

// ============================================================================
// Message Handlers
// ============================================================================

async function handleInit(
  sessionId: string,
  cols: number,
  rows: number,
  colors: WorkerTerminalColors
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
 * Strip OSC sequences that can cause screen flash/flicker when processed by ghostty-web.
 *
 * Stripped sequences:
 * - OSC 0/1/2: Title sequences (handled by title parser)
 * - OSC 7: Working directory notification (not needed for rendering)
 * - OSC 10/11/12: Foreground/background/cursor color SET commands (can cause flash)
 * - OSC 22/23: Window icon / title stack (rarely used, can cause issues)
 *
 * Note: Query sequences (with ?) are handled by query passthrough on main thread.
 * This only strips SET commands that go directly to ghostty-web.
 *
 * Format: ESC]code;params BEL  or  ESC]code;params ESC\
 */
function stripProblematicOscSequences(text: string): string {
  const ESC = '\x1b';
  const BEL = '\x07';

  // OSC codes to strip - these can cause flash/flicker
  const stripCodes = new Set([
    0, 1, 2,    // Title sequences (handled by title parser)
    7,          // Working directory (CWD notification)
    10, 11, 12, // Foreground/background/cursor color (SET commands)
    22, 23,     // Window icon / title stack operations
  ]);

  let result = '';
  let i = 0;

  while (i < text.length) {
    // Check for OSC start (ESC])
    if (text[i] === ESC && i + 1 < text.length && text[i + 1] === ']') {
      let pos = i + 2;
      let codeStr = '';

      // Parse the OSC code number
      while (pos < text.length && /\d/.test(text[pos])) {
        codeStr += text[pos];
        pos++;
      }

      const code = parseInt(codeStr, 10);

      // Check if this is a code we should strip
      if (codeStr.length > 0 && stripCodes.has(code)) {
        // For OSC 10/11/12, only strip if it's a SET (not a query with ?)
        // Query format: OSC 10;? or OSC 10;?ST - these are handled by passthrough
        // Set format: OSC 10;colorspec - these cause flash
        const isColorCode = code === 10 || code === 11 || code === 12;

        if (isColorCode) {
          // Check if next char after code is ; then ?
          // If so, it's a query - don't strip (passthrough handles it)
          if (pos < text.length && text[pos] === ';') {
            if (pos + 1 < text.length && text[pos + 1] === '?') {
              // This is a query, don't strip - include the character and continue
              result += text[i];
              i++;
              continue;
            }
          }
        }

        // Find the terminator (BEL or ST) and skip entire sequence
        while (pos < text.length) {
          if (text[pos] === BEL) {
            // Found BEL terminator, skip entire sequence
            i = pos + 1;
            break;
          }
          if (text[pos] === ESC && pos + 1 < text.length && text[pos + 1] === '\\') {
            // Found ST terminator, skip entire sequence
            i = pos + 2;
            break;
          }
          pos++;
        }

        // If we found and skipped the sequence, continue
        if (i > pos - 1) {
          continue;
        }
        // If no terminator found, include the partial sequence
        // (it will be completed in a future write)
      }
    }

    // Not a stripped sequence, include the character
    result += text[i];
    i++;
  }

  return result;
}

// Threshold for yielding before large writes (64KB)
const LARGE_WRITE_THRESHOLD = 64 * 1024;

async function handleWrite(sessionId: string, data: ArrayBuffer): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId);
    return;
  }

  try {
    // Parse for title changes (needs to see full data including OSC 0/1/2)
    const text = new TextDecoder().decode(data);
    session.titleParser.processData(text);

    // Strip problematic OSC sequences before sending to ghostty-web to prevent flash
    const strippedText = stripProblematicOscSequences(text);

    // Write to terminal (with title sequences removed)
    if (strippedText.length > 0) {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(strippedText);

      // Yield before large writes to allow GC and prevent memory pressure
      if (encoded.length > LARGE_WRITE_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      session.terminal.write(encoded);
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

function handleResize(sessionId: string, cols: number, rows: number): void {
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

function handleReset(sessionId: string): void {
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

function handleGetScrollbackLine(sessionId: string, offset: number, requestId: number): void {
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

function handleGetScrollbackLines(
  sessionId: string,
  startOffset: number,
  count: number,
  requestId: number
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

function handleGetTerminalState(sessionId: string, requestId: number): void {
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

function handleSearch(
  sessionId: string,
  query: string,
  requestId: number,
  limit = 500
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

function handleDestroy(sessionId: string): void {
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

// ============================================================================
// Main Message Handler
// ============================================================================

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init':
      await handleInit(msg.sessionId, msg.cols, msg.rows, msg.colors);
      break;

    case 'write':
      await handleWrite(msg.sessionId, msg.data);
      break;

    case 'resize':
      handleResize(msg.sessionId, msg.cols, msg.rows);
      break;

    case 'reset':
      handleReset(msg.sessionId);
      break;

    case 'getScrollbackLine':
      handleGetScrollbackLine(msg.sessionId, msg.offset, msg.requestId);
      break;

    case 'getScrollbackLines':
      handleGetScrollbackLines(msg.sessionId, msg.startOffset, msg.count, msg.requestId);
      break;

    case 'getTerminalState':
      handleGetTerminalState(msg.sessionId, msg.requestId);
      break;

    case 'search':
      handleSearch(msg.sessionId, msg.query, msg.requestId, msg.limit);
      break;

    case 'destroy':
      handleDestroy(msg.sessionId);
      break;

    default:
      sendError(`Unknown message type: ${(msg as { type: string }).type}`);
  }
};

// ============================================================================
// Initialization
// ============================================================================

async function init(): Promise<void> {
  try {
    ghostty = await Ghostty.load();
    sendMessage({ type: 'ready' });
  } catch (error) {
    sendError(`Failed to initialize ghostty: ${error}`);
  }
}

init();
