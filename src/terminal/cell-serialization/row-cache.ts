import type { TerminalCell } from '../../core/types';
import { CELL_SIZE, FLAG_BOLD, FLAG_ITALIC, FLAG_UNDERLINE, FLAG_STRIKETHROUGH, FLAG_INVERSE, FLAG_BLINK, FLAG_DIM, createEmptyCell } from './constants';

export interface RowCache {
  rows: number;
  cols: number;
  cells: TerminalCell[][];
}

export function createRow(cols: number): TerminalCell[] {
  const row: TerminalCell[] = new Array(cols);
  for (let x = 0; x < cols; x++) {
    row[x] = createEmptyCell();
  }
  return row;
}

export function updateCellFromView(view: DataView, offset: number, cell: TerminalCell): void {
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

export function ensureRow(cache: RowCache, rowIndex: number): TerminalCell[] {
  const existing = cache.cells[rowIndex];
  if (existing && existing.length === cache.cols) {
    return existing;
  }

  const row = createRow(cache.cols);
  cache.cells[rowIndex] = row;
  return row;
}

export function unpackRowInto(view: DataView, offset: number, row: TerminalCell[], cols: number): void {
  for (let x = 0; x < cols; x++) {
    const cellOffset = offset + x * CELL_SIZE;
    const cell = row[x] ?? createEmptyCell();
    updateCellFromView(view, cellOffset, cell);
    row[x] = cell;
  }
}
