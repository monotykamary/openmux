/**
 * Terminal Renderer - handles the main render loop for TerminalView
 */
import type { OptimizedBuffer, RGBA } from '@opentui/core';
import type { TerminalCell, PackedRowUpdate } from '../../core/types';
import { isAtBottom as checkIsAtBottom } from '../../core/scroll-utils';
import {
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE,
  BLACK,
  WHITE,
  SEARCH_CURRENT_BG,
  SEARCH_CURRENT_FG,
  SEARCH_MATCH_BG,
  SEARCH_MATCH_FG,
  SELECTION_BG,
  SELECTION_FG,
  getCachedRGBA,
  SCROLLBAR_TRACK,
  SCROLLBAR_THUMB,
} from '../../terminal/rendering';
import {
  PACKED_CELL_BYTE_STRIDE,
  renderRow,
  fetchRowsForRendering,
  calculatePrefetchRequest,
  packRowForBatch,
  drawPackedRowBatch,
  type PackedRowBatchBuffer,
} from './index';
import type { TerminalViewState } from './terminal-view-state';

export interface RenderContext {
  ptyId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  isFocused: boolean;
}

export interface SearchState {
  ptyId: string;
  matches: Array<{ lineIndex: number; startCol: number; endCol: number }>;
  currentMatchIndex: number;
}

export interface RenderDeps {
  isCellSelected: (ptyId: string, x: number, y: number) => boolean;
  getSelectedColumnsForRow: (ptyId: string, absoluteY: number, rowWidth: number) => { start: number; end: number } | null;
  isSearchMatch: (ptyId: string, x: number, y: number) => boolean;
  isCurrentMatch: (ptyId: string, x: number, y: number) => boolean;
  getSelection: (ptyId: string) => { normalizedRange?: unknown } | null | undefined;
  getSearchMatchRanges: (ptyId: string, absoluteY: number) => Array<{ startCol: number; endCol: number }> | null;
  searchState: SearchState | null;
}

export function renderTerminal(
  buffer: OptimizedBuffer,
  state: TerminalViewState,
  ctx: RenderContext,
  deps: RenderDeps
): void {
  const termState = state.terminalState;
  const { width, height, offsetX, offsetY, isFocused, ptyId } = ctx;

  if (!termState) {
    clearBuffer(buffer, width, height, offsetX, offsetY);
    return;
  }

  const viewportOffset = state.scrollState.viewportOffset;
  const scrollbackLength = state.scrollState.scrollbackLength;
  const isAtBottom = checkIsAtBottom(viewportOffset);

  const rows = Math.min(termState.rows, height);
  const cols = Math.min(termState.cols, width);

  // Handle dimension changes
  if (handleDimensionChanges(state, rows, cols, width, height)) {
    state.dirtyAll = true;
  }

  // Ensure buffers
  state.ensureRowTextCache(rows);
  state.ensurePackedRowBuffer(cols);
  state.ensurePackedRowBatchBuffer(cols, rows);
  state.packedRowCache.ensurePackedRowCache(rows, cols);
  state.updateRowRenderCache();

  // Apply pending packed rows
  applyPendingPackedRows(state, rows, cols);

  // Handle focus changes
  if (state.lastIsFocused !== isFocused) {
    if (isAtBottom && termState.cursor.visible) {
      state.markRowDirty(termState.cursor.y, false);
    }
    state.lastIsFocused = isFocused;
  }

  const fallbackBgColor = termState.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
  const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
  const fallbackFg = BLACK;

  state.ensureFrameBuffer(width, height, buffer);
  const renderTarget = state.frameBuffer ?? buffer;
  const renderOffsetX = state.frameBuffer ? 0 : offsetX;
  const renderOffsetY = state.frameBuffer ? 0 : offsetY;

  // Get row cache
  const rowCache = getRowCache(state, termState, viewportOffset, scrollbackLength, rows, cols, ptyId);

  // Check selection/search state
  const hasSelection = !!deps.getSelection(ptyId)?.normalizedRange;
  const currentSearchState = deps.searchState;
  const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;
  const currentMatch = hasSearch && currentSearchState && currentSearchState.currentMatchIndex >= 0
    ? currentSearchState.matches[currentSearchState.currentMatchIndex] ?? null
    : null;

  if (hasSelection !== state.lastHadSelection || hasSearch !== state.lastHadSearch) {
    state.dirtyAll = true;
    state.lastHadSelection = hasSelection;
    state.lastHadSearch = hasSearch;
  }

  const renderOptions = {
    ptyId,
    hasSelection,
    hasSearch,
    isAtBottom,
    isFocused,
    cursorX: termState.cursor.x,
    cursorY: termState.cursor.y,
    cursorVisible: termState.cursor.visible,
    scrollbackLength,
    viewportOffset,
    currentMatch,
  };

  const useFullRender = state.dirtyAll || !state.dirtyRows;
  const cursorRow = (isAtBottom && isFocused && termState.cursor.visible) ? termState.cursor.y : -1;
  const cursorCol = (isAtBottom && isFocused && termState.cursor.visible) ? termState.cursor.x : -1;

  // Render rows
  renderRows(
    renderTarget,
    state,
    rowCache,
    rows,
    cols,
    renderOffsetX,
    renderOffsetY,
    renderOptions,
    deps,
    fallbackFg,
    fallbackBg,
    useFullRender,
    cursorRow,
    cursorCol,
    viewportOffset,
    scrollbackLength
  );

  // Render scrollbar
  if (!isAtBottom && scrollbackLength > 0) {
    renderScrollbar(
      renderTarget,
      rowCache,
      rows,
      cols,
      width,
      renderOffsetX,
      renderOffsetY,
      scrollbackLength,
      viewportOffset,
      fallbackFg
    );
  }

  // Clear dirty flags
  if (useFullRender && state.dirtyRows) {
    state.dirtyRows.fill(0);
  }
  state.dirtyAll = false;

  // Paint padding
  paintPadding(state, renderTarget, cols, rows, width, height, renderOffsetX, renderOffsetY, fallbackFg, fallbackBg);

  // Composite frame buffer
  if (state.frameBuffer) {
    buffer.drawFrameBuffer(offsetX, offsetY, state.frameBuffer);
  }
}

