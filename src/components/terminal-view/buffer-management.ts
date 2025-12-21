/**
 * Buffer Management - handles creation and resizing of rendering buffers
 */
import { OptimizedBuffer } from '@opentui/core';
import { PACKED_CELL_BYTE_STRIDE, type PackedRowBuffer, type PackedRowBatchBuffer, type RowTextCache } from './cell-rendering';
import type { MissingRowBuffer } from './row-fetching';

export interface FrameBufferState {
  frameBuffer: OptimizedBuffer | null;
  frameBufferWidth: number;
  frameBufferHeight: number;
}

export interface PackedBufferState {
  packedRowBuffer: PackedRowBuffer | null;
  packedRowBatchBuffer: PackedRowBatchBuffer | null;
}

export interface CacheState {
  rowTextCache: RowTextCache | null;
  missingRowsBuffer: MissingRowBuffer | null;
}

/**
 * Ensure frame buffer exists and has correct dimensions
 * Returns true if buffer was created or resized (dirtyAll should be set)
 */
export function ensureFrameBuffer(
  state: FrameBufferState,
  width: number,
  height: number,
  referenceBuffer: OptimizedBuffer
): boolean {
  if (!state.frameBuffer) {
    state.frameBuffer = OptimizedBuffer.create(width, height, referenceBuffer.widthMethod, {
      respectAlpha: referenceBuffer.respectAlpha,
    });
    state.frameBufferWidth = width;
    state.frameBufferHeight = height;
    return true;
  }

  if (state.frameBufferWidth !== width || state.frameBufferHeight !== height) {
    state.frameBuffer.resize(width, height);
    state.frameBufferWidth = width;
    state.frameBufferHeight = height;
    return true;
  }

  return false;
}

/**
 * Ensure packed row buffer exists with sufficient capacity
 */
export function ensurePackedRowBuffer(state: PackedBufferState, cols: number): void {
  if (cols <= 0) return;
  if (!state.packedRowBuffer || state.packedRowBuffer.capacity < cols) {
    const buffer = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
    state.packedRowBuffer = {
      buffer,
      floats: new Float32Array(buffer),
      uints: new Uint32Array(buffer),
      capacity: cols,
      overlayX: new Int32Array(cols),
      overlayCodepoint: new Uint32Array(cols),
      overlayAttributes: new Uint8Array(cols),
      overlayFg: new Array(cols).fill(null),
      overlayBg: new Array(cols).fill(null),
      overlayCount: 0,
    };
  }
}

/**
 * Ensure packed row batch buffer exists with sufficient capacity
 */
export function ensurePackedRowBatchBuffer(state: PackedBufferState, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) return;
  if (
    !state.packedRowBatchBuffer ||
    state.packedRowBatchBuffer.capacityCols < cols ||
    state.packedRowBatchBuffer.capacityRows < rows
  ) {
    const cellCount = cols * rows;
    const buffer = new ArrayBuffer(cellCount * PACKED_CELL_BYTE_STRIDE);
    state.packedRowBatchBuffer = {
      buffer,
      bytes: new Uint8Array(buffer),
      floats: new Float32Array(buffer),
      uints: new Uint32Array(buffer),
      capacityCols: cols,
      capacityRows: rows,
      overlayX: new Int32Array(cellCount),
      overlayY: new Int32Array(cellCount),
      overlayCodepoint: new Uint32Array(cellCount),
      overlayAttributes: new Uint8Array(cellCount),
      overlayFg: new Array(cellCount).fill(null),
      overlayBg: new Array(cellCount).fill(null),
      overlayCount: 0,
    };
  }
}

/**
 * Ensure row text cache exists with correct size
 */
export function ensureRowTextCache(state: CacheState, rowCount: number): void {
  if (rowCount <= 0) {
    state.rowTextCache = null;
    return;
  }
  if (!state.rowTextCache || state.rowTextCache.length !== rowCount) {
    state.rowTextCache = new Array(rowCount).fill(null);
  }
}

/**
 * Ensure missing rows buffer exists with sufficient capacity
 */
export function ensureMissingRowsBuffer(state: CacheState, rowCount: number): MissingRowBuffer | null {
  if (rowCount <= 0) {
    state.missingRowsBuffer = null;
    return null;
  }
  if (!state.missingRowsBuffer || state.missingRowsBuffer.rowIndices.length < rowCount) {
    state.missingRowsBuffer = {
      rowIndices: new Int32Array(rowCount),
      offsets: new Int32Array(rowCount),
      count: 0,
    };
  } else {
    state.missingRowsBuffer.count = 0;
  }
  return state.missingRowsBuffer;
}

/**
 * Clear row text cache entries
 */
export function clearRowTextCache(cache: RowTextCache | null, rowIndex?: number): void {
  if (!cache) return;
  if (rowIndex === undefined) {
    cache.fill(null);
    return;
  }
  if (rowIndex >= 0 && rowIndex < cache.length) {
    cache[rowIndex] = null;
  }
}

/**
 * Cleanup all buffers
 */
export function cleanupBuffers(
  frameState: FrameBufferState,
  packedState: PackedBufferState,
  cacheState: CacheState
): void {
  frameState.frameBuffer?.destroy();
  frameState.frameBuffer = null;
  frameState.frameBufferWidth = 0;
  frameState.frameBufferHeight = 0;

  packedState.packedRowBuffer = null;
  packedState.packedRowBatchBuffer = null;

  cacheState.rowTextCache = null;
  cacheState.missingRowsBuffer = null;
}
