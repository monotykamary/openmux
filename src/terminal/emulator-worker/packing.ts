/**
 * Packed cell writers for worker-side updates.
 * Avoids per-cell TerminalCell allocations in the worker.
 */

import { CellFlags, type GhosttyCell, type GhosttyTerminal } from 'ghostty-web';
import type { TerminalModes } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { extractRgb } from '../terminal-colors';
import { CELL_SIZE, STATE_HEADER_SIZE } from '../cell-serialization';
import { isZeroWidthChar, isSpaceLikeChar, isCjkIdeograph } from '../ghostty-emulator/codepoint-utils';

const DEFAULT_CODEPOINT = 0x20;
const INVISIBLE_FLAG = 32;

const normalizeColor = (value: number): number =>
  typeof value === 'number' && !Number.isNaN(value) ? value : 0;

const normalizeCodepoint = (codepoint: number): number => {
  const cp = codepoint;
  if (typeof cp !== 'number' || cp < 0x20) return DEFAULT_CODEPOINT;
  if (cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xd7ff) return cp;
  if (cp >= 0xe000 && cp <= 0xfffd && cp !== 0xfffd) return cp;
  if (cp >= 0x10000 && cp <= 0xcffff) return cp;
  if (cp >= 0xe0000 && cp <= 0xeffff) return cp;
  if (cp >= 0xf0000 && cp <= 0xfffff) return cp;
  return DEFAULT_CODEPOINT;
};

const writeCell = (
  view: DataView,
  offset: number,
  codepoint: number,
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
  flags: number,
  width: number,
  hyperlinkId: number
) => {
  view.setUint32(offset, codepoint, true);
  view.setUint8(offset + 4, fgR);
  view.setUint8(offset + 5, fgG);
  view.setUint8(offset + 6, fgB);
  view.setUint8(offset + 7, bgR);
  view.setUint8(offset + 8, bgG);
  view.setUint8(offset + 9, bgB);
  view.setUint16(offset + 10, flags, true);
  view.setUint8(offset + 12, width);
  view.setUint16(offset + 13, hyperlinkId, true);
  view.setUint8(offset + 15, 0);
};

export function packGhosttyLineInto(
  view: DataView,
  offset: number,
  line: GhosttyCell[] | null,
  cols: number,
  colors: TerminalColors
): void {
  const defaultFg = extractRgb(colors.foreground);
  const defaultBg = extractRgb(colors.background);
  const defaultFgR = defaultFg.r;
  const defaultFgG = defaultFg.g;
  const defaultFgB = defaultFg.b;
  const defaultBgR = defaultBg.r;
  const defaultBgG = defaultBg.g;
  const defaultBgB = defaultBg.b;

  if (!line) {
    for (let x = 0; x < cols; x++) {
      writeCell(
        view,
        offset + x * CELL_SIZE,
        DEFAULT_CODEPOINT,
        defaultFgR,
        defaultFgG,
        defaultFgB,
        defaultBgR,
        defaultBgG,
        defaultBgB,
        0,
        1,
        0
      );
    }
    return;
  }

  const lineLength = Math.min(line.length, cols);

  for (let x = 0; x < lineLength; x++) {
    const cell = line[x];
    const fgR = normalizeColor(cell.fg_r);
    const fgG = normalizeColor(cell.fg_g);
    const fgB = normalizeColor(cell.fg_b);
    const bgR = normalizeColor(cell.bg_r);
    const bgG = normalizeColor(cell.bg_g);
    const bgB = normalizeColor(cell.bg_b);

    let codepoint = cell.codepoint;
    let flags = 0;
    let width = 1;
    let hyperlinkId = 0;
    let outFgR = fgR;
    let outFgG = fgG;
    let outFgB = fgB;
    let outBgR = bgR;
    let outBgG = bgG;
    let outBgB = bgB;

    if (isZeroWidthChar(codepoint)) {
      codepoint = DEFAULT_CODEPOINT;
      flags = 0;
      width = 1;
      outFgR = bgR;
      outFgG = bgG;
      outFgB = bgB;
    } else if (isSpaceLikeChar(codepoint)) {
      codepoint = DEFAULT_CODEPOINT;
      flags =
        (cell.flags & CellFlags.BOLD ? 1 : 0) |
        (cell.flags & CellFlags.ITALIC ? 2 : 0) |
        (cell.flags & CellFlags.UNDERLINE ? 4 : 0) |
        (cell.flags & CellFlags.STRIKETHROUGH ? 8 : 0) |
        (cell.flags & CellFlags.INVERSE ? 16 : 0) |
        (cell.flags & CellFlags.BLINK ? 32 : 0) |
        (cell.flags & CellFlags.FAINT ? 64 : 0);
      width = 1;
    } else if (cell.width === 0) {
      codepoint = DEFAULT_CODEPOINT;
      flags = 0;
      width = 1;
    } else if (isCjkIdeograph(codepoint) && cell.width !== 2) {
      codepoint = DEFAULT_CODEPOINT;
      flags = 0;
      width = 1;
    } else {
      const isInvisible = (cell.flags & INVISIBLE_FLAG) !== 0;
      codepoint = isInvisible ? DEFAULT_CODEPOINT : normalizeCodepoint(codepoint);
      flags =
        (cell.flags & CellFlags.BOLD ? 1 : 0) |
        (cell.flags & CellFlags.ITALIC ? 2 : 0) |
        (cell.flags & CellFlags.UNDERLINE ? 4 : 0) |
        (cell.flags & CellFlags.STRIKETHROUGH ? 8 : 0) |
        (cell.flags & CellFlags.INVERSE ? 16 : 0) |
        (cell.flags & CellFlags.BLINK ? 32 : 0) |
        (cell.flags & CellFlags.FAINT ? 64 : 0);
      width = cell.width === 2 ? 2 : 1;
      hyperlinkId = cell.hyperlink_id ?? 0;
    }

    writeCell(
      view,
      offset + x * CELL_SIZE,
      codepoint,
      outFgR,
      outFgG,
      outFgB,
      outBgR,
      outBgG,
      outBgB,
      flags,
      width,
      hyperlinkId
    );
  }

  for (let x = lineLength; x < cols; x++) {
    writeCell(
      view,
      offset + x * CELL_SIZE,
      DEFAULT_CODEPOINT,
      defaultFgR,
      defaultFgG,
      defaultFgB,
      defaultBgR,
      defaultBgG,
      defaultBgB,
      0,
      1,
      0
    );
  }
}

export function packGhosttyLine(
  line: GhosttyCell[] | null,
  cols: number,
  colors: TerminalColors
): ArrayBuffer {
  const buffer = new ArrayBuffer(cols * CELL_SIZE);
  const view = new DataView(buffer);
  packGhosttyLineInto(view, 0, line, cols, colors);
  return buffer;
}

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
