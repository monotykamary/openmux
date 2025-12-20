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
const PACKED_CELL_U32_STRIDE = 12;
export const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4;
const ATTR_BOLD = 1;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_STRIKETHROUGH = 128;

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

export function packGhosttyLineIntoPackedRow(
  line: GhosttyCell[] | null,
  cols: number,
  colors: TerminalColors,
  rowOffset: number,
  packedFloats: Float32Array,
  packedU32: Uint32Array,
  overlayX: Int32Array,
  overlayCodepoint: Uint32Array,
  overlayAttributes: Uint8Array,
  overlayFg: Uint8Array,
  overlayBg: Uint8Array,
  overlayCount: number
): number {
  const defaultFg = extractRgb(colors.foreground);
  const defaultBg = extractRgb(colors.background);
  const defaultFgR = normalizeColor(defaultFg.r);
  const defaultFgG = normalizeColor(defaultFg.g);
  const defaultFgB = normalizeColor(defaultFg.b);
  const defaultBgR = normalizeColor(defaultBg.r);
  const defaultBgG = normalizeColor(defaultBg.g);
  const defaultBgB = normalizeColor(defaultBg.b);
  const defaultFgRf = defaultFgR / 255;
  const defaultFgGf = defaultFgG / 255;
  const defaultFgBf = defaultFgB / 255;
  const defaultBgRf = defaultBgR / 255;
  const defaultBgGf = defaultBgG / 255;
  const defaultBgBf = defaultBgB / 255;
  const overlayCapacity = overlayX.length;
  const lineLength = line ? Math.min(line.length, cols) : 0;
  const rowBase = rowOffset * cols * PACKED_CELL_U32_STRIDE;

  let pendingWide = false;
  let pendingWideBgR = defaultBgR;
  let pendingWideBgG = defaultBgG;
  let pendingWideBgB = defaultBgB;
  let pendingWideBgRf = defaultBgRf;
  let pendingWideBgGf = defaultBgGf;
  let pendingWideBgBf = defaultBgBf;

  const pushOverlay = (
    x: number,
    codepoint: number,
    fgR: number,
    fgG: number,
    fgB: number,
    bgR: number,
    bgG: number,
    bgB: number,
    attributes: number
  ) => {
    if (overlayCount >= overlayCapacity) return;
    overlayX[overlayCount] = x;
    overlayCodepoint[overlayCount] = codepoint;
    overlayAttributes[overlayCount] = attributes;
    const colorOffset = overlayCount * 4;
    overlayFg[colorOffset] = fgR;
    overlayFg[colorOffset + 1] = fgG;
    overlayFg[colorOffset + 2] = fgB;
    overlayFg[colorOffset + 3] = 255;
    overlayBg[colorOffset] = bgR;
    overlayBg[colorOffset + 1] = bgG;
    overlayBg[colorOffset + 2] = bgB;
    overlayBg[colorOffset + 3] = 255;
    overlayCount++;
  };

  for (let x = 0; x < cols; x++) {
    if (pendingWide) {
      const base = rowBase + x * PACKED_CELL_U32_STRIDE;
      packedFloats[base] = pendingWideBgRf;
      packedFloats[base + 1] = pendingWideBgGf;
      packedFloats[base + 2] = pendingWideBgBf;
      packedFloats[base + 3] = 1;
      packedFloats[base + 4] = pendingWideBgRf;
      packedFloats[base + 5] = pendingWideBgGf;
      packedFloats[base + 6] = pendingWideBgBf;
      packedFloats[base + 7] = 1;
      packedU32[base + 8] = DEFAULT_CODEPOINT;
      packedU32[base + 9] = 0;
      packedU32[base + 10] = 0;
      packedU32[base + 11] = 0;
      pushOverlay(x, 0, pendingWideBgR, pendingWideBgG, pendingWideBgB, pendingWideBgR, pendingWideBgG, pendingWideBgB, 0);
      pendingWide = false;
      continue;
    }

    const cell = line && x < lineLength ? line[x] : null;
    let fgR = defaultFgR;
    let fgG = defaultFgG;
    let fgB = defaultFgB;
    let bgR = defaultBgR;
    let bgG = defaultBgG;
    let bgB = defaultBgB;
    let fgRf = defaultFgRf;
    let fgGf = defaultFgGf;
    let fgBf = defaultFgBf;
    let bgRf = defaultBgRf;
    let bgGf = defaultBgGf;
    let bgBf = defaultBgBf;
    let codepoint = DEFAULT_CODEPOINT;
    let attributes = 0;
    let width = 1;
    let applyEffects = false;

    if (cell) {
      fgR = normalizeColor(cell.fg_r);
      fgG = normalizeColor(cell.fg_g);
      fgB = normalizeColor(cell.fg_b);
      bgR = normalizeColor(cell.bg_r);
      bgG = normalizeColor(cell.bg_g);
      bgB = normalizeColor(cell.bg_b);

      const bold = (cell.flags & CellFlags.BOLD) !== 0;
      const italic = (cell.flags & CellFlags.ITALIC) !== 0;
      const underline = (cell.flags & CellFlags.UNDERLINE) !== 0;
      const strikethrough = (cell.flags & CellFlags.STRIKETHROUGH) !== 0;
      const inverse = (cell.flags & CellFlags.INVERSE) !== 0;
      const dim = (cell.flags & CellFlags.FAINT) !== 0;
      const isInvisible = (cell.flags & INVISIBLE_FLAG) !== 0;

      if (isZeroWidthChar(cell.codepoint)) {
        codepoint = DEFAULT_CODEPOINT;
        fgR = bgR;
        fgG = bgG;
        fgB = bgB;
      } else if (isSpaceLikeChar(cell.codepoint)) {
        codepoint = DEFAULT_CODEPOINT;
        attributes =
          (bold ? ATTR_BOLD : 0) |
          (italic ? ATTR_ITALIC : 0) |
          (underline ? ATTR_UNDERLINE : 0) |
          (strikethrough ? ATTR_STRIKETHROUGH : 0);
        applyEffects = true;
      } else if (cell.width === 0) {
        codepoint = DEFAULT_CODEPOINT;
      } else if (isCjkIdeograph(cell.codepoint) && cell.width !== 2) {
        codepoint = DEFAULT_CODEPOINT;
      } else {
        codepoint = isInvisible ? DEFAULT_CODEPOINT : normalizeCodepoint(cell.codepoint);
        width = cell.width === 2 ? 2 : 1;
        attributes =
          (bold ? ATTR_BOLD : 0) |
          (italic ? ATTR_ITALIC : 0) |
          (underline ? ATTR_UNDERLINE : 0) |
          (strikethrough ? ATTR_STRIKETHROUGH : 0);
        applyEffects = true;
      }

      if (applyEffects) {
        if (dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }
        if (inverse) {
          const tmpR = fgR; fgR = bgR; bgR = tmpR;
          const tmpG = fgG; fgG = bgG; bgG = tmpG;
          const tmpB = fgB; fgB = bgB; bgB = tmpB;
        }
      }

      fgRf = fgR / 255;
      fgGf = fgG / 255;
      fgBf = fgB / 255;
      bgRf = bgR / 255;
      bgGf = bgG / 255;
      bgBf = bgB / 255;
    }

    let packedCodepoint = codepoint;
    const needsOverlay = attributes !== 0 || codepoint > 0x7f || width === 2;
    if (needsOverlay) {
      pushOverlay(x, codepoint, fgR, fgG, fgB, bgR, bgG, bgB, attributes);
      packedCodepoint = DEFAULT_CODEPOINT;
      if (width === 2) {
        pendingWide = true;
        pendingWideBgR = bgR;
        pendingWideBgG = bgG;
        pendingWideBgB = bgB;
        pendingWideBgRf = bgRf;
        pendingWideBgGf = bgGf;
        pendingWideBgBf = bgBf;
      }
    }

    const base = rowBase + x * PACKED_CELL_U32_STRIDE;
    packedFloats[base] = bgRf;
    packedFloats[base + 1] = bgGf;
    packedFloats[base + 2] = bgBf;
    packedFloats[base + 3] = 1;
    packedFloats[base + 4] = fgRf;
    packedFloats[base + 5] = fgGf;
    packedFloats[base + 6] = fgBf;
    packedFloats[base + 7] = 1;
    packedU32[base + 8] = packedCodepoint;
    packedU32[base + 9] = 0;
    packedU32[base + 10] = 0;
    packedU32[base + 11] = 0;
  }

  return overlayCount;
}
