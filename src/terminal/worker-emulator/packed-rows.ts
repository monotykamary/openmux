import type { TerminalCell, PackedRowUpdate } from '../../core/types';
import type { ScrollbackCache } from './index';

const PACKED_CELL_U32_STRIDE = 12;
const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4;
const DEFAULT_CODEPOINT = 0x20;
const ATTR_BOLD = 1;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_STRIKETHROUGH = 128;

interface OverlayScratchState {
  overlayIndexScratch: Int32Array | null;
  overlayIndexCols: number;
}

export interface LivePackedState extends OverlayScratchState {
  rows: number;
  livePackedCache: Array<PackedRowUpdate | null>;
  livePackedCols: number;
}

export interface ScrollbackPackedState extends OverlayScratchState {
  scrollbackPackedCache: ScrollbackCache<PackedRowUpdate>;
  scrollbackPackedCols: number;
}

export function createPackedRowEntry(cols: number): PackedRowUpdate {
  return {
    cols,
    rowIndices: new Uint16Array(1),
    data: new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE),
    overlayRowStarts: new Uint32Array(2),
    overlayX: new Int32Array(cols),
    overlayCodepoint: new Uint32Array(cols),
    overlayAttributes: new Uint8Array(cols),
    overlayFg: new Uint8Array(cols * 4),
    overlayBg: new Uint8Array(cols * 4),
  };
}

function ensureOverlayIndexScratch(state: OverlayScratchState, cols: number): Int32Array {
  if (!state.overlayIndexScratch || state.overlayIndexCols !== cols) {
    state.overlayIndexScratch = new Int32Array(cols);
    state.overlayIndexCols = cols;
  }
  state.overlayIndexScratch.fill(-1);
  return state.overlayIndexScratch;
}

function updatePackedRowEntry(
  entry: PackedRowUpdate,
  packedRows: PackedRowUpdate,
  rowOffset: number
): void {
  const cols = packedRows.cols;
  const rowStride = cols * PACKED_CELL_BYTE_STRIDE;
  const dataBytes = new Uint8Array(packedRows.data);
  const destBytes = new Uint8Array(entry.data);
  const srcOffset = rowOffset * rowStride;
  destBytes.set(dataBytes.subarray(srcOffset, srcOffset + rowStride));

  const start = packedRows.overlayRowStarts[rowOffset] ?? 0;
  const end = packedRows.overlayRowStarts[rowOffset + 1] ?? start;
  const overlayCount = Math.min(end - start, entry.overlayX.length);
  entry.overlayRowStarts[0] = 0;
  entry.overlayRowStarts[1] = overlayCount;

  if (overlayCount > 0) {
    entry.overlayX.set(packedRows.overlayX.subarray(start, start + overlayCount), 0);
    entry.overlayCodepoint.set(
      packedRows.overlayCodepoint.subarray(start, start + overlayCount),
      0
    );
    entry.overlayAttributes.set(
      packedRows.overlayAttributes.subarray(start, start + overlayCount),
      0
    );
    const colorOffset = start * 4;
    const colorLength = overlayCount * 4;
    entry.overlayFg.set(
      packedRows.overlayFg.subarray(colorOffset, colorOffset + colorLength),
      0
    );
    entry.overlayBg.set(
      packedRows.overlayBg.subarray(colorOffset, colorOffset + colorLength),
      0
    );
  }

  entry.rowIndices[0] = packedRows.rowIndices[rowOffset] ?? 0;
}

export function applyPackedRowsToLiveCache(
  state: LivePackedState,
  packedRows: PackedRowUpdate
): void {
  const rowCount = packedRows.rowIndices.length;
  if (rowCount === 0) return;

  const cols = packedRows.cols;
  if (state.livePackedCols !== cols || state.livePackedCache.length !== state.rows) {
    state.livePackedCols = cols;
    state.livePackedCache = new Array(state.rows).fill(null);
  }

  for (let i = 0; i < rowCount; i++) {
    const rowIndex = packedRows.rowIndices[i];
    if (rowIndex < 0 || rowIndex >= state.rows) continue;

    let entry = state.livePackedCache[rowIndex];
    if (!entry || entry.cols !== cols) {
      entry = createPackedRowEntry(cols);
      state.livePackedCache[rowIndex] = entry;
    }
    updatePackedRowEntry(entry, packedRows, i);
  }
}

