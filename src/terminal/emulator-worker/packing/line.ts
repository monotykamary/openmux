import { CellFlags, type GhosttyCell } from 'ghostty-web';
import type { TerminalColors } from '../../terminal-colors';
import { extractRgb } from '../../terminal-colors';
import { CELL_SIZE } from '../../cell-serialization';
import { isZeroWidthChar, isSpaceLikeChar, isCjkIdeograph } from '../../ghostty-emulator/codepoint-utils';
import {
  DEFAULT_CODEPOINT,
  INVISIBLE_FLAG,
  normalizeColor,
  normalizeCodepoint,
  writeCell,
} from './constants';

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
