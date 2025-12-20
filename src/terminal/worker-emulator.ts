/**
 * WorkerEmulator - ITerminalEmulator implementation backed by Web Worker
 *
 * This class implements the ITerminalEmulator interface by proxying
 * operations to the EmulatorWorkerPool. It maintains a local cache
 * of terminal state that gets updated via worker callbacks.
 *
 * Key differences from GhosttyEmulator:
 * - VT parsing happens in worker thread (non-blocking)
 * - State is cached locally for synchronous access
 * - Some operations (like scrollback access) are async by nature
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
  PackedRowUpdate,
} from '../core/types';
import type { ITerminalEmulator, TerminalModes, SearchResult } from './emulator-interface';
import type { EmulatorWorkerPool } from './worker-pool';
import type { TerminalColors } from './terminal-colors';
import {
  ScrollbackCache,
  shouldClearCacheOnUpdate,
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from './worker-emulator/index';

const PACKED_CELL_U32_STRIDE = 12;
const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4;
const DEFAULT_CODEPOINT = 0x20;
const ATTR_BOLD = 1;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_STRIKETHROUGH = 128;

// ============================================================================
// WorkerEmulator Class
// ============================================================================

export class WorkerEmulator implements ITerminalEmulator {
  private pool: EmulatorWorkerPool;
  private sessionId: string;
  private _cols: number;
  private _rows: number;
  private _disposed = false;
  private colors: TerminalColors;

  // Cached state from worker updates
  private cachedState: TerminalState | null = null;
  private cachedUpdate: DirtyTerminalUpdate | null = null;
  private scrollState: TerminalScrollState = createDefaultScrollState();

  // Mode state (updated via worker callbacks)
  private modes: TerminalModes = createDefaultModes();

  // Title state
  private currentTitle = '';
  private titleCallbacks = new Set<(title: string) => void>();

  // Update callbacks (fires when worker sends state update)
  private updateCallbacks = new Set<() => void>();

  // Mode change callbacks (fires when terminal modes change)
  private modeChangeCallbacks = new Set<(modes: TerminalModes, prevModes?: TerminalModes) => void>();

  // Scrollback cache (main thread side)
  // Size 1000 provides buffer for ~40 screens during fast scrolling
  private scrollbackCache: ScrollbackCache<TerminalCell[]>;
  private scrollbackPackedCache: ScrollbackCache<PackedRowUpdate>;
  private scrollbackPackedCols = 0;
  private scrollbackRowPool: TerminalCell[][] = [];
  private readonly maxScrollbackRowPool = 1000;
  private livePackedCache: Array<PackedRowUpdate | null> = [];
  private livePackedCols = 0;
  private overlayIndexScratch: Int32Array | null = null;
  private overlayIndexCols = 0;

  // Unsubscribe functions
  private unsubUpdate: (() => void) | null = null;
  private unsubTitle: (() => void) | null = null;
  private unsubMode: (() => void) | null = null;

  constructor(
    pool: EmulatorWorkerPool,
    sessionId: string,
    cols: number,
    rows: number,
    colors: TerminalColors
  ) {
    this.pool = pool;
    this.sessionId = sessionId;
    this._cols = cols;
    this._rows = rows;
    this.colors = colors;
    this.scrollbackCache = new ScrollbackCache(1000, (row) => this.recycleScrollbackRow(row));
    this.scrollbackPackedCache = new ScrollbackCache(1000);

    // Subscribe to worker updates
    this.setupSubscriptions();
  }

  private acquireScrollbackRow(): TerminalCell[] {
    return this.scrollbackRowPool.pop() ?? [];
  }

  private recycleScrollbackRow(row: TerminalCell[]): void {
    if (this.scrollbackRowPool.length >= this.maxScrollbackRowPool) {
      return;
    }
    this.scrollbackRowPool.push(row);
  }

  private createPackedRowEntry(cols: number): PackedRowUpdate {
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

  private ensureOverlayIndexScratch(cols: number): Int32Array {
    if (!this.overlayIndexScratch || this.overlayIndexCols !== cols) {
      this.overlayIndexScratch = new Int32Array(cols);
      this.overlayIndexCols = cols;
    }
    this.overlayIndexScratch.fill(-1);
    return this.overlayIndexScratch;
  }

  private updatePackedRowEntry(
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

  private applyPackedRowsToLiveCache(packedRows: PackedRowUpdate): void {
    const rowCount = packedRows.rowIndices.length;
    if (rowCount === 0) return;

    const cols = packedRows.cols;
    if (this.livePackedCols !== cols || this.livePackedCache.length !== this._rows) {
      this.livePackedCols = cols;
      this.livePackedCache = new Array(this._rows).fill(null);
    }

    for (let i = 0; i < rowCount; i++) {
      const rowIndex = packedRows.rowIndices[i];
      if (rowIndex < 0 || rowIndex >= this._rows) continue;

      let entry = this.livePackedCache[rowIndex];
      if (!entry || entry.cols !== cols) {
        entry = this.createPackedRowEntry(cols);
        this.livePackedCache[rowIndex] = entry;
      }
      this.updatePackedRowEntry(entry, packedRows, i);
    }
  }

  private applyPackedRowsToScrollbackCache(packedRows: PackedRowUpdate): void {
    const rowCount = packedRows.rowIndices.length;
    if (rowCount === 0) return;

    const cols = packedRows.cols;
    if (this.scrollbackPackedCols !== cols) {
      this.scrollbackPackedCols = cols;
      this.scrollbackPackedCache.clear();
    }

    for (let i = 0; i < rowCount; i++) {
      const offset = packedRows.rowIndices[i];
      let entry = this.scrollbackPackedCache.get(offset);
      if (!entry || entry.cols !== cols) {
        entry = this.createPackedRowEntry(cols);
      }
      this.updatePackedRowEntry(entry, packedRows, i);
      this.scrollbackPackedCache.set(offset, entry);
    }
  }

  private decodePackedRow(entry: PackedRowUpdate, row?: TerminalCell[]): TerminalCell[] {
    const cols = entry.cols;
    const overlayIndex = this.ensureOverlayIndexScratch(cols);
    const overlayCount = entry.overlayRowStarts[1] ?? 0;

    for (let i = 0; i < overlayCount; i++) {
      const x = entry.overlayX[i];
      if (x >= 0 && x < cols) {
        overlayIndex[x] = i;
      }
    }

    const floats = new Float32Array(entry.data);
    const uints = new Uint32Array(entry.data);
    const output: TerminalCell[] = row ?? new Array(cols);
    if (output.length !== cols) {
      output.length = cols;
    }

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
        const colorOffset = overlayIdx * 4;
        fgR = entry.overlayFg[colorOffset];
        fgG = entry.overlayFg[colorOffset + 1];
        fgB = entry.overlayFg[colorOffset + 2];
        bgR = entry.overlayBg[colorOffset];
        bgG = entry.overlayBg[colorOffset + 1];
        bgB = entry.overlayBg[colorOffset + 2];
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
        bgR = Math.round(floats[base] * 255);
        bgG = Math.round(floats[base + 1] * 255);
        bgB = Math.round(floats[base + 2] * 255);
        fgR = Math.round(floats[base + 4] * 255);
        fgG = Math.round(floats[base + 5] * 255);
        fgB = Math.round(floats[base + 6] * 255);
        const baseCodepoint = uints[base + 8];
        codepoint = baseCodepoint || DEFAULT_CODEPOINT;
      }

      const char = codepoint > 0 ? String.fromCodePoint(codepoint) : ' ';
      const existing = output[x];
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
        output[x] = {
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

    return output;
  }

  private setupSubscriptions(): void {
    // Subscribe to terminal updates
    this.unsubUpdate = this.pool.onUpdate(this.sessionId, (update) => {
      this.handleUpdate(update);
    });

    // Subscribe to title changes
    this.unsubTitle = this.pool.onTitleChange(this.sessionId, (title) => {
      this.currentTitle = title;
      for (const callback of this.titleCallbacks) {
        callback(title);
      }
    });

    // Subscribe to mode changes
    this.unsubMode = this.pool.onModeChange(this.sessionId, (modes) => {
      const prevModes = { ...this.modes };
      this.modes = modes;
      // Notify mode change subscribers
      for (const callback of this.modeChangeCallbacks) {
        callback(modes, prevModes);
      }
    });
  }

  private handleUpdate(update: DirtyTerminalUpdate): void {
    this.cachedUpdate = update;

    const newScrollbackLength = update.scrollState.scrollbackLength;
    const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;

    // Smart cache invalidation using ScrollbackCache
    this.scrollbackCache.handleScrollbackChange(newScrollbackLength, isAtScrollbackLimit);
    this.scrollbackPackedCache.handleScrollbackChange(newScrollbackLength, isAtScrollbackLimit);

    // Update scroll state
    this.scrollState = {
      ...this.scrollState,
      scrollbackLength: newScrollbackLength,
    };

    // Check if cache should be cleared on mode change
    const shouldClearCache = shouldClearCacheOnUpdate(update, this.modes);

    // Update modes
    this.modes = {
      mouseTracking: update.mouseTracking,
      cursorKeyMode: update.cursorKeyMode,
      alternateScreen: update.alternateScreen,
      inBandResize: update.inBandResize ?? false,
    };

    // If full update, cache the full state
    if (update.isFull && update.fullState) {
      this.cachedState = update.fullState;
      this.livePackedCols = update.fullState.cols;
      this.livePackedCache = new Array(update.fullState.rows).fill(null);
      // Clear scrollback cache when alternate screen mode changes
      if (shouldClearCache) {
        this.scrollbackCache.clear();
        this.scrollbackPackedCache.clear();
      }
    } else {
      if (update.packedRows) {
        this.applyPackedRowsToLiveCache(update.packedRows);
      }

      if (this.cachedState) {
        if (update.dirtyRows.size > 0) {
          // Apply dirty rows to cached state (non-worker emulators)
          for (const [rowIndex, cells] of update.dirtyRows) {
            if (rowIndex >= 0 && rowIndex < this.cachedState.rows) {
              this.cachedState.cells[rowIndex] = cells;
            }
          }
        }
        this.cachedState.cursor = update.cursor;
        this.cachedState.alternateScreen = update.alternateScreen;
        this.cachedState.mouseTracking = update.mouseTracking;
        this.cachedState.cursorKeyMode = update.cursorKeyMode;
      }
    }

    // Sync scroll state to pool
    this.pool.setScrollState(this.sessionId, this.scrollState);

    // Notify update subscribers (critical for async notification)
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  // ============================================================================
  // ITerminalEmulator Implementation
  // ============================================================================

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  write(data: string | Uint8Array): void {
    if (this._disposed) return;
    this.pool.write(this.sessionId, data);
  }

  resize(cols: number, rows: number): void {
    if (this._disposed) return;

    // Skip if dimensions haven't changed (prevents unnecessary cache clear on focus changes)
    if (cols === this._cols && rows === this._rows) {
      return;
    }

    this._cols = cols;
    this._rows = rows;
    this.pool.resize(this.sessionId, cols, rows);
    // Don't clear scrollback cache here - keep stale content visible during resize
    // to prevent flash. Cache will be cleared in handleUpdate() when worker sends
    // the full state update with reflowed content.
  }

  reset(): void {
    if (this._disposed) return;
    this.pool.reset(this.sessionId);
    this.currentTitle = '';
    this.scrollbackCache.clear();
    this.scrollbackPackedCache.clear();
    this.livePackedCache = [];
    this.livePackedCols = 0;
    this.scrollbackPackedCols = 0;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Unsubscribe from updates
    this.unsubUpdate?.();
    this.unsubTitle?.();
    this.unsubMode?.();

    // Destroy session in worker
    this.pool.destroy(this.sessionId);

    // Clear local state
    this.cachedState = null;
    this.cachedUpdate = null;
    this.titleCallbacks.clear();
    this.updateCallbacks.clear();
    this.scrollbackCache.clear();
    this.scrollbackPackedCache.clear();
    this.livePackedCache = [];
    this.livePackedCols = 0;
    this.scrollbackPackedCols = 0;
    this.scrollbackRowPool.length = 0;
  }

  getScrollbackLength(): number {
    return this.scrollState.scrollbackLength;
  }

  /**
   * Get a scrollback line from cache (synchronous).
   * Returns null if not cached - use getScrollbackLineAsync for guaranteed access.
   */
  getScrollbackLine(offset: number): TerminalCell[] | null {
    const cached = this.scrollbackCache.get(offset);
    if (cached) return cached;

    const packed = this.scrollbackPackedCache.get(offset);
    if (!packed) return null;

    const row = this.decodePackedRow(packed, this.acquireScrollbackRow());
    this.scrollbackCache.set(offset, row);
    return row;
  }

  /**
   * Get a packed scrollback line from cache (synchronous).
   * Returns null if not cached.
   */
  getScrollbackLinePacked(offset: number): PackedRowUpdate | null {
    return this.scrollbackPackedCache.get(offset);
  }

  /**
   * Get a live terminal line from packed cache (synchronous).
   * Falls back to cached state when packed rows are unavailable.
   */
  getLine(row: number): TerminalCell[] | null {
    if (row < 0 || row >= this._rows) return null;
    const packed = this.livePackedCache[row];
    if (packed && packed.cols === this._cols) {
      const reuse = this.cachedState?.cells[row];
      return this.decodePackedRow(packed, reuse);
    }
    return this.cachedState?.cells[row] ?? null;
  }

  /**
   * Get a scrollback line asynchronously (fetches from worker if needed)
   */
  async getScrollbackLineAsync(offset: number): Promise<TerminalCell[] | null> {
    // Check cache first
    const cached = this.getScrollbackLine(offset);
    if (cached) return cached;

    // Fetch from worker
    const packed = await this.pool.getScrollbackLine(this.sessionId, offset);
    if (packed) {
      this.applyPackedRowsToScrollbackCache(packed);
      return this.getScrollbackLine(offset);
    }

    return null;
  }

  /**
   * Prefetch scrollback lines into cache
   */
  async prefetchScrollbackLines(startOffset: number, count: number): Promise<void> {
    const packed = await this.pool.getScrollbackLines(this.sessionId, startOffset, count);
    if (!packed) return;
    this.applyPackedRowsToScrollbackCache(packed);
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    // Update our scroll state
    this.scrollState = scrollState;
    this.pool.setScrollState(this.sessionId, scrollState);

    // Return cached update or create empty one
    if (this.cachedUpdate) {
      // Return and clear the cached update
      // Merge scroll states: preserve isAtScrollbackLimit from cached update (set by worker)
      // while using viewportOffset and isAtBottom from the passed scrollState
      const mergedScrollState: TerminalScrollState = {
        ...scrollState,
        isAtScrollbackLimit: this.cachedUpdate.scrollState.isAtScrollbackLimit,
      };
      const update = {
        ...this.cachedUpdate,
        scrollState: mergedScrollState,
      };
      this.cachedUpdate = null;
      return update;
    }

    // No pending update - return empty
    return createEmptyDirtyUpdate(
      this._cols,
      this._rows,
      scrollState,
      this.modes,
      this.cachedState?.cursor
    );
  }

  getTerminalState(): TerminalState {
    const baseState = this.cachedState ?? createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
    const rows = this._rows;
    const cols = this._cols;
    const cells: TerminalCell[][] = new Array(rows);

    for (let y = 0; y < rows; y++) {
      const packed = this.livePackedCache[y];
      if (packed && packed.cols === cols) {
        cells[y] = this.decodePackedRow(packed, baseState.cells[y]);
      } else {
        cells[y] = baseState.cells[y] ?? [];
      }
    }

    return {
      ...baseState,
      cols,
      rows,
      cells,
      cursor: this.cachedUpdate?.cursor ?? baseState.cursor,
      alternateScreen: this.modes.alternateScreen,
      mouseTracking: this.modes.mouseTracking,
      cursorKeyMode: this.modes.cursorKeyMode,
    };
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    if (this.cachedState?.cursor) {
      return {
        x: this.cachedState.cursor.x,
        y: this.cachedState.cursor.y,
        visible: this.cachedState.cursor.visible,
      };
    }
    return { x: 0, y: 0, visible: true };
  }

  getCursorKeyMode(): 'normal' | 'application' {
    return this.modes.cursorKeyMode;
  }

  isMouseTrackingEnabled(): boolean {
    return this.modes.mouseTracking;
  }

  isAlternateScreen(): boolean {
    return this.modes.alternateScreen;
  }

  getMode(mode: number): boolean {
    // For now, only support the modes we track
    switch (mode) {
      case 1: // DECCKM
        return this.modes.cursorKeyMode === 'application';
      case 1000:
      case 1002:
      case 1003:
        return this.modes.mouseTracking;
      case 2048: // DECSET 2048 - in-band resize notifications
        return this.modes.inBandResize;
      default:
        return false;
    }
  }

  getColors(): TerminalColors {
    return this.colors;
  }

  getTitle(): string {
    return this.currentTitle;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleCallbacks.add(callback);
    // Immediately call with current title if set
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => {
      this.modeChangeCallbacks.delete(callback);
    };
  }

  // ============================================================================
  // Worker-Specific Methods
  // ============================================================================

  /**
   * Get the session ID for this emulator
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Search for text in terminal (async, executed in worker)
   */
  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    return this.pool.search(this.sessionId, query, options);
  }

  /**
   * Get current scroll state
   */
  getScrollState(): TerminalScrollState {
    return this.scrollState;
  }

  /**
   * Set scroll state
   */
  setScrollState(state: TerminalScrollState): void {
    this.scrollState = state;
    this.pool.setScrollState(this.sessionId, state);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new WorkerEmulator
 *
 * This function is non-blocking - session creation happens asynchronously
 * in the worker pool. The worker buffers any incoming writes until the
 * session is fully initialized.
 */
export function createWorkerEmulator(
  pool: EmulatorWorkerPool,
  cols: number,
  rows: number,
  colors: TerminalColors
): WorkerEmulator {
  const sessionId = generateSessionId();
  pool.createSession(sessionId, cols, rows, colors);
  return new WorkerEmulator(pool, sessionId, cols, rows, colors);
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
