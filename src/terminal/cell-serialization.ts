/**
 * Cell Serialization Utilities
 *
 * Provides efficient binary packing/unpacking of terminal cells for
 * Web Worker communication via Transferable ArrayBuffers.
 *
 * Binary format per cell (16 bytes):
 * - bytes 0-3:   codepoint (u32, little-endian)
 * - byte 4:      fg_r
 * - byte 5:      fg_g
 * - byte 6:      fg_b
 * - byte 7:      bg_r
 * - byte 8:      bg_g
 * - byte 9:      bg_b
 * - bytes 10-11: flags (u16, little-endian)
 *                bit 0: bold
 *                bit 1: italic
 *                bit 2: underline
 *                bit 3: strikethrough
 *                bit 4: inverse
 *                bit 5: blink
 *                bit 6: dim
 * - byte 12:     width (1 or 2)
 * - bytes 13-14: hyperlinkId (u16, little-endian, 0 = none)
 * - byte 15:     padding (reserved)
 */

import type {
  TerminalCell,
  TerminalCursor,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from '../core/types';
import type { SerializedDirtyUpdate } from './emulator-interface';

// Constants
export const CELL_SIZE = 16; // bytes per cell

// Flag bit positions
const FLAG_BOLD = 1 << 0;
const FLAG_ITALIC = 1 << 1;
const FLAG_UNDERLINE = 1 << 2;
const FLAG_STRIKETHROUGH = 1 << 3;
const FLAG_INVERSE = 1 << 4;
const FLAG_BLINK = 1 << 5;
const FLAG_DIM = 1 << 6;

export interface RowCache {
  rows: number;
  cols: number;
  cells: TerminalCell[][];
}

// ============================================================================
// Cell Packing/Unpacking
// ============================================================================

/**
 * Pack a single cell into a DataView at the given offset
 */
function packCellAt(view: DataView, offset: number, cell: TerminalCell): void {
  // Codepoint (handle multi-codepoint chars by taking first)
  const codepoint = cell.char.codePointAt(0) ?? 0x20; // Default to space
  view.setUint32(offset, codepoint, true);

  // Foreground RGB
  view.setUint8(offset + 4, cell.fg.r);
  view.setUint8(offset + 5, cell.fg.g);
  view.setUint8(offset + 6, cell.fg.b);

  // Background RGB
  view.setUint8(offset + 7, cell.bg.r);
  view.setUint8(offset + 8, cell.bg.g);
  view.setUint8(offset + 9, cell.bg.b);

  // Flags
  let flags = 0;
  if (cell.bold) flags |= FLAG_BOLD;
  if (cell.italic) flags |= FLAG_ITALIC;
  if (cell.underline) flags |= FLAG_UNDERLINE;
  if (cell.strikethrough) flags |= FLAG_STRIKETHROUGH;
  if (cell.inverse) flags |= FLAG_INVERSE;
  if (cell.blink) flags |= FLAG_BLINK;
  if (cell.dim) flags |= FLAG_DIM;
  view.setUint16(offset + 10, flags, true);

  // Width
  view.setUint8(offset + 12, cell.width);

  // Hyperlink ID (0 = none)
  view.setUint16(offset + 13, cell.hyperlinkId ?? 0, true);

  // Padding (reserved)
  view.setUint8(offset + 15, 0);
}

/**
 * Unpack a single cell from a DataView at the given offset
 */
function unpackCellAt(view: DataView, offset: number): TerminalCell {
  // Codepoint
  const codepoint = view.getUint32(offset, true);
  const char = codepoint > 0 ? String.fromCodePoint(codepoint) : ' ';

  // Foreground RGB
  const fg = {
    r: view.getUint8(offset + 4),
    g: view.getUint8(offset + 5),
    b: view.getUint8(offset + 6),
  };

  // Background RGB
  const bg = {
    r: view.getUint8(offset + 7),
    g: view.getUint8(offset + 8),
    b: view.getUint8(offset + 9),
  };

  // Flags
  const flags = view.getUint16(offset + 10, true);
  const bold = (flags & FLAG_BOLD) !== 0;
  const italic = (flags & FLAG_ITALIC) !== 0;
  const underline = (flags & FLAG_UNDERLINE) !== 0;
  const strikethrough = (flags & FLAG_STRIKETHROUGH) !== 0;
  const inverse = (flags & FLAG_INVERSE) !== 0;
  const blink = (flags & FLAG_BLINK) !== 0;
  const dim = (flags & FLAG_DIM) !== 0;

  // Width
  const width = view.getUint8(offset + 12) as 1 | 2;

  // Hyperlink ID
  const hyperlinkId = view.getUint16(offset + 13, true);

  return {
    char,
    fg,
    bg,
    bold,
    italic,
    underline,
    strikethrough,
    inverse,
    blink,
    dim,
    width: width === 2 ? 2 : 1,
    hyperlinkId: hyperlinkId > 0 ? hyperlinkId : undefined,
  };
}

function createEmptyCell(): TerminalCell {
  return {
    char: ' ',
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}

function createRow(cols: number): TerminalCell[] {
  const row: TerminalCell[] = new Array(cols);
  for (let x = 0; x < cols; x++) {
    row[x] = createEmptyCell();
  }
  return row;
}

function updateCellFromView(view: DataView, offset: number, cell: TerminalCell): void {
  const codepoint = view.getUint32(offset, true);
  cell.char = codepoint > 0
    ? (codepoint <= 0xffff ? String.fromCharCode(codepoint) : String.fromCodePoint(codepoint))
    : ' ';

  cell.fg.r = view.getUint8(offset + 4);
  cell.fg.g = view.getUint8(offset + 5);
  cell.fg.b = view.getUint8(offset + 6);

  cell.bg.r = view.getUint8(offset + 7);
  cell.bg.g = view.getUint8(offset + 8);
  cell.bg.b = view.getUint8(offset + 9);

  const flags = view.getUint16(offset + 10, true);
  cell.bold = (flags & FLAG_BOLD) !== 0;
  cell.italic = (flags & FLAG_ITALIC) !== 0;
  cell.underline = (flags & FLAG_UNDERLINE) !== 0;
  cell.strikethrough = (flags & FLAG_STRIKETHROUGH) !== 0;
  cell.inverse = (flags & FLAG_INVERSE) !== 0;
  cell.blink = (flags & FLAG_BLINK) !== 0;
  cell.dim = (flags & FLAG_DIM) !== 0;

  const width = view.getUint8(offset + 12);
  cell.width = width === 2 ? 2 : 1;

  const hyperlinkId = view.getUint16(offset + 13, true);
  cell.hyperlinkId = hyperlinkId > 0 ? hyperlinkId : undefined;
}

function ensureRow(cache: RowCache, rowIndex: number): TerminalCell[] {
  const existing = cache.cells[rowIndex];
  if (existing && existing.length === cache.cols) {
    return existing;
  }

  const row = createRow(cache.cols);
  cache.cells[rowIndex] = row;
  return row;
}

function unpackRowInto(view: DataView, offset: number, row: TerminalCell[], cols: number): void {
  for (let x = 0; x < cols; x++) {
    const cellOffset = offset + x * CELL_SIZE;
    const cell = row[x] ?? createEmptyCell();
    updateCellFromView(view, cellOffset, cell);
    row[x] = cell;
  }
}

/**
 * Pack an array of cells into a transferable ArrayBuffer
 */
export function packCells(cells: TerminalCell[]): ArrayBuffer {
  const buffer = new ArrayBuffer(cells.length * CELL_SIZE);
  const view = new DataView(buffer);

  for (let i = 0; i < cells.length; i++) {
    packCellAt(view, i * CELL_SIZE, cells[i]);
  }

  return buffer;
}

/**
 * Unpack cells from an ArrayBuffer
 */
export function unpackCells(buffer: ArrayBuffer): TerminalCell[] {
  const view = new DataView(buffer);
  const count = buffer.byteLength / CELL_SIZE;
  const cells: TerminalCell[] = new Array(count);

  for (let i = 0; i < count; i++) {
    cells[i] = unpackCellAt(view, i * CELL_SIZE);
  }

  return cells;
}

/**
 * Unpack cells into an existing row array (in-place).
 * Reuses existing TerminalCell objects when present.
 */
export function unpackCellsIntoRow(buffer: ArrayBuffer, row: TerminalCell[]): TerminalCell[] {
  const view = new DataView(buffer);
  const count = buffer.byteLength / CELL_SIZE;

  if (row.length !== count) {
    row.length = count;
  }

  for (let i = 0; i < count; i++) {
    const cell = row[i] ?? createEmptyCell();
    updateCellFromView(view, i * CELL_SIZE, cell);
    row[i] = cell;
  }

  return row;
}

/**
 * Pack a row (array of cells) with prepended column count
 */
export function packRow(cells: TerminalCell[]): ArrayBuffer {
  // 4 bytes for column count + cell data
  const buffer = new ArrayBuffer(4 + cells.length * CELL_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, cells.length, true);

  for (let i = 0; i < cells.length; i++) {
    packCellAt(view, 4 + i * CELL_SIZE, cells[i]);
  }

  return buffer;
}

/**
 * Unpack a row from an ArrayBuffer
 */
export function unpackRow(buffer: ArrayBuffer): TerminalCell[] {
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const cells: TerminalCell[] = new Array(count);

  for (let i = 0; i < count; i++) {
    cells[i] = unpackCellAt(view, 4 + i * CELL_SIZE);
  }

  return cells;
}

// ============================================================================
// Full Terminal State Packing
// ============================================================================

/**
 * Header format for full state (28 bytes):
 * - bytes 0-3:   cols (u32)
 * - bytes 4-7:   rows (u32)
 * - bytes 8-11:  cursor.x (u32)
 * - bytes 12-15: cursor.y (u32)
 * - byte 16:     cursor.visible (u8, 0 or 1)
 * - byte 17:     cursor.style (u8, 0=block, 1=underline, 2=bar)
 * - byte 18:     alternateScreen (u8)
 * - byte 19:     mouseTracking (u8)
 * - byte 20:     cursorKeyMode (u8, 0=normal, 1=application)
 * - bytes 21-27: reserved
 * - bytes 28+:   cell data (rows * cols * CELL_SIZE)
 */
export const STATE_HEADER_SIZE = 28;

/**
 * Pack full terminal state into a transferable ArrayBuffer
 */
export function packTerminalState(state: TerminalState): ArrayBuffer {
  const cellCount = state.rows * state.cols;
  const buffer = new ArrayBuffer(STATE_HEADER_SIZE + cellCount * CELL_SIZE);
  const view = new DataView(buffer);

  // Header
  view.setUint32(0, state.cols, true);
  view.setUint32(4, state.rows, true);
  view.setUint32(8, state.cursor.x, true);
  view.setUint32(12, state.cursor.y, true);
  view.setUint8(16, state.cursor.visible ? 1 : 0);

  const styleMap: Record<string, number> = { block: 0, underline: 1, bar: 2 };
  view.setUint8(17, styleMap[state.cursor.style ?? 'block'] ?? 0);

  view.setUint8(18, state.alternateScreen ? 1 : 0);
  view.setUint8(19, state.mouseTracking ? 1 : 0);
  view.setUint8(20, state.cursorKeyMode === 'application' ? 1 : 0);

  // Cell data (row by row)
  let offset = STATE_HEADER_SIZE;
  for (let y = 0; y < state.rows; y++) {
    const row = state.cells[y];
    if (row) {
      for (let x = 0; x < state.cols; x++) {
        const cell = row[x];
        if (cell) {
          packCellAt(view, offset, cell);
        }
        offset += CELL_SIZE;
      }
    } else {
      offset += state.cols * CELL_SIZE;
    }
  }

  return buffer;
}

/**
 * Unpack full terminal state from an ArrayBuffer
 */
export function unpackTerminalState(buffer: ArrayBuffer): TerminalState {
  return unpackTerminalStateWithCache(buffer).state;
}

export function unpackTerminalStateWithCache(
  buffer: ArrayBuffer,
  rowCache?: RowCache | null
): { state: TerminalState; rowCache: RowCache } {
  const view = new DataView(buffer);

  // Header
  const cols = view.getUint32(0, true);
  const rows = view.getUint32(4, true);
  const cursorX = view.getUint32(8, true);
  const cursorY = view.getUint32(12, true);
  const cursorVisible = view.getUint8(16) === 1;

  const styleValues: Array<'block' | 'underline' | 'bar'> = ['block', 'underline', 'bar'];
  const cursorStyle = styleValues[view.getUint8(17)] ?? 'block';

  const alternateScreen = view.getUint8(18) === 1;
  const mouseTracking = view.getUint8(19) === 1;
  const cursorKeyMode = view.getUint8(20) === 1 ? 'application' : 'normal';

  const cache: RowCache = rowCache && rowCache.rows === rows && rowCache.cols === cols
    ? rowCache
    : { rows, cols, cells: new Array(rows) };

  let offset = STATE_HEADER_SIZE;

  for (let y = 0; y < rows; y++) {
    const row = ensureRow(cache, y);
    unpackRowInto(view, offset, row, cols);
    offset += CELL_SIZE * cols;
  }

  const cells = cache.cells.slice(0, rows);

  return {
    state: {
      cols,
      rows,
      cells,
      cursor: {
        x: cursorX,
        y: cursorY,
        visible: cursorVisible,
        style: cursorStyle,
      },
      alternateScreen,
      mouseTracking,
      cursorKeyMode,
    },
    rowCache: cache,
  };
}

// ============================================================================
// Dirty Update Packing
// ============================================================================

/**
 * Pack a DirtyTerminalUpdate into a SerializedDirtyUpdate for worker transfer
 */
export function packDirtyUpdate(update: DirtyTerminalUpdate): SerializedDirtyUpdate {
  const dirtyRowIndices = new Uint16Array(update.dirtyRows.size);
  let rowDataSize = 0;

  // Calculate total size needed for dirty row data
  let i = 0;
  for (const [rowIndex, row] of update.dirtyRows) {
    dirtyRowIndices[i++] = rowIndex;
    rowDataSize += row.length * CELL_SIZE;
  }

  // Pack dirty row data
  const dirtyRowData = new ArrayBuffer(rowDataSize);
  const view = new DataView(dirtyRowData);
  let offset = 0;

  for (const [, row] of update.dirtyRows) {
    for (const cell of row) {
      packCellAt(view, offset, cell);
      offset += CELL_SIZE;
    }
  }

  // Pack full state if present
  let fullStateData: ArrayBuffer | undefined;
  if (update.isFull && update.fullState) {
    fullStateData = packTerminalState(update.fullState);
  }

  return {
    dirtyRowIndices,
    dirtyRowData,
    cursor: {
      x: update.cursor.x,
      y: update.cursor.y,
      visible: update.cursor.visible,
    },
    cols: update.cols,
    rows: update.rows,
    scrollbackLength: update.scrollState.scrollbackLength,
    isFull: update.isFull,
    fullStateData,
    alternateScreen: update.alternateScreen,
    mouseTracking: update.mouseTracking,
    cursorKeyMode: update.cursorKeyMode === 'application' ? 1 : 0,
    inBandResize: update.inBandResize,
  };
}

/**
 * Unpack a SerializedDirtyUpdate back into a DirtyTerminalUpdate
 */
export function unpackDirtyUpdate(
  packed: SerializedDirtyUpdate,
  scrollState: TerminalScrollState
): DirtyTerminalUpdate {
  return unpackDirtyUpdateWithCache(packed, scrollState).update;
}

export function unpackDirtyUpdateWithCache(
  packed: SerializedDirtyUpdate,
  scrollState: TerminalScrollState,
  rowCache?: RowCache | null
): { update: DirtyTerminalUpdate; rowCache: RowCache } {
  const cache: RowCache = rowCache && rowCache.rows === packed.rows && rowCache.cols === packed.cols
    ? rowCache
    : { rows: packed.rows, cols: packed.cols, cells: new Array(packed.rows) };

  // Unpack dirty rows
  const dirtyRows = new Map<number, TerminalCell[]>();
  const view = new DataView(packed.dirtyRowData);
  let offset = 0;

  for (let i = 0; i < packed.dirtyRowIndices.length; i++) {
    const rowIndex = packed.dirtyRowIndices[i];
    const row = ensureRow(cache, rowIndex);
    unpackRowInto(view, offset, row, cache.cols);
    offset += CELL_SIZE * cache.cols;
    dirtyRows.set(rowIndex, row);
  }

  // Unpack full state if present
  let fullState: TerminalState | undefined;
  if (packed.isFull && packed.fullStateData) {
    const result = unpackTerminalStateWithCache(packed.fullStateData, cache);
    fullState = result.state;
    rowCache = result.rowCache;
  }

  const cursor: TerminalCursor = {
    x: packed.cursor.x,
    y: packed.cursor.y,
    visible: packed.cursor.visible,
    style: 'block',
  };

  const update: DirtyTerminalUpdate = {
    dirtyRows,
    cursor,
    scrollState: {
      viewportOffset: scrollState.viewportOffset,
      scrollbackLength: packed.scrollbackLength,
      isAtBottom: scrollState.isAtBottom,
    },
    cols: packed.cols,
    rows: packed.rows,
    isFull: packed.isFull,
    fullState,
    alternateScreen: packed.alternateScreen,
    mouseTracking: packed.mouseTracking,
    cursorKeyMode: packed.cursorKeyMode === 1 ? 'application' : 'normal',
    inBandResize: packed.inBandResize,
  };

  return { update, rowCache: rowCache ?? cache };
}

/**
 * Get the list of transferable buffers from a SerializedDirtyUpdate
 * for use with postMessage transfer list
 */
export function getTransferables(packed: SerializedDirtyUpdate): ArrayBuffer[] {
  const transferables: ArrayBuffer[] = [
    packed.dirtyRowIndices.buffer as ArrayBuffer,
    packed.dirtyRowData,
  ];

  if (packed.fullStateData) {
    transferables.push(packed.fullStateData);
  }

  return transferables;
}