function clearBuffer(buffer: OptimizedBuffer, width: number, height: number, offsetX: number, offsetY: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
    }
  }
}

function handleDimensionChanges(state: TerminalViewState, rows: number, cols: number, width: number, height: number): boolean {
  const colsChanged = cols !== state.lastRenderCols;
  let changed = false;

  if (rows !== state.lastRenderRows || colsChanged || width !== state.lastRenderWidth || height !== state.lastRenderHeight) {
    changed = true;
    state.lastRenderRows = rows;
    state.lastRenderCols = cols;
    state.lastRenderWidth = width;
    state.lastRenderHeight = height;
  }

  if (colsChanged) {
    state.clearRowTextCache();
    state.packedRowCache.clearPackedRowCache();
    state.packedRowCache.clearScrollbackPackedCache();
    state.pendingPackedRows = null;
  }

  return changed;
}

function applyPendingPackedRows(state: TerminalViewState, rows: number, cols: number): void {
  if (
    state.pendingPackedRows &&
    state.packedRowCache.packedRowCache &&
    state.packedRowCache.packedRowCacheDirty &&
    state.pendingPackedRows.cols === cols
  ) {
    state.packedRowCache.applyPackedRowUpdate(state.pendingPackedRows, rows);
    state.pendingPackedRows = null;
  } else if (state.pendingPackedRows && state.pendingPackedRows.cols !== cols) {
    state.pendingPackedRows = null;
  }
}

