import type { TerminalCell, PackedRowUpdate } from '../../core/types';
import type { RGBA } from '@opentui/core';
import { getCachedRGBA } from '../../terminal/rendering';
import { PACKED_CELL_BYTE_STRIDE, type PackedRowBatchBuffer } from './cell-rendering';

export class PackedRowCache {
  packedRowCache: Array<PackedRowBatchBuffer | null> | null = null;
  packedRowCacheCols = 0;
  packedRowCacheDirty: Uint8Array | null = null;
  scrollbackPackedCache: Map<number, PackedRowBatchBuffer> | null = null;
  scrollbackPackedCacheCols = 0;
  packedOverlayIndex: Int32Array | null = null;
  packedOverlayIndexCols = 0;

  createEntry(cols: number): PackedRowBatchBuffer {
    return this.createPackedRowCacheEntry(cols);
  }

  private createPackedRowCacheEntry(cols: number): PackedRowBatchBuffer {
    const buffer = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
    return {
      buffer,
      bytes: new Uint8Array(buffer),
      floats: new Float32Array(buffer),
      uints: new Uint32Array(buffer),
      capacityCols: cols,
      capacityRows: 1,
      overlayX: new Int32Array(cols),
      overlayY: new Int32Array(cols),
      overlayCodepoint: new Uint32Array(cols),
      overlayAttributes: new Uint8Array(cols),
      overlayFg: new Array(cols).fill(null),
      overlayBg: new Array(cols).fill(null),
      overlayCount: 0,
    };
  }

  ensurePackedRowCache(rows: number, cols: number): void {
    if (rows <= 0 || cols <= 0) {
      this.packedRowCache = null;
      this.packedRowCacheCols = 0;
      this.packedRowCacheDirty = null;
      return;
    }
    if (!this.packedRowCache || this.packedRowCache.length !== rows || this.packedRowCacheCols !== cols) {
      this.packedRowCache = new Array(rows).fill(null);
      this.packedRowCacheCols = cols;
      this.packedRowCacheDirty = new Uint8Array(rows);
      this.packedRowCacheDirty.fill(1);
    }
  }

  clearPackedRowCache(rowIndex?: number): void {
    if (!this.packedRowCache) return;
    if (rowIndex === undefined) {
      this.packedRowCache.fill(null);
      this.packedRowCacheDirty?.fill(1);
      return;
    }
    if (rowIndex >= 0 && rowIndex < this.packedRowCache.length) {
      if (this.packedRowCacheDirty) {
        this.packedRowCacheDirty[rowIndex] = 1;
      }
    }
  }

  clearScrollbackPackedCache(): void {
    this.scrollbackPackedCache?.clear();
    this.scrollbackPackedCacheCols = 0;
  }

  ensureScrollbackPackedCache(cols: number): void {
    if (cols <= 0) {
      this.clearScrollbackPackedCache();
      return;
    }
    if (!this.scrollbackPackedCache || this.scrollbackPackedCacheCols !== cols) {
      this.scrollbackPackedCache = new Map();
      this.scrollbackPackedCacheCols = cols;
    }
  }

