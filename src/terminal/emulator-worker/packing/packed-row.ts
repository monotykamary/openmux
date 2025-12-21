import { CellFlags, type GhosttyCell } from 'ghostty-web';
import type { TerminalColors } from '../../terminal-colors';
import { extractRgb } from '../../terminal-colors';
import { isZeroWidthChar, isSpaceLikeChar, isCjkIdeograph } from '../../ghostty-emulator/codepoint-utils';
import {
  DEFAULT_CODEPOINT,
  INVISIBLE_FLAG,
  PACKED_CELL_U32_STRIDE,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
  normalizeColor,
  normalizeCodepoint,
} from './constants';

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