function getRowCache(
  state: TerminalViewState,
  termState: { cells: TerminalCell[][]; rows: number; cols: number },
  viewportOffset: number,
  scrollbackLength: number,
  rows: number,
  cols: number,
  ptyId: string
): (TerminalCell[] | null)[] {
  if (viewportOffset === 0) {
    return termState.cells as (TerminalCell[] | null)[];
  }

  const hasScrollbackPackedLine = (offset: number) => {
    if (!state.emulator) return false;
    const packedGetter = (state.emulator as { getScrollbackLinePacked?: (line: number) => PackedRowUpdate | null })
      .getScrollbackLinePacked;
    if (!packedGetter) return false;
    const packed = packedGetter.call(state.emulator, offset);
    if (!packed || packed.cols !== cols) return false;
    state.packedRowCache.ensureScrollbackPackedCache(cols);
    state.packedRowCache.cacheScrollbackPackedRows(packed);
    return true;
  };

  const missingRows = state.ensureMissingRowsBuffer(rows);
  const { rowCache, firstMissingOffset, lastMissingOffset } = fetchRowsForRendering(
    termState as import('../../core/types').TerminalState,
    state.emulator,
    state.transitionCache,
    { viewportOffset, scrollbackLength, rows, getScrollbackLinePacked: hasScrollbackPackedLine },
    state.scrollbackRowCache,
    missingRows ?? undefined
  );

  // Schedule prefetch
  const prefetchRequest = firstMissingOffset === -1
    ? null
    : calculatePrefetchRequest(ptyId, firstMissingOffset, lastMissingOffset, scrollbackLength, rows);

  if (prefetchRequest && !state.prefetchInProgress && state.executePrefetchFn) {
    state.pendingPrefetch = prefetchRequest;
    state.pendingMissingRows = state.snapshotMissingRows(missingRows, viewportOffset, scrollbackLength, rows);
    if (!state.prefetchScheduled) {
      state.prefetchScheduled = true;
      queueMicrotask(() => {
        state.prefetchScheduled = false;
        state.executePrefetchFn?.();
      });
    }
  } else {
    state.pendingMissingRows = null;
  }

  return rowCache;
}

