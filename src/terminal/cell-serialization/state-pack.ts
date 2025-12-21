import type { TerminalState } from '../../core/types';
import { CELL_SIZE } from './constants';
import { ensureRow, unpackRowInto, type RowCache } from './row-cache';

export const STATE_HEADER_SIZE = 28;

export function packTerminalState(state: TerminalState): ArrayBuffer {
  const cellCount = state.rows * state.cols;
  const buffer = new ArrayBuffer(STATE_HEADER_SIZE + cellCount * CELL_SIZE);
  const view = new DataView(buffer);

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

  let offset = STATE_HEADER_SIZE;
  for (let y = 0; y < state.rows; y++) {
    const row = state.cells[y];
    if (row) {
      for (let x = 0; x < state.cols; x++) {
        const cell = row[x];
        if (cell) {
          const cellOffset = offset + x * CELL_SIZE;
          const viewRef = view;
          viewRef.setUint32(cellOffset, cell.char.codePointAt(0) ?? 0x20, true);
          viewRef.setUint8(cellOffset + 4, cell.fg.r);
          viewRef.setUint8(cellOffset + 5, cell.fg.g);
          viewRef.setUint8(cellOffset + 6, cell.fg.b);
          viewRef.setUint8(cellOffset + 7, cell.bg.r);
          viewRef.setUint8(cellOffset + 8, cell.bg.g);
          viewRef.setUint8(cellOffset + 9, cell.bg.b);
          let flags = 0;
          if (cell.bold) flags |= 1 << 0;
          if (cell.italic) flags |= 1 << 1;
          if (cell.underline) flags |= 1 << 2;
          if (cell.strikethrough) flags |= 1 << 3;
          if (cell.inverse) flags |= 1 << 4;
          if (cell.blink) flags |= 1 << 5;
          if (cell.dim) flags |= 1 << 6;
          viewRef.setUint16(cellOffset + 10, flags, true);
          viewRef.setUint8(cellOffset + 12, cell.width);
          viewRef.setUint16(cellOffset + 13, cell.hyperlinkId ?? 0, true);
          viewRef.setUint8(cellOffset + 15, 0);
        }
      }
    }
    offset += state.cols * CELL_SIZE;
  }

  return buffer;
}

export function unpackTerminalState(buffer: ArrayBuffer): TerminalState {
  return unpackTerminalStateWithCache(buffer).state;
}

export function unpackTerminalStateWithCache(
  buffer: ArrayBuffer,
  rowCache?: RowCache | null
): { state: TerminalState; rowCache: RowCache } {
  const view = new DataView(buffer);

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
