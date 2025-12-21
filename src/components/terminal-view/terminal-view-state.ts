/**
 * TerminalViewState - encapsulates all mutable state for TerminalView
 */
import { OptimizedBuffer, type RGBA } from '@opentui/core';
import type { TerminalState, TerminalCell, TerminalScrollState, PackedRowUpdate } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { PackedRowCache } from './packed-row-cache';
import {
  PACKED_CELL_BYTE_STRIDE,
  type PackedRowBuffer,
  type PackedRowBatchBuffer,
  type RowTextCache,
  type RowRenderCache,
} from './cell-rendering';
import type { MissingRowBuffer } from './row-fetching';

export interface MissingRowSnapshot {
  viewportOffset: number;
  scrollbackLength: number;
  rows: number;
  count: number;
  rowIndices: Int32Array;
  offsets: Int32Array;
}

export class TerminalViewState {
  // Terminal state
  terminalState: TerminalState | null = null;
  scrollState: TerminalScrollState = { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true };

  // Dirty tracking
  dirtyRows: Uint8Array | null = null;
  dirtyAll = true;

  // Render tracking
  lastHadSelection = false;
  lastHadSearch = false;
  lastIsFocused = false;
  lastRenderRows = 0;
  lastRenderCols = 0;
  lastRenderWidth = 0;
  lastRenderHeight = 0;
  lastSelectionRef: unknown = null;
  lastSearchRef: unknown = null;
  lastSearchPtyId: string | null = null;

  // Padding tracking
  paddingWasActive = false;
  lastPaddingCols = 0;
  lastPaddingRows = 0;
  lastPaddingWidth = 0;
  lastPaddingHeight = 0;
  lastPaddingBg: RGBA | null = null;

  // Buffers
  frameBuffer: OptimizedBuffer | null = null;
  frameBufferWidth = 0;
  frameBufferHeight = 0;
  packedRowBuffer: PackedRowBuffer | null = null;
  packedRowBatchBuffer: PackedRowBatchBuffer | null = null;
  readonly packedRowCache = new PackedRowCache();
  rowTextCache: RowTextCache | null = null;
  rowRenderCache: RowRenderCache | null = null;
  missingRowsBuffer: MissingRowBuffer | null = null;

  // Prefetch state
  pendingMissingRows: MissingRowSnapshot | null = null;
  pendingPackedRows: PackedRowUpdate | null = null;
  pendingPrefetch: { ptyId: string; start: number; count: number } | null = null;
  prefetchInProgress = false;
  prefetchScheduled = false;
  executePrefetchFn: (() => void) | null = null;

  // Caches
  readonly transitionCache = new Map<number, TerminalCell[]>();
  scrollbackRowCache: (TerminalCell[] | null)[] = [];
  emulator: ITerminalEmulator | null = null;

  constructor(isFocused: boolean) {
    this.lastIsFocused = isFocused;
  }

  clearRowTextCache(rowIndex?: number): void {
    if (!this.rowTextCache) return;
    if (rowIndex === undefined) {
      this.rowTextCache.fill(null);
      return;
    }
    if (rowIndex >= 0 && rowIndex < this.rowTextCache.length) {
      this.rowTextCache[rowIndex] = null;
    }
  }

  markAllRowsDirty(rowCount: number): void {
    if (rowCount <= 0) {
      this.dirtyRows = null;
      this.clearRowTextCache();
      this.packedRowCache.clearPackedRowCache();
      return;
    }
    if (!this.dirtyRows || this.dirtyRows.length !== rowCount) {
      this.dirtyRows = new Uint8Array(rowCount);
    }
    this.dirtyRows.fill(1);
    this.clearRowTextCache();
    this.packedRowCache.clearPackedRowCache();
  }

  markRowDirty(rowIndex: number, invalidateCache = true): void {
    if (!this.dirtyRows || rowIndex < 0 || rowIndex >= this.dirtyRows.length) return;
    this.dirtyRows[rowIndex] = 1;
    if (invalidateCache) {
      this.clearRowTextCache(rowIndex);
      this.packedRowCache.clearPackedRowCache(rowIndex);
    }
  }

  ensureFrameBuffer(width: number, height: number, buffer: OptimizedBuffer): void {
    if (!this.frameBuffer) {
      this.frameBuffer = OptimizedBuffer.create(width, height, buffer.widthMethod, {
        respectAlpha: buffer.respectAlpha,
      });
      this.frameBufferWidth = width;
      this.frameBufferHeight = height;
      this.dirtyAll = true;
      return;
    }

    if (this.frameBufferWidth !== width || this.frameBufferHeight !== height) {
      this.frameBuffer.resize(width, height);
      this.frameBufferWidth = width;
      this.frameBufferHeight = height;
      this.dirtyAll = true;
    }
  }