function renderRows(
  target: OptimizedBuffer,
  state: TerminalViewState,
  rowCache: (TerminalCell[] | null)[],
  rows: number,
  cols: number,
  offsetX: number,
  offsetY: number,
  options: {
    ptyId: string;
    hasSelection: boolean;
    hasSearch: boolean;
    isAtBottom: boolean;
    isFocused: boolean;
    cursorX: number;
    cursorY: number;
    cursorVisible: boolean;
    scrollbackLength: number;
    viewportOffset: number;
    currentMatch: { lineIndex: number; startCol: number; endCol: number } | null;
  },
  deps: RenderDeps,
  fallbackFg: RGBA,
  fallbackBg: RGBA,
  useFullRender: boolean,
  cursorRow: number,
  cursorCol: number,
  viewportOffset: number,
  scrollbackLength: number
): void {
  const { packedRowBatchBuffer, packedRowCache, rowTextCache, dirtyRows } = state;
  const allowPackedBatch = !!packedRowBatchBuffer;
  const needsRowHighlightCheck = options.hasSelection || options.hasSearch;
  const absoluteRowBase = scrollbackLength - viewportOffset;
  const rowByteStride = cols * PACKED_CELL_BYTE_STRIDE;

  let batchStart = 0;
  let batchRowCount = 0;

  const flushBatch = () => {
    if (!packedRowBatchBuffer || batchRowCount === 0) return;
    drawPackedRowBatch(target, packedRowBatchBuffer, cols, offsetX, offsetY, batchStart, batchRowCount);
    batchRowCount = 0;
  };

  for (let y = 0; y < rows; y++) {
    if (!useFullRender && dirtyRows && dirtyRows[y] === 0) {
      flushBatch();
      continue;
    }

    const row = rowCache[y];
    const rowDirty = !dirtyRows || dirtyRows[y] === 1;
    const absoluteY = absoluteRowBase + y;
    const isScrollbackRow = viewportOffset > 0 && absoluteY < scrollbackLength;
    const isLiveRow = !isScrollbackRow;

    // Check for highlights
    let rowHasHighlights = y === cursorRow;
    let selectedRange: { start: number; end: number } | null = null;
    let matchRanges: Array<{ startCol: number; endCol: number }> | null = null;
    let currentMatchStart = -1;
    let currentMatchEnd = -1;

    if (allowPackedBatch && needsRowHighlightCheck) {
      if (options.hasSelection) {
        selectedRange = deps.getSelectedColumnsForRow(options.ptyId, absoluteY, cols);
        if (selectedRange) rowHasHighlights = true;
      }
      if (options.hasSearch) {
        matchRanges = deps.getSearchMatchRanges(options.ptyId, absoluteY);
        if (matchRanges?.length) rowHasHighlights = true;
        if (options.currentMatch?.lineIndex === absoluteY && options.currentMatch.startCol >= 0) {
          currentMatchStart = options.currentMatch.startCol;
          currentMatchEnd = options.currentMatch.endCol;
          rowHasHighlights = true;
        }
      }
    }

    // Get packed entry
    let packedEntry: PackedRowBatchBuffer | null = null;
    let packedEntryDirty = rowDirty;

    if (allowPackedBatch) {
      if (isScrollbackRow) {
        packedEntry = packedRowCache.getScrollbackPackedEntry(absoluteY, cols);
        packedEntryDirty = false;
      } else if (packedRowCache.packedRowCache) {
        packedEntry = packedRowCache.packedRowCache[y];
        packedEntryDirty = packedRowCache.packedRowCacheDirty ? packedRowCache.packedRowCacheDirty[y] === 1 : rowDirty;
      }
    }

    let renderRowData = row;

    // Get fresh data for live rows without packed cache
    if (isLiveRow && !packedEntry && state.emulator) {
      const liveLineGetter = (state.emulator as { getLine?: (row: number) => TerminalCell[] | null }).getLine;
      if (liveLineGetter) {
        const freshRow = liveLineGetter.call(state.emulator, y);
        if (freshRow) {
          renderRowData = freshRow;
          rowCache[y] = freshRow;
        }
      }
    }

    // Decode packed entry for highlight rows
    if (rowHasHighlights && packedEntry) {
      renderRowData = packedRowCache.decodePackedRowEntry(packedEntry, cols, rowCache[y] ?? undefined);
      rowCache[y] = renderRowData;
    }

    // Render row with highlights
    if (allowPackedBatch && rowHasHighlights && packedRowBatchBuffer && (packedEntry || (isLiveRow && renderRowData))) {
      renderHighlightedRow(
        target, state, y, cols, offsetX, offsetY, renderRowData, packedEntry, packedEntryDirty, isLiveRow,
        selectedRange, matchRanges, currentMatchStart, currentMatchEnd, cursorRow, cursorCol, fallbackFg, fallbackBg
      );
      flushBatch();
      if (!useFullRender && dirtyRows) dirtyRows[y] = 0;
      continue;
    }

    // Try batch rendering
    if (allowPackedBatch && !rowHasHighlights && (packedEntry || (isLiveRow && renderRowData)) && packedRowBatchBuffer) {
      let cachedEntry = packedEntry;
      if (isLiveRow) {
        if (!cachedEntry) {
          cachedEntry = packedRowCache.createEntry(cols);
          if (packedRowCache.packedRowCache) packedRowCache.packedRowCache[y] = cachedEntry;
          packedEntryDirty = true;
        }
        if (packedEntryDirty && renderRowData) {
          cachedEntry.overlayCount = 0;
          packRowForBatch(renderRowData, y, cols, fallbackFg, fallbackBg, rowTextCache, cachedEntry, 0);
          if (packedRowCache.packedRowCacheDirty) packedRowCache.packedRowCacheDirty[y] = 0;
        }
      }

      if (batchRowCount === 0) {
        batchStart = y;
        packedRowBatchBuffer.overlayCount = 0;
      }

      if (cachedEntry && appendToBatch(packedRowBatchBuffer, cachedEntry, batchRowCount, cols, rowByteStride)) {
        batchRowCount++;
        if (!useFullRender && dirtyRows) dirtyRows[y] = 0;
        continue;
      }
    }

    // Fallback to row-by-row render
    flushBatch();
    const cellDeps = {
      isCellSelected: deps.isCellSelected,
      getSelectedColumnsForRow: deps.getSelectedColumnsForRow,
      isSearchMatch: deps.isSearchMatch,
      isCurrentMatch: deps.isCurrentMatch,
      getSelection: (ptyId: string) => {
        const sel = deps.getSelection(ptyId);
        if (!sel || sel.normalizedRange === undefined) return undefined;
        return { normalizedRange: sel.normalizedRange };
      },
      getSearchMatchRanges: deps.getSearchMatchRanges,
    };
    renderRow(target, renderRowData, y, cols, offsetX, offsetY, options, cellDeps, fallbackFg, fallbackBg, state.rowRenderCache ?? undefined);
    if (!useFullRender && dirtyRows) dirtyRows[y] = 0;
  }

  flushBatch();
}