  applyPackedRowUpdate(packedRows: PackedRowUpdate, rowsLimit: number): void {
    if (!this.packedRowCache || !this.packedRowCacheDirty) return;
    if (packedRows.cols !== this.packedRowCacheCols) return;

    const rowCount = packedRows.rowIndices.length;
    if (rowCount === 0) return;

    const rowStride = packedRows.cols * PACKED_CELL_BYTE_STRIDE;
    if (packedRows.data.byteLength < rowCount * rowStride) return;

    const dataBytes = new Uint8Array(packedRows.data);
    const overlayRowStarts = packedRows.overlayRowStarts;
    const overlayX = packedRows.overlayX;
    const overlayCodepoint = packedRows.overlayCodepoint;
    const overlayAttributes = packedRows.overlayAttributes;
    const overlayFg = packedRows.overlayFg;
    const overlayBg = packedRows.overlayBg;

    for (let i = 0; i < rowCount; i++) {
      const rowIndex = packedRows.rowIndices[i];
      if (rowIndex < 0 || rowIndex >= rowsLimit) continue;

      let entry = this.packedRowCache[rowIndex];
      if (!entry) {
        entry = this.createPackedRowCacheEntry(packedRows.cols);
        this.packedRowCache[rowIndex] = entry;
      }

      const srcOffset = i * rowStride;
      entry.bytes.set(dataBytes.subarray(srcOffset, srcOffset + rowStride));

      const start = overlayRowStarts[i] ?? 0;
      const end = overlayRowStarts[i + 1] ?? start;
      const overlayCount = Math.min(end - start, entry.overlayX.length);
      entry.overlayCount = overlayCount;

      for (let j = 0; j < overlayCount; j++) {
        const srcIndex = start + j;
        entry.overlayX[j] = overlayX[srcIndex];
        entry.overlayY[j] = 0;
        entry.overlayCodepoint[j] = overlayCodepoint[srcIndex];
        entry.overlayAttributes[j] = overlayAttributes[srcIndex];

        const fgOffset = srcIndex * 4;
        entry.overlayFg[j] = getCachedRGBA(
          overlayFg[fgOffset],
          overlayFg[fgOffset + 1],
          overlayFg[fgOffset + 2]
        );

        const bgOffset = srcIndex * 4;
        entry.overlayBg[j] = getCachedRGBA(
          overlayBg[bgOffset],
          overlayBg[bgOffset + 1],
          overlayBg[bgOffset + 2]
        );
      }

      this.packedRowCacheDirty[rowIndex] = 0;
    }
  }

  cacheScrollbackPackedRows(packedRows: PackedRowUpdate): void {
    if (!this.scrollbackPackedCache) return;
    if (packedRows.cols !== this.scrollbackPackedCacheCols) return;

    const rowCount = packedRows.rowIndices.length;
    if (rowCount === 0) return;

    const rowStride = packedRows.cols * PACKED_CELL_BYTE_STRIDE;
    const dataBytes = new Uint8Array(packedRows.data);
    const overlayRowStarts = packedRows.overlayRowStarts;
    const overlayX = packedRows.overlayX;
    const overlayCodepoint = packedRows.overlayCodepoint;
    const overlayAttributes = packedRows.overlayAttributes;
    const overlayFg = packedRows.overlayFg;
    const overlayBg = packedRows.overlayBg;

    for (let i = 0; i < rowCount; i++) {
      const offset = packedRows.rowIndices[i];
      if (offset < 0) continue;

      let entry = this.scrollbackPackedCache.get(offset) ?? null;
      if (!entry) {
        entry = this.createPackedRowCacheEntry(packedRows.cols);
        this.scrollbackPackedCache.set(offset, entry);
      }

      const srcOffset = i * rowStride;
      entry.bytes.set(dataBytes.subarray(srcOffset, srcOffset + rowStride));

      const start = overlayRowStarts[i] ?? 0;
      const end = overlayRowStarts[i + 1] ?? start;
      const overlayCount = Math.min(end - start, entry.overlayX.length);
      entry.overlayCount = overlayCount;

      for (let j = 0; j < overlayCount; j++) {
        const srcIndex = start + j;
        entry.overlayX[j] = overlayX[srcIndex];
        entry.overlayY[j] = 0;
        entry.overlayCodepoint[j] = overlayCodepoint[srcIndex];
        entry.overlayAttributes[j] = overlayAttributes[srcIndex];

        const fgOffset = srcIndex * 4;
        entry.overlayFg[j] = getCachedRGBA(
          overlayFg[fgOffset],
          overlayFg[fgOffset + 1],
          overlayFg[fgOffset + 2]
        );

        const bgOffset = srcIndex * 4;
        entry.overlayBg[j] = getCachedRGBA(
          overlayBg[bgOffset],
          overlayBg[bgOffset + 1],
          overlayBg[bgOffset + 2]
        );
      }
    }
  }

  getScrollbackPackedEntry(offset: number, cols: number): PackedRowBatchBuffer | null {
    if (!this.scrollbackPackedCache || this.scrollbackPackedCacheCols !== cols) {
      return null;
    }
    return this.scrollbackPackedCache.get(offset) ?? null;
  }

