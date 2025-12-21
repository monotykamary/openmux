import type { TerminalCell } from '../../core/types';
import { CELL_SIZE, FLAG_BOLD, FLAG_ITALIC, FLAG_UNDERLINE, FLAG_STRIKETHROUGH, FLAG_INVERSE, FLAG_BLINK, FLAG_DIM, createEmptyCell } from './constants';
import { updateCellFromView } from './row-cache';

function packCellAt(view: DataView, offset: number, cell: TerminalCell): void {
  const codepoint = cell.char.codePointAt(0) ?? 0x20;
  view.setUint32(offset, codepoint, true);

  view.setUint8(offset + 4, cell.fg.r);
  view.setUint8(offset + 5, cell.fg.g);
  view.setUint8(offset + 6, cell.fg.b);

  view.setUint8(offset + 7, cell.bg.r);
  view.setUint8(offset + 8, cell.bg.g);
  view.setUint8(offset + 9, cell.bg.b);

  let flags = 0;
  if (cell.bold) flags |= FLAG_BOLD;
  if (cell.italic) flags |= FLAG_ITALIC;
  if (cell.underline) flags |= FLAG_UNDERLINE;
  if (cell.strikethrough) flags |= FLAG_STRIKETHROUGH;
  if (cell.inverse) flags |= FLAG_INVERSE;
  if (cell.blink) flags |= FLAG_BLINK;
  if (cell.dim) flags |= FLAG_DIM;
  view.setUint16(offset + 10, flags, true);

  view.setUint8(offset + 12, cell.width);
  view.setUint16(offset + 13, cell.hyperlinkId ?? 0, true);
  view.setUint8(offset + 15, 0);
}

function unpackCellAt(view: DataView, offset: number): TerminalCell {
  const codepoint = view.getUint32(offset, true);
  const char = codepoint > 0 ? String.fromCodePoint(codepoint) : ' ';

  const fg = {
    r: view.getUint8(offset + 4),
    g: view.getUint8(offset + 5),
    b: view.getUint8(offset + 6),
  };

  const bg = {
    r: view.getUint8(offset + 7),
    g: view.getUint8(offset + 8),
    b: view.getUint8(offset + 9),
  };

  const flags = view.getUint16(offset + 10, true);
  const bold = (flags & FLAG_BOLD) !== 0;
  const italic = (flags & FLAG_ITALIC) !== 0;
  const underline = (flags & FLAG_UNDERLINE) !== 0;
  const strikethrough = (flags & FLAG_STRIKETHROUGH) !== 0;
  const inverse = (flags & FLAG_INVERSE) !== 0;
  const blink = (flags & FLAG_BLINK) !== 0;
  const dim = (flags & FLAG_DIM) !== 0;

  const width = view.getUint8(offset + 12) as 1 | 2;
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

export function packCells(cells: TerminalCell[]): ArrayBuffer {
  const buffer = new ArrayBuffer(cells.length * CELL_SIZE);
  const view = new DataView(buffer);

  for (let i = 0; i < cells.length; i++) {
    packCellAt(view, i * CELL_SIZE, cells[i]);
  }

  return buffer;
}

export function unpackCells(buffer: ArrayBuffer): TerminalCell[] {
  const view = new DataView(buffer);
  const count = buffer.byteLength / CELL_SIZE;
  const cells: TerminalCell[] = new Array(count);

  for (let i = 0; i < count; i++) {
    cells[i] = unpackCellAt(view, i * CELL_SIZE);
  }

  return cells;
}

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

export function packRow(cells: TerminalCell[]): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + cells.length * CELL_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, cells.length, true);

  for (let i = 0; i < cells.length; i++) {
    packCellAt(view, 4 + i * CELL_SIZE, cells[i]);
  }

  return buffer;
}

export function unpackRow(buffer: ArrayBuffer): TerminalCell[] {
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  const cells: TerminalCell[] = new Array(count);

  for (let i = 0; i < count; i++) {
    cells[i] = unpackCellAt(view, 4 + i * CELL_SIZE);
  }

  return cells;
}
