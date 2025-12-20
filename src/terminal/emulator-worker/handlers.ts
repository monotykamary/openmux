/**
 * Message handlers for the Emulator Worker
 */

import { Ghostty } from 'ghostty-web';
import type { WorkerTerminalColors, SearchMatch } from '../emulator-interface';
import type { PackedRowUpdate } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import type { WorkerSession } from './types';
import { createTitleParser } from '../title-parser';
import {
  PACKED_CELL_BYTE_STRIDE,
  packGhosttyLineIntoPackedRow,
  packGhosttyTerminalState,
} from './packing';
import { sendMessage, sendError, convertLine, getModes, extractLineText } from './helpers';
import { checkModeChanges, sendDirtyUpdate, sendFullUpdate } from './updates';
import { stripProblematicOscSequences } from './osc-stripping';

// Threshold for yielding before large writes (64KB)
const LARGE_WRITE_THRESHOLD = 64 * 1024;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAX_SCROLLBACK_CACHE = 1000;

const getPackedRowTransferables = (packedRows: PackedRowUpdate): ArrayBuffer[] => {
  return [
    packedRows.rowIndices.buffer as ArrayBuffer,
    packedRows.data,
    packedRows.overlayRowStarts.buffer as ArrayBuffer,
    packedRows.overlayX.buffer as ArrayBuffer,
    packedRows.overlayCodepoint.buffer as ArrayBuffer,
    packedRows.overlayAttributes.buffer as ArrayBuffer,
    packedRows.overlayFg.buffer as ArrayBuffer,
    packedRows.overlayBg.buffer as ArrayBuffer,
  ];
};

const clonePackedRowUpdate = (packed: PackedRowUpdate): PackedRowUpdate => {
  return {
    cols: packed.cols,
    rowIndices: packed.rowIndices.slice(0),
    data: packed.data.slice(0),
    overlayRowStarts: packed.overlayRowStarts.slice(0),
    overlayX: packed.overlayX.slice(0),
    overlayCodepoint: packed.overlayCodepoint.slice(0),
    overlayAttributes: packed.overlayAttributes.slice(0),
    overlayFg: packed.overlayFg.slice(0),
    overlayBg: packed.overlayBg.slice(0),
  };
};

const packScrollbackLine = (
  offset: number,
  line: ReturnType<WorkerSession['terminal']['getScrollbackLine']>,
  cols: number,
  colors: TerminalColors
): PackedRowUpdate => {
  const rowIndices = new Uint16Array(1);
  rowIndices[0] = offset;
  const data = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
  const packedFloats = new Float32Array(data);
  const packedU32 = new Uint32Array(data);
  const overlayRowStarts = new Uint32Array(2);
  const overlayX = new Int32Array(cols);
  const overlayCodepoint = new Uint32Array(cols);
  const overlayAttributes = new Uint8Array(cols);
  const overlayFg = new Uint8Array(cols * 4);
  const overlayBg = new Uint8Array(cols * 4);
  overlayRowStarts[0] = 0;
  const overlayCount = packGhosttyLineIntoPackedRow(
    line,
    cols,
    colors,
    0,
    packedFloats,
    packedU32,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
    0
  );
  overlayRowStarts[1] = overlayCount;

  return {
    cols,
    rowIndices,
    data,
    overlayRowStarts,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
  };
};

const packScrollbackLines = (
  entries: PackedRowUpdate[],
  cols: number
): PackedRowUpdate | null => {
  const rowCount = entries.length;
  if (rowCount === 0) return null;

  const rowIndices = new Uint16Array(rowCount);
  const rowStride = cols * PACKED_CELL_BYTE_STRIDE;
  const data = new ArrayBuffer(rowCount * rowStride);
  const dataBytes = new Uint8Array(data);
  const overlayCapacity = rowCount * cols;
  const overlayRowStarts = new Uint32Array(rowCount + 1);
  const overlayX = new Int32Array(overlayCapacity);
  const overlayCodepoint = new Uint32Array(overlayCapacity);
  const overlayAttributes = new Uint8Array(overlayCapacity);
  const overlayFg = new Uint8Array(overlayCapacity * 4);
  const overlayBg = new Uint8Array(overlayCapacity * 4);

  let overlayCount = 0;
  for (let i = 0; i < rowCount; i++) {
    const entry = entries[i];
    rowIndices[i] = entry.rowIndices[0] ?? 0;
    dataBytes.set(new Uint8Array(entry.data), i * rowStride);

    overlayRowStarts[i] = overlayCount;
    const entryOverlayCount = entry.overlayRowStarts[1] ?? 0;
    if (entryOverlayCount > 0) {
      overlayX.set(entry.overlayX.subarray(0, entryOverlayCount), overlayCount);
      overlayCodepoint.set(entry.overlayCodepoint.subarray(0, entryOverlayCount), overlayCount);
      overlayAttributes.set(entry.overlayAttributes.subarray(0, entryOverlayCount), overlayCount);
      const colorOffset = overlayCount * 4;
      overlayFg.set(entry.overlayFg.subarray(0, entryOverlayCount * 4), colorOffset);
      overlayBg.set(entry.overlayBg.subarray(0, entryOverlayCount * 4), colorOffset);
    }
    overlayCount += entryOverlayCount;
    overlayRowStarts[i + 1] = overlayCount;
  }

  return {
    cols,
    rowIndices,
    data,
    overlayRowStarts,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
  };
};

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
    sendMessage({ type: 'scrollbackLine', requestId, packedRows: null });
    return;
  }

  try {
    // Check cache
    const cached = session.scrollbackCache.get(offset);
    if (cached && cached.cols === session.cols) {
      const clone = clonePackedRowUpdate(cached);
      sendMessage(
        { type: 'scrollbackLine', requestId, packedRows: clone },
        getPackedRowTransferables(clone)
      );
      return;
    }

    // Fetch from terminal
    const line = session.terminal.getScrollbackLine(offset);
    if (!line) {
      sendMessage({ type: 'scrollbackLine', requestId, packedRows: null });
      return;
    }

    const packed = packScrollbackLine(offset, line, session.cols, session.terminalColors);

    // Cache it
    session.scrollbackCache.set(offset, packed);

    // Limit cache size (simple LRU eviction)
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