  ensurePackedRowBuffer(cols: number): void {
    if (cols <= 0) return;
    if (!this.packedRowBuffer || this.packedRowBuffer.capacity < cols) {
      const buffer = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
      this.packedRowBuffer = {
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

  ensurePackedRowBatchBuffer(cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    if (
      !this.packedRowBatchBuffer ||
      this.packedRowBatchBuffer.capacityCols < cols ||
      this.packedRowBatchBuffer.capacityRows < rows
    ) {
      const cellCount = cols * rows;
      const buffer = new ArrayBuffer(cellCount * PACKED_CELL_BYTE_STRIDE);
      this.packedRowBatchBuffer = {
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

  ensureRowTextCache(rowCount: number): void {
    if (rowCount <= 0) {
      this.rowTextCache = null;
      return;
    }
    if (!this.rowTextCache || this.rowTextCache.length !== rowCount) {
      this.rowTextCache = new Array(rowCount).fill(null);
    }
  }

  ensureMissingRowsBuffer(rowCount: number): MissingRowBuffer | null {
    if (rowCount <= 0) {
      this.missingRowsBuffer = null;
      return null;
    }
    if (!this.missingRowsBuffer || this.missingRowsBuffer.rowIndices.length < rowCount) {
      this.missingRowsBuffer = {
        rowIndices: new Int32Array(rowCount),
        offsets: new Int32Array(rowCount),
        count: 0,
      };
    } else {
      this.missingRowsBuffer.count = 0;
    }
    return this.missingRowsBuffer;
  }

  snapshotMissingRows(
    buffer: MissingRowBuffer | null,
    viewportOffset: number,
    scrollbackLength: number,
    rows: number
  ): MissingRowSnapshot | null {
    if (!buffer || buffer.count === 0) return null;
    const count = buffer.count;
    return {
      viewportOffset,
      scrollbackLength,
      rows,
      count,
      rowIndices: buffer.rowIndices.slice(0, count),
      offsets: buffer.offsets.slice(0, count),
    };
  }

  applyPrefetchSnapshot(snapshot: MissingRowSnapshot | null): boolean {
    if (!snapshot || !this.terminalState) {
      this.dirtyAll = true;
      this.clearRowTextCache();
      return true;
    }
    if (
      this.scrollState.viewportOffset !== snapshot.viewportOffset ||
      this.scrollState.scrollbackLength !== snapshot.scrollbackLength ||
      this.terminalState.rows !== snapshot.rows
    ) {
      this.dirtyAll = true;
      this.markAllRowsDirty(this.terminalState.rows);
      return true;
    }
    if (!this.dirtyRows) {
      this.dirtyAll = true;
      this.markAllRowsDirty(this.terminalState.rows);
      return true;
    }

    let marked = false;
    for (let i = 0; i < snapshot.count; i++) {
      const rowIndex = snapshot.rowIndices[i];
      const offset = snapshot.offsets[i];
      const packedGetter = this.emulator
        ? (this.emulator as { getScrollbackLinePacked?: (line: number) => PackedRowUpdate | null }).getScrollbackLinePacked
        : undefined;
      const packed = packedGetter ? packedGetter.call(this.emulator, offset) : null;
      if (packed && this.terminalState && packed.cols === this.terminalState.cols) {
        this.packedRowCache.ensureScrollbackPackedCache(this.terminalState.cols);
        this.packedRowCache.cacheScrollbackPackedRows(packed);
        this.markRowDirty(rowIndex);
        marked = true;
        continue;
      }

      const line = this.emulator?.getScrollbackLine(offset) ?? this.transitionCache.get(offset) ?? null;
      if (line) {
        this.markRowDirty(rowIndex);
        marked = true;
      }
    }

    return marked;
  }

  updateRowRenderCache(): void {
    this.rowRenderCache = this.packedRowBuffer && this.rowTextCache
      ? { packedRow: this.packedRowBuffer, rowText: this.rowTextCache }
      : null;
  }

  cleanup(): void {
    this.frameBuffer?.destroy();
    this.frameBuffer = null;
    this.packedRowBuffer = null;
    this.packedRowBatchBuffer = null;
    this.packedRowCache.packedRowCache = null;
    this.packedRowCache.packedRowCacheCols = 0;
    this.packedRowCache.packedRowCacheDirty = null;
    this.rowTextCache = null;
    this.rowRenderCache = null;
    this.missingRowsBuffer = null;
    this.pendingMissingRows = null;
    this.pendingPackedRows = null;
    this.packedRowCache.scrollbackPackedCache = null;
    this.packedRowCache.scrollbackPackedCacheCols = 0;
    this.packedRowCache.packedOverlayIndex = null;
    this.packedRowCache.packedOverlayIndexCols = 0;
  }

  resetForPtyChange(): void {
    this.terminalState = null;
    this.dirtyRows = null;
    this.dirtyAll = true;
    this.emulator = null;
    this.executePrefetchFn = null;
    this.pendingPrefetch = null;
    this.pendingMissingRows = null;
    this.missingRowsBuffer = null;
    this.rowTextCache = null;
    this.rowRenderCache = null;
    this.packedRowCache.packedRowCache = null;
    this.packedRowCache.packedRowCacheCols = 0;
    this.packedRowCache.packedRowCacheDirty = null;
    this.prefetchScheduled = false;
    this.transitionCache.clear();
    this.scrollbackRowCache.length = 0;
    this.packedRowCache.scrollbackPackedCache?.clear();
    this.packedRowCache.scrollbackPackedCacheCols = 0;
    this.paddingWasActive = false;
    this.lastPaddingCols = 0;
    this.lastPaddingRows = 0;
    this.lastPaddingWidth = 0;
    this.lastPaddingHeight = 0;
    this.lastPaddingBg = null;
    this.lastSelectionRef = null;
    this.lastSearchRef = null;
    this.lastSearchPtyId = null;
    this.pendingPackedRows = null;
  }
}
