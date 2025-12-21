import type {
  DirtyTerminalUpdate,
  TerminalCell,
  TerminalCursor,
  TerminalScrollState,
  TerminalState,
} from '../../core/types';
import type { SerializedDirtyUpdate } from '../emulator-interface';
import { CELL_SIZE } from './constants';
import { ensureRow, unpackRowInto, type RowCache } from './row-cache';
import { packTerminalState, unpackTerminalStateWithCache } from './state-pack';

export function packDirtyUpdate(update: DirtyTerminalUpdate): SerializedDirtyUpdate {
  const dirtyRowIndices = new Uint16Array(update.dirtyRows.size);
  let rowDataSize = 0;

  let i = 0;
  for (const [rowIndex, row] of update.dirtyRows) {
    dirtyRowIndices[i++] = rowIndex;
    rowDataSize += row.length * CELL_SIZE;
  }

  const dirtyRowData = new ArrayBuffer(rowDataSize);
  const view = new DataView(dirtyRowData);
  let offset = 0;

  for (const [, row] of update.dirtyRows) {
    for (const cell of row) {
      const codepoint = cell.char.codePointAt(0) ?? 0x20;
      view.setUint32(offset, codepoint, true);
      view.setUint8(offset + 4, cell.fg.r);
      view.setUint8(offset + 5, cell.fg.g);
      view.setUint8(offset + 6, cell.fg.b);
      view.setUint8(offset + 7, cell.bg.r);
      view.setUint8(offset + 8, cell.bg.g);
      view.setUint8(offset + 9, cell.bg.b);
      let flags = 0;
      if (cell.bold) flags |= 1 << 0;
      if (cell.italic) flags |= 1 << 1;
      if (cell.underline) flags |= 1 << 2;
      if (cell.strikethrough) flags |= 1 << 3;
      if (cell.inverse) flags |= 1 << 4;
      if (cell.blink) flags |= 1 << 5;
      if (cell.dim) flags |= 1 << 6;
      view.setUint16(offset + 10, flags, true);
      view.setUint8(offset + 12, cell.width);
      view.setUint16(offset + 13, cell.hyperlinkId ?? 0, true);
      view.setUint8(offset + 15, 0);
      offset += CELL_SIZE;
    }
  }

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
    packedRows: update.packedRows,
    alternateScreen: update.alternateScreen,
    mouseTracking: update.mouseTracking,
    cursorKeyMode: update.cursorKeyMode === 'application' ? 1 : 0,
    inBandResize: update.inBandResize,
  };
}

export function unpackDirtyUpdate(
  packed: SerializedDirtyUpdate,
  scrollState: TerminalScrollState
): DirtyTerminalUpdate {
  return unpackDirtyUpdateWithCache(packed, scrollState).update;
}

export function unpackDirtyUpdateWithCache(
  packed: SerializedDirtyUpdate,
  scrollState: TerminalScrollState,
  rowCache?: RowCache | null,
  options?: { skipDirtyRows?: boolean }
): { update: DirtyTerminalUpdate; rowCache: RowCache } {
  const cache: RowCache = rowCache && rowCache.rows === packed.rows && rowCache.cols === packed.cols
    ? rowCache
    : { rows: packed.rows, cols: packed.cols, cells: new Array(packed.rows) };

  const dirtyRows = new Map<number, TerminalCell[]>();
  if (!options?.skipDirtyRows) {
    const view = new DataView(packed.dirtyRowData);
    let offset = 0;

    for (let i = 0; i < packed.dirtyRowIndices.length; i++) {
      const rowIndex = packed.dirtyRowIndices[i];
      const row = ensureRow(cache, rowIndex);
      unpackRowInto(view, offset, row, cache.cols);
      offset += CELL_SIZE * cache.cols;
      dirtyRows.set(rowIndex, row);
    }
  }

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
    packedRows: packed.packedRows,
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

export function getTransferables(packed: SerializedDirtyUpdate): ArrayBuffer[] {
  const transferables: ArrayBuffer[] = [
    packed.dirtyRowIndices.buffer as ArrayBuffer,
    packed.dirtyRowData,
  ];

  if (packed.packedRows) {
    const packedRows = packed.packedRows;
    if (packedRows.rowIndices.buffer !== packed.dirtyRowIndices.buffer) {
      transferables.push(packedRows.rowIndices.buffer as ArrayBuffer);
    }
    transferables.push(
      packedRows.data,
      packedRows.overlayRowStarts.buffer as ArrayBuffer,
      packedRows.overlayX.buffer as ArrayBuffer,
      packedRows.overlayCodepoint.buffer as ArrayBuffer,
      packedRows.overlayAttributes.buffer as ArrayBuffer,
      packedRows.overlayFg.buffer as ArrayBuffer,
      packedRows.overlayBg.buffer as ArrayBuffer
    );
  }

  if (packed.fullStateData) {
    transferables.push(packed.fullStateData);
  }

  return transferables;
}