function appendToBatch(
  batch: PackedRowBatchBuffer,
  entry: PackedRowBatchBuffer,
  batchRowIndex: number,
  cols: number,
  rowByteStride: number
): boolean {
  if (entry.capacityCols < cols || batchRowIndex >= batch.capacityRows) return false;

  const destOffset = batchRowIndex * rowByteStride;
  batch.bytes.set(entry.bytes, destOffset);

  const overlayCount = entry.overlayCount;
  if (overlayCount === 0) return true;

  const overlayBase = batch.overlayCount;
  if (overlayBase + overlayCount > batch.overlayX.length) return false;

  for (let i = 0; i < overlayCount; i++) {
    const targetIndex = overlayBase + i;
    batch.overlayX[targetIndex] = entry.overlayX[i];
    batch.overlayY[targetIndex] = batchRowIndex;
    batch.overlayCodepoint[targetIndex] = entry.overlayCodepoint[i];
    batch.overlayAttributes[targetIndex] = entry.overlayAttributes[i];
    batch.overlayFg[targetIndex] = entry.overlayFg[i];
    batch.overlayBg[targetIndex] = entry.overlayBg[i];
  }
  batch.overlayCount = overlayBase + overlayCount;
  return true;
}

function renderHighlightedRow(
  target: OptimizedBuffer,
  state: TerminalViewState,
  y: number,
  cols: number,
  offsetX: number,
  offsetY: number,
  renderRowData: TerminalCell[] | null,
  packedEntry: PackedRowBatchBuffer | null,
  packedEntryDirty: boolean,
  isLiveRow: boolean,
  selectedRange: { start: number; end: number } | null,
  matchRanges: Array<{ startCol: number; endCol: number }> | null,
  currentMatchStart: number,
  currentMatchEnd: number,
  cursorRow: number,
  cursorCol: number,
  fallbackFg: RGBA,
  fallbackBg: RGBA
): void {
  const { packedRowCache, packedRowBatchBuffer, rowTextCache } = state;

  let cachedEntry = packedRowCache.packedRowCache ? packedRowCache.packedRowCache[y] : null;
  if (isLiveRow) {
    cachedEntry = packedEntry;
    if (!cachedEntry) {
      cachedEntry = packedRowCache.createEntry(cols);
      if (packedRowCache.packedRowCache) packedRowCache.packedRowCache[y] = cachedEntry;
      packedEntryDirty = true;
    }
    if (packedEntryDirty && renderRowData) {
      cachedEntry.overlayCount = 0;
      packRowForBatch(renderRowData, y, cols, fallbackFg, fallbackBg, rowTextCache, cachedEntry, 0);
      if (packedRowCache.packedRowCacheDirty) packedRowCache.packedRowCacheDirty[y] = 0;
    }
  } else {
    cachedEntry = packedEntry;
  }

  drawPackedRowBatch(
    target,
    cachedEntry ?? packedEntry ?? packedRowCache.createEntry(cols),
    cols,
    offsetX,
    offsetY,
    y,
    1,
    false
  );

  const rowY = y + offsetY;

  // Draw search matches
  if (renderRowData && matchRanges) {
    for (const range of matchRanges) {
      const start = Math.max(range.startCol, 0);
      const end = Math.min(range.endCol, cols);
      for (let x = start; x < end; x++) {
        drawHighlightedCell(target, renderRowData, rowY, x, offsetX, cols, SEARCH_MATCH_FG, SEARCH_MATCH_BG);
      }
    }
  }

  // Draw current match
  if (renderRowData && currentMatchStart >= 0 && currentMatchEnd > currentMatchStart) {
    const start = Math.max(currentMatchStart, 0);
    const end = Math.min(currentMatchEnd, cols);
    for (let x = start; x < end; x++) {
      drawHighlightedCell(target, renderRowData, rowY, x, offsetX, cols, SEARCH_CURRENT_FG, SEARCH_CURRENT_BG);
    }
  }

  // Draw selection
  if (renderRowData && selectedRange) {
    const start = Math.max(selectedRange.start, 0);
    const end = Math.min(selectedRange.end, cols - 1);
    for (let x = start; x <= end; x++) {
      drawHighlightedCell(target, renderRowData, rowY, x, offsetX, cols, SELECTION_FG, SELECTION_BG);
    }
  }

  // Draw cursor
  if (renderRowData && y === cursorRow && cursorCol >= 0 && cursorCol < cols) {
    drawCursorCell(target, renderRowData, rowY, cursorCol, offsetX, cols);
  }
}

