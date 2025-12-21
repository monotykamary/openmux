import type { PackedRowUpdate } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import type { WorkerSession } from './types';
import { PACKED_CELL_BYTE_STRIDE, packGhosttyLineIntoPackedRow } from './packing';

export const getPackedRowTransferables = (packedRows: PackedRowUpdate): ArrayBuffer[] => {
  return [
    packedRows.rowIndices.buffer as ArrayBuffer,
    packedRows.data,
    packedRows.overlayRowStarts.buffer as ArrayBuffer,
    packedRows.overlayX.buffer as ArrayBuffer,
    packedRows.overlayCodepoint.buffer as ArrayBuffer,
    packedRows.overlayAttributes.buffer as ArrayBuffer,
    packedRows.overlayFg.buffer as ArrayBuffer,
    packedRows.overlayBg.buffer as ArrayBuffer,
  ];
};

export const clonePackedRowUpdate = (packed: PackedRowUpdate): PackedRowUpdate => {
  return {
    cols: packed.cols,
    rowIndices: packed.rowIndices.slice(0),
    data: packed.data.slice(0),
    overlayRowStarts: packed.overlayRowStarts.slice(0),
    overlayX: packed.overlayX.slice(0),
    overlayCodepoint: packed.overlayCodepoint.slice(0),
    overlayAttributes: packed.overlayAttributes.slice(0),
    overlayFg: packed.overlayFg.slice(0),
    overlayBg: packed.overlayBg.slice(0),
  };
};

export const packScrollbackLine = (
  offset: number,
  line: ReturnType<WorkerSession['terminal']['getScrollbackLine']>,
  cols: number,
  colors: TerminalColors
): PackedRowUpdate => {
  const rowIndices = new Uint16Array(1);
  rowIndices[0] = offset;
  const data = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
  const packedFloats = new Float32Array(data);
  const packedU32 = new Uint32Array(data);
  const overlayRowStarts = new Uint32Array(2);
  const overlayX = new Int32Array(cols);
  const overlayCodepoint = new Uint32Array(cols);
  const overlayAttributes = new Uint8Array(cols);
  const overlayFg = new Uint8Array(cols * 4);
  const overlayBg = new Uint8Array(cols * 4);
  overlayRowStarts[0] = 0;
  const overlayCount = packGhosttyLineIntoPackedRow(
    line,
    cols,
    colors,
    0,
    packedFloats,
    packedU32,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
    0
  );
  overlayRowStarts[1] = overlayCount;

  return {
    cols,
    rowIndices,
    data,
    overlayRowStarts,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
  };
};

export const packScrollbackLines = (
  entries: PackedRowUpdate[],
  cols: number
): PackedRowUpdate | null => {
  const rowCount = entries.length;
  if (rowCount === 0) return null;

  const rowIndices = new Uint16Array(rowCount);
  const rowStride = cols * PACKED_CELL_BYTE_STRIDE;
  const data = new ArrayBuffer(rowCount * rowStride);
  const dataBytes = new Uint8Array(data);
  const overlayCapacity = rowCount * cols;
  const overlayRowStarts = new Uint32Array(rowCount + 1);
  const overlayX = new Int32Array(overlayCapacity);
  const overlayCodepoint = new Uint32Array(overlayCapacity);
  const overlayAttributes = new Uint8Array(overlayCapacity);
  const overlayFg = new Uint8Array(overlayCapacity * 4);
  const overlayBg = new Uint8Array(overlayCapacity * 4);

  let overlayCount = 0;
  for (let i = 0; i < rowCount; i++) {
    const entry = entries[i];
    rowIndices[i] = entry.rowIndices[0] ?? 0;
    dataBytes.set(new Uint8Array(entry.data), i * rowStride);

    overlayRowStarts[i] = overlayCount;
    const entryOverlayCount = entry.overlayRowStarts[1] ?? 0;
    if (entryOverlayCount > 0) {
      overlayX.set(entry.overlayX.subarray(0, entryOverlayCount), overlayCount);
      overlayCodepoint.set(entry.overlayCodepoint.subarray(0, entryOverlayCount), overlayCount);
      overlayAttributes.set(entry.overlayAttributes.subarray(0, entryOverlayCount), overlayCount);
      const colorOffset = overlayCount * 4;
      overlayFg.set(entry.overlayFg.subarray(0, entryOverlayCount * 4), colorOffset);
      overlayBg.set(entry.overlayBg.subarray(0, entryOverlayCount * 4), colorOffset);
    }
    overlayCount += entryOverlayCount;
    overlayRowStarts[i + 1] = overlayCount;
  }

  return {
    cols,
    rowIndices,
    data,
    overlayRowStarts,
    overlayX,
    overlayCodepoint,
    overlayAttributes,
    overlayFg,
    overlayBg,
  };
};

export function containsOscStart(bytes: Uint8Array): boolean {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x5d) {
      return true;
    }
  }
  return false;
}
