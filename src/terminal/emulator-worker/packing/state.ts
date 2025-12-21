import type { GhosttyTerminal } from 'ghostty-web';
import type { TerminalModes } from '../../emulator-interface';
import type { TerminalColors } from '../../terminal-colors';
import { CELL_SIZE, STATE_HEADER_SIZE } from '../../cell-serialization';
import { packGhosttyLineInto } from './line';

export function packGhosttyTerminalState(
  terminal: GhosttyTerminal,
  cols: number,
  rows: number,
  colors: TerminalColors,
  cursor: { x: number; y: number; visible: boolean },
  modes: TerminalModes
): ArrayBuffer {
  const cellCount = rows * cols;
  const buffer = new ArrayBuffer(STATE_HEADER_SIZE + cellCount * CELL_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, cols, true);
  view.setUint32(4, rows, true);
  view.setUint32(8, cursor.x, true);
  view.setUint32(12, cursor.y, true);
  view.setUint8(16, cursor.visible ? 1 : 0);
  view.setUint8(17, 0);
  view.setUint8(18, modes.alternateScreen ? 1 : 0);
  view.setUint8(19, modes.mouseTracking ? 1 : 0);
  view.setUint8(20, modes.cursorKeyMode === 'application' ? 1 : 0);

  let offset = STATE_HEADER_SIZE;
  for (let y = 0; y < rows; y++) {
    const line = terminal.getLine(y);
    packGhosttyLineInto(view, offset, line, cols, colors);
    offset += cols * CELL_SIZE;
  }

  return buffer;
}