function drawHighlightedCell(
  target: OptimizedBuffer,
  row: TerminalCell[],
  rowY: number,
  x: number,
  offsetX: number,
  cols: number,
  fg: RGBA,
  bg: RGBA
): void {
  const cell = row[x] ?? null;
  if (!cell) {
    const prevCell = x > 0 ? row[x - 1] ?? null : null;
    if (prevCell?.width === 2) {
      target.drawChar(0, x + offsetX, rowY, bg, bg, 0);
    }
    return;
  }

  let attributes = 0;
  if (cell.bold) attributes |= ATTR_BOLD;
  if (cell.italic) attributes |= ATTR_ITALIC;
  if (cell.underline) attributes |= ATTR_UNDERLINE;
  if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

  const char = cell.char || ' ';
  const codepoint = char.codePointAt(0) ?? 0x20;

  if (codepoint > 0x7f) {
    target.drawChar(codepoint, x + offsetX, rowY, fg, bg, attributes);
  } else {
    target.setCell(x + offsetX, rowY, char, fg, bg, attributes);
  }

  if (cell.width === 2 && x + 1 < cols) {
    target.drawChar(0, x + 1 + offsetX, rowY, bg, bg, 0);
  }
}

function drawCursorCell(
  target: OptimizedBuffer,
  row: TerminalCell[],
  rowY: number,
  x: number,
  offsetX: number,
  cols: number
): void {
  const cell = row[x] ?? null;
  if (!cell) return;

  let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
  let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

  if (cell.dim) {
    fgR = Math.floor(fgR * 0.5);
    fgG = Math.floor(fgG * 0.5);
    fgB = Math.floor(fgB * 0.5);
  }

  if (cell.inverse) {
    [fgR, bgR] = [bgR, fgR];
    [fgG, bgG] = [bgG, fgG];
    [fgB, bgB] = [bgB, fgB];
  }

  const bg = getCachedRGBA(bgR, bgG, bgB);
  const cursorFg = bg ?? BLACK;
  drawHighlightedCell(target, row, rowY, x, offsetX, cols, cursorFg, WHITE);
}

function renderScrollbar(
  target: OptimizedBuffer,
  rowCache: (TerminalCell[] | null)[],
  rows: number,
  cols: number,
  width: number,
  offsetX: number,
  offsetY: number,
  scrollbackLength: number,
  viewportOffset: number,
  fallbackFg: RGBA
): void {
  const totalLines = scrollbackLength + rows;
  const thumbHeight = Math.max(1, Math.floor(rows * rows / totalLines));
  const scrollRange = rows - thumbHeight;
  const thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange);
  const scrollbarX = offsetX + width - 1;
  const contentCol = cols - 1;

  for (let y = 0; y < rows; y++) {
    const row = rowCache[y];
    const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight;
    const contentCell = contentCol >= 0 ? row?.[contentCol] ?? null : null;
    const underlyingChar = contentCell?.char || ' ';
    const underlyingFg = contentCell
      ? getCachedRGBA(contentCell.fg.r, contentCell.fg.g, contentCell.fg.b)
      : fallbackFg;

    const codepoint = underlyingChar.codePointAt(0) ?? 0x20;
    const bg = isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK;

    if (codepoint > 0x7f) {
      target.drawChar(codepoint, scrollbarX, y + offsetY, underlyingFg, bg, 0);
    } else {
      target.setCell(scrollbarX, y + offsetY, underlyingChar, underlyingFg, bg, 0);
    }
  }
}

function paintPadding(
  state: TerminalViewState,
  target: OptimizedBuffer,
  cols: number,
  rows: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  fallbackFg: RGBA,
  fallbackBg: RGBA
): void {
  const paddingActive = cols < width || rows < height;

  if (paddingActive) {
    const shouldClear = !state.paddingWasActive ||
      cols !== state.lastPaddingCols ||
      rows !== state.lastPaddingRows ||
      width !== state.lastPaddingWidth ||
      height !== state.lastPaddingHeight ||
      fallbackBg !== state.lastPaddingBg;

    if (shouldClear) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          target.setCell(x + offsetX, y + offsetY, ' ', fallbackFg, fallbackBg, 0);
        }
      }
    }

    state.paddingWasActive = true;
    state.lastPaddingCols = cols;
    state.lastPaddingRows = rows;
    state.lastPaddingWidth = width;
    state.lastPaddingHeight = height;
    state.lastPaddingBg = fallbackBg;
  } else {
    state.paddingWasActive = false;
  }
}