  decodePackedRowEntry(
    entry: PackedRowBatchBuffer,
    cols: number,
    reuse?: TerminalCell[]
  ): TerminalCell[] {
    const overlayIndex = this.ensurePackedOverlayIndex(cols);
    const overlayCount = entry.overlayCount;

    for (let i = 0; i < overlayCount; i++) {
      const x = entry.overlayX[i];
      if (x >= 0 && x < cols) {
        overlayIndex[x] = i;
      }
    }

    const row = reuse ?? new Array(cols);
    if (row.length !== cols) {
      row.length = cols;
    }

    const packedFloats = entry.floats;
    const packedU32 = entry.uints;
    const packedStride = PACKED_CELL_BYTE_STRIDE / 4;

    for (let x = 0; x < cols; x++) {
      const overlayIdx = overlayIndex[x];
      let fgR = 0;
      let fgG = 0;
      let fgB = 0;
      let bgR = 0;
      let bgG = 0;
      let bgB = 0;
      let attributes = 0;
      let codepoint = 0x20;
      let width: 1 | 2 = 1;

      if (overlayIdx >= 0) {
        const overlayCodepoint = entry.overlayCodepoint[overlayIdx];
        codepoint = overlayCodepoint || 0x20;
        const fg = entry.overlayFg[overlayIdx] as RGBA | null;
        const bg = entry.overlayBg[overlayIdx] as RGBA | null;
        if (fg) {
          fgR = Math.round(fg.r * 255);
          fgG = Math.round(fg.g * 255);
          fgB = Math.round(fg.b * 255);
        }
        if (bg) {
          bgR = Math.round(bg.r * 255);
          bgG = Math.round(bg.g * 255);
          bgB = Math.round(bg.b * 255);
        }
        attributes = entry.overlayAttributes[overlayIdx] ?? 0;

        const nextIdx = x + 1 < cols ? overlayIndex[x + 1] : -1;
        if (nextIdx >= 0 && entry.overlayCodepoint[nextIdx] === 0) {
          width = 2;
        }
        if (overlayCodepoint === 0) {
          codepoint = 0x20;
          width = 1;
        }
      } else {
        const base = x * packedStride;
        bgR = Math.round(packedFloats[base] * 255);
        bgG = Math.round(packedFloats[base + 1] * 255);
        bgB = Math.round(packedFloats[base + 2] * 255);
        fgR = Math.round(packedFloats[base + 4] * 255);
        fgG = Math.round(packedFloats[base + 5] * 255);
        fgB = Math.round(packedFloats[base + 6] * 255);
        codepoint = packedU32[base + 8] || 0x20;
      }

      const char = codepoint > 0 ? String.fromCodePoint(codepoint) : ' ';
      const existing = row[x];
      if (existing) {
        existing.char = char;
        existing.fg.r = fgR;
        existing.fg.g = fgG;
        existing.fg.b = fgB;
        existing.bg.r = bgR;
        existing.bg.g = bgG;
        existing.bg.b = bgB;
        existing.bold = (attributes & 1) !== 0;
        existing.italic = (attributes & 4) !== 0;
        existing.underline = (attributes & 8) !== 0;
        existing.strikethrough = (attributes & 128) !== 0;
        existing.inverse = false;
        existing.blink = false;
        existing.dim = false;
        existing.width = width;
        existing.hyperlinkId = undefined;
      } else {
        row[x] = {
          char,
          fg: { r: fgR, g: fgG, b: fgB },
          bg: { r: bgR, g: bgG, b: bgB },
          bold: (attributes & 1) !== 0,
          italic: (attributes & 4) !== 0,
          underline: (attributes & 8) !== 0,
          strikethrough: (attributes & 128) !== 0,
          inverse: false,
          blink: false,
          dim: false,
          width,
        };
      }
    }

    return row;
  }

  private ensurePackedOverlayIndex(cols: number): Int32Array {
    if (!this.packedOverlayIndex || this.packedOverlayIndexCols !== cols) {
      this.packedOverlayIndex = new Int32Array(cols);
      this.packedOverlayIndexCols = cols;
    }
    this.packedOverlayIndex.fill(-1);
    return this.packedOverlayIndex;
  }
}
