/**
 * Update functions for the Emulator Worker
 */

import type { TerminalScrollState } from '../../core/types';
import type { WorkerSession } from './types';
import { sendMessage, getModes } from './helpers';
import { CELL_SIZE, getTransferables } from '../cell-serialization';
import { packGhosttyLineInto, packGhosttyTerminalState } from './packing';

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
  const dirtyRowData = new ArrayBuffer(rowCount * cols * CELL_SIZE);
  const view = new DataView(dirtyRowData);
  let index = 0;
  let offset = 0;

  if (entries) {
    for (const [y, line] of entries) {
      dirtyRowIndices[index++] = y;
      packGhosttyLineInto(view, offset, line, cols, terminalColors);
      offset += cols * CELL_SIZE;
    }
  } else {
    for (const [y, line] of ghosttyDirty) {
      dirtyRowIndices[index++] = y;
      packGhosttyLineInto(view, offset, line, cols, terminalColors);
      offset += cols * CELL_SIZE;
    }
  }

  terminal.clearDirty();

  const packed = {
    dirtyRowIndices,
    dirtyRowData,
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
    cursorKeyMode: session.lastModes.cursorKeyMode === 'application' ? 1 : 0,
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
    cursorKeyMode: modes.cursorKeyMode === 'application' ? 1 : 0,
    inBandResize: modes.inBandResize,
  };
  const transferables = getTransferables(packed);
  sendMessage({ type: 'update', sessionId, update: packed }, transferables);
}