export function applyPackedRowsToScrollbackCache(
  state: ScrollbackPackedState,
  packedRows: PackedRowUpdate
): void {
  const rowCount = packedRows.rowIndices.length;
  if (rowCount === 0) return;

  const cols = packedRows.cols;
  if (state.scrollbackPackedCols !== cols) {
    state.scrollbackPackedCols = cols;
    state.scrollbackPackedCache.clear();
  }

  for (let i = 0; i < rowCount; i++) {
    const offset = packedRows.rowIndices[i];
    let entry = state.scrollbackPackedCache.get(offset);
    if (!entry || entry.cols !== cols) {
      entry = createPackedRowEntry(cols);
    }
    updatePackedRowEntry(entry, packedRows, i);
    state.scrollbackPackedCache.set(offset, entry);
  }
}

export function decodePackedRow(
  state: OverlayScratchState,
  entry: PackedRowUpdate,
  row?: TerminalCell[]
): TerminalCell[] {
  const cols = entry.cols;
  const overlayIndex = ensureOverlayIndexScratch(state, cols);
  const overlayCount = entry.overlayRowStarts[1] ?? 0;

  for (let i = 0; i < overlayCount; i++) {
    const x = entry.overlayX[i];
    if (x >= 0 && x < cols) {
      overlayIndex[x] = i;
    }
  }

  const cells = row ?? new Array(cols);
  if (cells.length !== cols) {
    cells.length = cols;
  }

  const packedFloats = new Float32Array(entry.data);
  const packedU32 = new Uint32Array(entry.data);

  for (let x = 0; x < cols; x++) {
    const overlayIdx = overlayIndex[x];
    let fgR = 0;
    let fgG = 0;
    let fgB = 0;
    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    let attributes = 0;
    let codepoint = DEFAULT_CODEPOINT;
    let width: 1 | 2 = 1;

    if (overlayIdx >= 0) {
      const overlayCodepoint = entry.overlayCodepoint[overlayIdx];
      codepoint = overlayCodepoint || DEFAULT_CODEPOINT;
      const fgOffset = overlayIdx * 4;
      fgR = entry.overlayFg[fgOffset] ?? 0;
      fgG = entry.overlayFg[fgOffset + 1] ?? 0;
      fgB = entry.overlayFg[fgOffset + 2] ?? 0;
      bgR = entry.overlayBg[fgOffset] ?? 0;
      bgG = entry.overlayBg[fgOffset + 1] ?? 0;
      bgB = entry.overlayBg[fgOffset + 2] ?? 0;
      attributes = entry.overlayAttributes[overlayIdx] ?? 0;

      const nextIdx = x + 1 < cols ? overlayIndex[x + 1] : -1;
      if (nextIdx >= 0 && entry.overlayCodepoint[nextIdx] === 0) {
        width = 2;
      }
      if (overlayCodepoint === 0) {
        codepoint = DEFAULT_CODEPOINT;
        width = 1;
      }
    } else {
      const base = x * PACKED_CELL_U32_STRIDE;
      bgR = Math.round(packedFloats[base] * 255);
      bgG = Math.round(packedFloats[base + 1] * 255);
      bgB = Math.round(packedFloats[base + 2] * 255);
      fgR = Math.round(packedFloats[base + 4] * 255);
      fgG = Math.round(packedFloats[base + 5] * 255);
      fgB = Math.round(packedFloats[base + 6] * 255);
      const baseCodepoint = packedU32[base + 8];
      codepoint = baseCodepoint || DEFAULT_CODEPOINT;
    }

    const char = codepoint > 0 ? String.fromCodePoint(codepoint) : ' ';
    const existing = cells[x];
    if (existing) {
      existing.char = char;
      existing.fg.r = fgR;
      existing.fg.g = fgG;
      existing.fg.b = fgB;
      existing.bg.r = bgR;
      existing.bg.g = bgG;
      existing.bg.b = bgB;
      existing.bold = (attributes & ATTR_BOLD) !== 0;
      existing.italic = (attributes & ATTR_ITALIC) !== 0;
      existing.underline = (attributes & ATTR_UNDERLINE) !== 0;
      existing.strikethrough = (attributes & ATTR_STRIKETHROUGH) !== 0;
      existing.inverse = false;
      existing.blink = false;
      existing.dim = false;
      existing.width = width;
      existing.hyperlinkId = undefined;
    } else {
      cells[x] = {
        char,
        fg: { r: fgR, g: fgG, b: fgB },
        bg: { r: bgR, g: bgG, b: bgB },
        bold: (attributes & ATTR_BOLD) !== 0,
        italic: (attributes & ATTR_ITALIC) !== 0,
        underline: (attributes & ATTR_UNDERLINE) !== 0,
        strikethrough: (attributes & ATTR_STRIKETHROUGH) !== 0,
        inverse: false,
        blink: false,
        dim: false,
        width,
      };
    }
  }

  return cells;
}
