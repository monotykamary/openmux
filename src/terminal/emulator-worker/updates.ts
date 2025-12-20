/**
 * Update functions for the Emulator Worker
 */

import type { TerminalScrollState } from '../../core/types';
import type { WorkerSession } from './types';
import { sendMessage, getModes } from './helpers';
import { getTransferables } from '../cell-serialization';
import {
  packGhosttyTerminalState,
  packGhosttyLineIntoPackedRow,
  PACKED_CELL_BYTE_STRIDE,
} from './packing';

// Scrollback limit for detecting content shift at max capacity
const SCROLLBACK_LIMIT_VALUE = 2000;

/**
 * Check if modes changed and send notification if so
 */
export function checkModeChanges(sessionId: string, session: WorkerSession): void {
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
export function sendDirtyUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  // Get dirty lines from terminal
  const ghosttyDirty = terminal.getDirtyLines();
  const cursor = terminal.getCursor();

  // Build update
  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT_VALUE,
  };

  const dirtySize = typeof (ghosttyDirty as { size?: number }).size === 'number'
    ? (ghosttyDirty as { size: number }).size
    : undefined;
  const entries = dirtySize === undefined ? Array.from(ghosttyDirty) : null;
  const rowCount = dirtySize ?? entries?.length ?? 0;

  const dirtyRowIndices = new Uint16Array(rowCount);
  const dirtyRowData = new ArrayBuffer(0);
  const packedRowData = new ArrayBuffer(rowCount * cols * PACKED_CELL_BYTE_STRIDE);
  const packedFloats = new Float32Array(packedRowData);
  const packedU32 = new Uint32Array(packedRowData);
  const overlayCapacity = rowCount * cols;
  const overlayRowStarts = new Uint32Array(rowCount + 1);
  const overlayX = new Int32Array(overlayCapacity);
  const overlayCodepoint = new Uint32Array(overlayCapacity);
  const overlayAttributes = new Uint8Array(overlayCapacity);
  const overlayFg = new Uint8Array(overlayCapacity * 4);
  const overlayBg = new Uint8Array(overlayCapacity * 4);
  let index = 0;
  let overlayCount = 0;

  if (entries) {
    for (const [y, line] of entries) {
      const rowOffset = index;
      dirtyRowIndices[index++] = y;
      overlayRowStarts[rowOffset] = overlayCount;
      overlayCount = packGhosttyLineIntoPackedRow(
        line,
        cols,
        terminalColors,
        rowOffset,
        packedFloats,
        packedU32,
        overlayX,
        overlayCodepoint,
        overlayAttributes,
        overlayFg,
        overlayBg,
        overlayCount
      );
      overlayRowStarts[rowOffset + 1] = overlayCount;
    }
  } else {
    for (const [y, line] of ghosttyDirty) {
      const rowOffset = index;
      dirtyRowIndices[index++] = y;
      overlayRowStarts[rowOffset] = overlayCount;
      overlayCount = packGhosttyLineIntoPackedRow(
        line,
        cols,
        terminalColors,
        rowOffset,
        packedFloats,
        packedU32,
        overlayX,
        overlayCodepoint,
        overlayAttributes,
        overlayFg,
        overlayBg,
        overlayCount
      );
      overlayRowStarts[rowOffset + 1] = overlayCount;
    }
  }

  terminal.clearDirty();

  const packedRows = rowCount === 0 ? undefined : {
    cols,
    rowIndices: dirtyRowIndices,
    data: packedRowData,
    overlayRowStarts,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
  };

  const packed = {
    dirtyRowIndices,
    dirtyRowData,
    packedRows,
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
    },
    cols,
    rows,
    scrollbackLength: scrollState.scrollbackLength,
    isFull: false,
    alternateScreen: terminal.isAlternateScreen(),
    mouseTracking: session.lastModes.mouseTracking,
    cursorKeyMode: (session.lastModes.cursorKeyMode === 'application' ? 1 : 0) as 0 | 1,
    inBandResize: session.lastModes.inBandResize,
  };
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}

/**
 * Send full refresh update
 */
export function sendFullUpdate(sessionId: string, session: WorkerSession): void {
  const { terminal, cols, rows, terminalColors } = session;

  const cursor = terminal.getCursor();
  const modes = getModes(terminal);

  const fullStateData = packGhosttyTerminalState(
    terminal,
    cols,
    rows,
    terminalColors,
    { x: cursor.x, y: cursor.y, visible: cursor.visible },
    modes
  );

  terminal.clearDirty();

  const scrollbackLength = terminal.getScrollbackLength();
  const scrollState: TerminalScrollState = {
    viewportOffset: 0,
    scrollbackLength,
    isAtBottom: true,
    isAtScrollbackLimit: scrollbackLength >= SCROLLBACK_LIMIT_VALUE,
  };

  const packed = {
    dirtyRowIndices: new Uint16Array(0),
    dirtyRowData: new ArrayBuffer(0),
    cursor: {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
    },
    cols,
    rows,
    scrollbackLength: scrollState.scrollbackLength,
    isFull: true,
    fullStateData,
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: (modes.cursorKeyMode === 'application' ? 1 : 0) as 0 | 1,
    inBandResize: modes.inBandResize,
  };
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}
