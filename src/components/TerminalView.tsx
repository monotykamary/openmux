/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { OptimizedBuffer, type RGBA } from '@opentui/core';
import type { TerminalState, TerminalCell, TerminalScrollState, UnifiedTerminalUpdate, PackedRowUpdate } from '../core/types';
import { isAtBottom as checkIsAtBottom } from '../core/scroll-utils';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import {
  getTerminalState,
  subscribeUnifiedToPty,
  getEmulator,
  prefetchScrollbackLines,
} from '../effect/bridge';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import {
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE,
  BLACK,
  SEARCH_CURRENT_BG,
  SEARCH_CURRENT_FG,
  SEARCH_MATCH_BG,
  SEARCH_MATCH_FG,
  SELECTION_BG,
  SELECTION_FG,
  WHITE,
  getCachedRGBA,
  SCROLLBAR_TRACK,
  SCROLLBAR_THUMB,
} from '../terminal/rendering';
import {
  PACKED_CELL_BYTE_STRIDE,
  renderRow,
  fetchRowsForRendering,
  calculatePrefetchRequest,
  updateTransitionCache,
  packRowForBatch,
  drawPackedRowBatch,
  type PackedRowBuffer,
  type PackedRowBatchBuffer,
  type RowTextCache,
  type RowRenderCache,
  type MissingRowBuffer,
} from './terminal-view';

interface TerminalViewProps {
  ptyId: string;
  width: number;
  height: number;
  isFocused: boolean;
  /** X offset in the parent buffer (for direct buffer rendering) */
  offsetX?: number;
  /** Y offset in the parent buffer (for direct buffer rendering) */
  offsetY?: number;
}

interface MissingRowSnapshot {
  viewportOffset: number;
  scrollbackLength: number;
  rows: number;
  count: number;
  rowIndices: Int32Array;
  offsets: Int32Array;
}

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export function TerminalView(props: TerminalViewProps) {
  const renderer = useRenderer();
  // Get selection state - keep full context to access selectionVersion reactively
  const selection = useSelection();
  const { isCellSelected, getSelectedColumnsForRow, getSelection } = selection;
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch, getSearchMatchRanges } = search;
  // Store terminal state in a plain variable (Solid has no stale closures)
  let terminalState: TerminalState | null = null;
  // Store scroll state locally from unified updates to avoid race conditions
  // This ensures scroll state and terminal state are always in sync
  let scrollState: TerminalScrollState = { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true };
  // Track dirty rows for partial rendering when safe
  let dirtyRows: Uint8Array | null = null;
  let dirtyAll = true;
  let lastHadSelection = false;
  let lastHadSearch = false;
  let lastIsFocused = props.isFocused;
  let lastRenderRows = 0;
  let lastRenderCols = 0;
  let lastRenderWidth = 0;
  let lastRenderHeight = 0;
  let lastSelectionRef: unknown = null;
  let lastSearchRef: unknown = null;
  let lastSearchPtyId: string | null = null;
  let paddingWasActive = false;
  let lastPaddingCols = 0;
  let lastPaddingRows = 0;
  let lastPaddingWidth = 0;
  let lastPaddingHeight = 0;
  let lastPaddingBg: RGBA | null = null;
  let frameBuffer: OptimizedBuffer | null = null;
  let frameBufferWidth = 0;
  let frameBufferHeight = 0;
  let packedRowBuffer: PackedRowBuffer | null = null;
  let packedRowBatchBuffer: PackedRowBatchBuffer | null = null;
  let packedRowCache: Array<PackedRowBatchBuffer | null> | null = null;
  let packedRowCacheCols = 0;
  let packedRowCacheDirty: Uint8Array | null = null;
  let rowTextCache: RowTextCache | null = null;
  let rowRenderCache: RowRenderCache | null = null;
  let missingRowsBuffer: MissingRowBuffer | null = null;
  let pendingMissingRows: MissingRowSnapshot | null = null;
  let pendingPackedRows: PackedRowUpdate | null = null;
  // Cache for lines transitioning from live terminal to scrollback
  // When scrollback grows, the top rows of the terminal move to scrollback.
  // We capture them before the state update so we can render them immediately
  // without waiting for async prefetch from the worker.
  const transitionCache = new Map<number, TerminalCell[]>();
  let scrollbackRowCache: (TerminalCell[] | null)[] = [];
  // Cache emulator for sync access to scrollback lines
  let emulator: ITerminalEmulator | null = null;
  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = createSignal(0);
  // Track pending scrollback prefetch to avoid duplicate requests
  let pendingPrefetch: { ptyId: string; start: number; count: number } | null = null;
  let prefetchInProgress = false;
  let prefetchScheduled = false;
  // Function reference for executing prefetch (set by effect, used by render)
  let executePrefetchFn: (() => void) | null = null;

  const clearRowTextCache = (rowIndex?: number) => {
    if (!rowTextCache) return;
    if (rowIndex === undefined) {
      rowTextCache.fill(null);
      return;
    }
    if (rowIndex >= 0 && rowIndex < rowTextCache.length) {
      rowTextCache[rowIndex] = null;
    }
  };

  const markAllRowsDirty = (rowCount: number) => {
    if (rowCount <= 0) {
      dirtyRows = null;
      clearRowTextCache();
      clearPackedRowCache();
      return;
    }
    if (!dirtyRows || dirtyRows.length !== rowCount) {
      dirtyRows = new Uint8Array(rowCount);
    }
    dirtyRows.fill(1);
    clearRowTextCache();
    clearPackedRowCache();
  };

  const markRowDirty = (rowIndex: number, invalidateCache = true) => {
    if (!dirtyRows || rowIndex < 0 || rowIndex >= dirtyRows.length) return;
    dirtyRows[rowIndex] = 1;
    if (invalidateCache) {
      clearRowTextCache(rowIndex);
      clearPackedRowCache(rowIndex);
    }
  };

  const ensureFrameBuffer = (width: number, height: number, buffer: OptimizedBuffer) => {
    if (!frameBuffer) {
      frameBuffer = OptimizedBuffer.create(width, height, buffer.widthMethod, {
        respectAlpha: buffer.respectAlpha,
      });
      frameBufferWidth = width;
      frameBufferHeight = height;
      dirtyAll = true;
      return;
    }

    if (frameBufferWidth !== width || frameBufferHeight !== height) {
      frameBuffer.resize(width, height);
      frameBufferWidth = width;
      frameBufferHeight = height;
      dirtyAll = true;
    }
  };

  const ensurePackedRowBuffer = (cols: number) => {
    if (cols <= 0) return;
    if (!packedRowBuffer || packedRowBuffer.capacity < cols) {
      const buffer = new ArrayBuffer(cols * PACKED_CELL_BYTE_STRIDE);
      packedRowBuffer = {
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
  };

  const ensurePackedRowBatchBuffer = (cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) return;
    if (
      !packedRowBatchBuffer ||
      packedRowBatchBuffer.capacityCols < cols ||
      packedRowBatchBuffer.capacityRows < rows
    ) {
      const cellCount = cols * rows;
      const buffer = new ArrayBuffer(cellCount * PACKED_CELL_BYTE_STRIDE);
      packedRowBatchBuffer = {
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
  };

  const createPackedRowCacheEntry = (cols: number): PackedRowBatchBuffer => {
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
  };

  const ensurePackedRowCache = (rows: number, cols: number) => {
    if (rows <= 0 || cols <= 0) {
      packedRowCache = null;
      packedRowCacheCols = 0;
      packedRowCacheDirty = null;
      return;
    }
    if (!packedRowCache || packedRowCache.length !== rows || packedRowCacheCols !== cols) {
      packedRowCache = new Array(rows).fill(null);
      packedRowCacheCols = cols;
      packedRowCacheDirty = new Uint8Array(rows);
      packedRowCacheDirty.fill(1);
    }
  };

  const clearPackedRowCache = (rowIndex?: number) => {
    if (!packedRowCache) return;
    if (rowIndex === undefined) {
      packedRowCache.fill(null);
      packedRowCacheDirty?.fill(1);
      return;
    }
    if (rowIndex >= 0 && rowIndex < packedRowCache.length) {
      if (packedRowCacheDirty) {
        packedRowCacheDirty[rowIndex] = 1;
      }
    }
  };

  const applyPackedRowUpdate = (packedRows: PackedRowUpdate, rowsLimit: number) => {
    if (!packedRowCache || !packedRowCacheDirty) return;
    if (packedRows.cols !== packedRowCacheCols) return;

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

      let entry = packedRowCache[rowIndex];
      if (!entry) {
        entry = createPackedRowCacheEntry(packedRows.cols);
        packedRowCache[rowIndex] = entry;
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

      packedRowCacheDirty[rowIndex] = 0;
    }
  };

  const ensureRowTextCache = (rowCount: number) => {
    if (rowCount <= 0) {
      rowTextCache = null;
      return;
    }
    if (!rowTextCache || rowTextCache.length !== rowCount) {
      rowTextCache = new Array(rowCount).fill(null);
    }
  };

  const ensureMissingRowsBuffer = (rowCount: number): MissingRowBuffer | null => {
    if (rowCount <= 0) {
      missingRowsBuffer = null;
      return null;
    }
    if (!missingRowsBuffer || missingRowsBuffer.rowIndices.length < rowCount) {
      missingRowsBuffer = {
        rowIndices: new Int32Array(rowCount),
        offsets: new Int32Array(rowCount),
        count: 0,
      };
    } else {
      missingRowsBuffer.count = 0;
    }
    return missingRowsBuffer;
  };

  const snapshotMissingRows = (
    buffer: MissingRowBuffer | null,
    viewportOffset: number,
    scrollbackLength: number,
    rows: number
  ): MissingRowSnapshot | null => {
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
  };

  const applyPrefetchSnapshot = (snapshot: MissingRowSnapshot | null): boolean => {
    if (!snapshot || !terminalState) {
      dirtyAll = true;
      clearRowTextCache();
      return true;
    }
    if (
      scrollState.viewportOffset !== snapshot.viewportOffset ||
      scrollState.scrollbackLength !== snapshot.scrollbackLength ||
      terminalState.rows !== snapshot.rows
    ) {
      dirtyAll = true;
      markAllRowsDirty(terminalState.rows);
      return true;
    }
    if (!dirtyRows) {
      dirtyAll = true;
      markAllRowsDirty(terminalState.rows);
      return true;
    }

    let marked = false;
    for (let i = 0; i < snapshot.count; i++) {
      const rowIndex = snapshot.rowIndices[i];
      const offset = snapshot.offsets[i];
      const line = emulator?.getScrollbackLine(offset) ?? transitionCache.get(offset) ?? null;
      if (line) {
        markRowDirty(rowIndex);
        marked = true;
      }
    }

    return marked;
  };

  onCleanup(() => {
    frameBuffer?.destroy();
    frameBuffer = null;
    packedRowBuffer = null;
    packedRowBatchBuffer = null;
    packedRowCache = null;
    packedRowCacheCols = 0;
    packedRowCacheDirty = null;
    rowTextCache = null;
    rowRenderCache = null;
    missingRowsBuffer = null;
    pendingMissingRows = null;
    pendingPackedRows = null;
  });

  // Using on() for explicit ptyId dependency - effect re-runs only when ptyId changes
  // defer: false ensures it runs immediately on mount
  createEffect(
    on(
      () => props.ptyId,
      (ptyId) => {
        let unsubscribe: (() => void) | null = null;
        let mounted = true;
        // Frame batching: coalesce multiple updates into single render per event loop tick
        // Moved inside effect to ensure it's reset if effect re-runs
        let renderRequested = false;

        // Cache for terminal rows (structural sharing)
        let cachedRows: TerminalCell[][] = [];

        // Batched render request - coalesces multiple updates into one render
        // Use setTimeout instead of queueMicrotask to defer after current frame
        // queueMicrotask runs before render (blocking), setTimeout runs after
        const requestRenderFrame = () => {
          if (!renderRequested && mounted) {
            renderRequested = true;
            setTimeout(() => {
              if (mounted) {
                renderRequested = false;
                setVersion(v => v + 1);
                renderer.requestRender();
              }
            }, 0);
          }
        };

        // Execute pending scrollback prefetch
        const executePrefetch = async () => {
          if (!pendingPrefetch || prefetchInProgress || !mounted) return;

          const { ptyId: prefetchPtyId, start, count } = pendingPrefetch;
          const missingSnapshot = pendingMissingRows;
          pendingPrefetch = null;
          pendingMissingRows = null;
          prefetchInProgress = true;

          try {
            await prefetchScrollbackLines(prefetchPtyId, start, count);
            if (mounted) {
              // Trigger a render only for rows that were missing and just arrived
              if (applyPrefetchSnapshot(missingSnapshot)) {
                requestRenderFrame();
              }
            }
          } finally {
            prefetchInProgress = false;
            // Check if another prefetch was requested while this one was running
            if (pendingPrefetch && mounted) {
              executePrefetch();
            }
          }
        };

        // Expose executePrefetch for use in renderTerminal
        executePrefetchFn = executePrefetch;

        // Initialize async resources
        const init = async () => {
          // Get emulator for scrollback access
          const em = await getEmulator(ptyId);
          if (!mounted) return;
          emulator = em;

          // Subscribe to unified updates (terminal + scroll combined)
          // This replaces separate subscribeToPty + subscribeToScroll with single subscription
          unsubscribe = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
            if (!mounted) return;

            const { terminalUpdate } = update;
            const prevViewportOffset = scrollState.viewportOffset;
            const prevCursorRow = terminalState?.cursor.y ?? null;
            const prevCursorVisible = terminalState?.cursor.visible ?? true;
            const oldScrollbackLength = scrollState.scrollbackLength;
            const newScrollbackLength = update.scrollState.scrollbackLength;
            const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
            const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

            // Update transition cache based on scrollback changes
            updateTransitionCache(
              transitionCache,
              terminalState,
              oldScrollbackLength,
              newScrollbackLength,
              scrollState.viewportOffset,
              isAtScrollbackLimit
            );

            // Update terminal state
            if (terminalUpdate.isFull && terminalUpdate.fullState) {
              // Full refresh: store complete state
              terminalState = terminalUpdate.fullState;
              cachedRows = [...terminalUpdate.fullState.cells];
              // Clear transition cache on full refresh
              transitionCache.clear();
              dirtyAll = true;
              markAllRowsDirty(terminalUpdate.fullState.rows);
            } else {
              // Delta update: merge dirty rows into cached state
              const existingState = terminalState;
              if (existingState) {
                // Apply dirty rows to cached rows
                for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
                  cachedRows[rowIdx] = newRow;
                  markRowDirty(rowIdx);
                }
                // Update state with merged cells and new cursor/modes
                terminalState = {
                  ...existingState,
                  cells: cachedRows,
                  cursor: terminalUpdate.cursor,
                  alternateScreen: terminalUpdate.alternateScreen,
                  mouseTracking: terminalUpdate.mouseTracking,
                  cursorKeyMode: terminalUpdate.cursorKeyMode,
                };
              }
            }

            if (terminalUpdate.packedRows) {
              if (
                packedRowCache &&
                packedRowCacheDirty &&
                packedRowCacheCols === terminalUpdate.packedRows.cols
              ) {
                applyPackedRowUpdate(terminalUpdate.packedRows, packedRowCache.length);
              } else {
                pendingPackedRows = terminalUpdate.packedRows;
              }
            }

            if (terminalState) {
              if (!dirtyRows || dirtyRows.length !== terminalState.rows) {
                dirtyAll = true;
                markAllRowsDirty(terminalState.rows);
              } else {
                const nextCursorRow = terminalState.cursor.y ?? null;
                const nextCursorVisible = terminalState.cursor.visible ?? true;
                if (prevCursorRow !== null) markRowDirty(prevCursorRow, false);
                if (nextCursorRow !== null) markRowDirty(nextCursorRow, false);
                if (prevCursorVisible !== nextCursorVisible) {
                  if (prevCursorRow !== null) markRowDirty(prevCursorRow, false);
                  if (nextCursorRow !== null) markRowDirty(nextCursorRow, false);
                }
              }
            }

            // Update scroll state from unified update to ensure it's in sync with terminal state
            // This prevents race conditions where render uses stale scroll state from cache
            scrollState = update.scrollState;

            const scrollbackChanged = scrollbackDelta !== 0 ||
              (scrollbackDelta === 0 && isAtScrollbackLimit && oldScrollbackLength > 0);
            if (prevViewportOffset > 0 && scrollbackChanged) {
              dirtyAll = true;
              if (terminalState) {
                markAllRowsDirty(terminalState.rows);
              }
            }

            if (scrollState.viewportOffset !== prevViewportOffset) {
              dirtyAll = true;
              if (terminalState) {
                markAllRowsDirty(terminalState.rows);
              }
            }

            // Request batched render
            requestRenderFrame();
          });

          // Trigger initial render
          requestRenderFrame();
        };

        init();

        onCleanup(() => {
          mounted = false;
          if (unsubscribe) {
            unsubscribe();
          }
          terminalState = null;
          dirtyRows = null;
          dirtyAll = true;
          emulator = null;
          executePrefetchFn = null;
          pendingPrefetch = null;
          pendingMissingRows = null;
          missingRowsBuffer = null;
          rowTextCache = null;
          rowRenderCache = null;
          packedRowCache = null;
          packedRowCacheCols = 0;
          packedRowCacheDirty = null;
          prefetchScheduled = false;
          transitionCache.clear();
          scrollbackRowCache.length = 0;
          paddingWasActive = false;
          lastPaddingCols = 0;
          lastPaddingRows = 0;
          lastPaddingWidth = 0;
          lastPaddingHeight = 0;
          lastPaddingBg = null;
          lastSelectionRef = null;
          lastSearchRef = null;
          lastSearchPtyId = null;
          pendingPackedRows = null;
        });
      },
      { defer: false }
    )
  );

  // Render callback that directly writes to buffer
  const renderTerminal = (buffer: OptimizedBuffer) => {
    const state = terminalState;
    const width = props.width;
    const height = props.height;
    const offsetX = props.offsetX ?? 0;
    const offsetY = props.offsetY ?? 0;
    const isFocused = props.isFocused;
    const ptyId = props.ptyId;

    if (!state) {
      // Clear the buffer area when state is null (PTY destroyed)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
        }
      }
      return;
    }

    // Use scroll state from unified update (stored locally, always in sync with terminal state)
    const viewportOffset = scrollState.viewportOffset;
    const scrollbackLength = scrollState.scrollbackLength;
    const isAtBottom = checkIsAtBottom(viewportOffset);

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    const colsChanged = cols !== lastRenderCols;

    if (rows !== lastRenderRows || colsChanged || width !== lastRenderWidth || height !== lastRenderHeight) {
      dirtyAll = true;
      lastRenderRows = rows;
      lastRenderCols = cols;
      lastRenderWidth = width;
      lastRenderHeight = height;
    }

    if (colsChanged) {
      clearRowTextCache();
      clearPackedRowCache();
      pendingPackedRows = null;
    }
    ensureRowTextCache(rows);
    ensurePackedRowBuffer(cols);
    ensurePackedRowBatchBuffer(cols, rows);
    ensurePackedRowCache(rows, cols);
    rowRenderCache = packedRowBuffer && rowTextCache
      ? { packedRow: packedRowBuffer, rowText: rowTextCache }
      : null;

    if (
      pendingPackedRows &&
      packedRowCache &&
      packedRowCacheDirty &&
      pendingPackedRows.cols === cols
    ) {
      applyPackedRowUpdate(pendingPackedRows, rows);
      pendingPackedRows = null;
    } else if (pendingPackedRows && pendingPackedRows.cols !== cols) {
      pendingPackedRows = null;
    }

    if (lastIsFocused !== isFocused) {
      if (isAtBottom && state.cursor.visible) {
        markRowDirty(state.cursor.y, false);
      }
      lastIsFocused = isFocused;
    }
    // Use top-left cell bg as fallback to paint unused area; default to black
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
    const fallbackFg = BLACK;

    ensureFrameBuffer(width, height, buffer);
    const renderTarget = frameBuffer ?? buffer;
    const renderOffsetX = frameBuffer ? 0 : offsetX;
    const renderOffsetY = frameBuffer ? 0 : offsetY;

    let rowCache: (TerminalCell[] | null)[];
    if (viewportOffset === 0) {
      rowCache = state.cells as (TerminalCell[] | null)[];
    } else {
      // Pre-fetch all rows we need for rendering (optimization: fetch once per row, not per cell)
      const missingRows = ensureMissingRowsBuffer(rows);
      const { rowCache: fetchedRows, firstMissingOffset, lastMissingOffset } = fetchRowsForRendering(
        state,
        emulator,
        transitionCache,
        { viewportOffset, scrollbackLength, rows },
        scrollbackRowCache,
        missingRows ?? undefined
      );
      rowCache = fetchedRows;

      // Schedule prefetch for missing scrollback lines with buffer zone
      const prefetchRequest = firstMissingOffset === -1
        ? null
        : calculatePrefetchRequest(
          ptyId,
          firstMissingOffset,
          lastMissingOffset,
          scrollbackLength,
          rows
        );
      if (prefetchRequest && !prefetchInProgress && executePrefetchFn) {
        pendingPrefetch = prefetchRequest;
        pendingMissingRows = snapshotMissingRows(missingRows, viewportOffset, scrollbackLength, rows);
        // Execute prefetch asynchronously (don't block render)
        if (!prefetchScheduled) {
          prefetchScheduled = true;
          queueMicrotask(() => {
            prefetchScheduled = false;
            executePrefetchFn?.();
          });
        }
      } else {
        pendingMissingRows = null;
      }
    }

    // Pre-check if selection/search is active for this pane (avoid 5760 function calls per frame)
    const hasSelection = !!getSelection(ptyId)?.normalizedRange;
    const currentSearchState = search.searchState;
    const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;
    const currentMatch = hasSearch && currentSearchState && currentSearchState.currentMatchIndex >= 0
      ? currentSearchState.matches[currentSearchState.currentMatchIndex] ?? null
      : null;

    if (hasSelection !== lastHadSelection || hasSearch !== lastHadSearch) {
      dirtyAll = true;
      lastHadSelection = hasSelection;
      lastHadSearch = hasSearch;
    }

    // Create rendering options
    const renderOptions = {
      ptyId,
      hasSelection,
      hasSearch,
      isAtBottom,
      isFocused,
      cursorX: state.cursor.x,
      cursorY: state.cursor.y,
      cursorVisible: state.cursor.visible,
      scrollbackLength,
      viewportOffset,
      currentMatch,
    };

    // Create rendering dependencies
    const renderDeps = {
      isCellSelected,
      getSelectedColumnsForRow,
      isSearchMatch,
      isCurrentMatch,
      getSelection,
      getSearchMatchRanges,
    };

    const useFullRender = dirtyAll || !dirtyRows;
    const allowPackedBatch = !!packedRowBatchBuffer;
    const cursorRow = (isAtBottom && isFocused && state.cursor.visible) ? state.cursor.y : -1;
    const cursorCol = (isAtBottom && isFocused && state.cursor.visible) ? state.cursor.x : -1;
    const needsRowHighlightCheck = hasSelection || hasSearch;
    const absoluteRowBase = scrollbackLength - viewportOffset;

    const showScrollbar = !isAtBottom && scrollbackLength > 0;
    let scrollbarX = 0;
    let contentCol = 0;
    let thumbPosition = 0;
    let thumbHeight = 0;
    if (showScrollbar) {
      const totalLines = scrollbackLength + rows;
      thumbHeight = Math.max(1, Math.floor(rows * rows / totalLines));
      const scrollRange = rows - thumbHeight;
      thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange);
      scrollbarX = renderOffsetX + width - 1;
      contentCol = cols - 1;
    }

    let batchStart = 0;
    let batchRowCount = 0;
    const rowByteStride = cols * PACKED_CELL_BYTE_STRIDE;
    const flushPackedBatch = () => {
      if (!packedRowBatchBuffer || batchRowCount === 0) return;
      drawPackedRowBatch(
        renderTarget,
        packedRowBatchBuffer,
        cols,
        renderOffsetX,
        renderOffsetY,
        batchStart,
        batchRowCount
      );
      batchRowCount = 0;
    };

    const appendCachedRowToBatch = (entry: PackedRowBatchBuffer, batchRowIndex: number): boolean => {
      if (!packedRowBatchBuffer) return false;
      if (entry.capacityCols < cols || batchRowIndex >= packedRowBatchBuffer.capacityRows) {
        return false;
      }
      const destOffset = batchRowIndex * rowByteStride;
      packedRowBatchBuffer.bytes.set(entry.bytes, destOffset);

      const overlayCount = entry.overlayCount;
      if (overlayCount === 0) {
        return true;
      }
      const overlayBase = packedRowBatchBuffer.overlayCount;
      if (overlayBase + overlayCount > packedRowBatchBuffer.overlayX.length) {
        return false;
      }
      for (let i = 0; i < overlayCount; i++) {
        const targetIndex = overlayBase + i;
        packedRowBatchBuffer.overlayX[targetIndex] = entry.overlayX[i];
        packedRowBatchBuffer.overlayY[targetIndex] = batchRowIndex;
        packedRowBatchBuffer.overlayCodepoint[targetIndex] = entry.overlayCodepoint[i];
        packedRowBatchBuffer.overlayAttributes[targetIndex] = entry.overlayAttributes[i];
        packedRowBatchBuffer.overlayFg[targetIndex] = entry.overlayFg[i];
        packedRowBatchBuffer.overlayBg[targetIndex] = entry.overlayBg[i];
      }
      packedRowBatchBuffer.overlayCount = overlayBase + overlayCount;
      return true;
    };

    const drawHighlightedCell = (row: TerminalCell[], rowY: number, x: number, fg: RGBA, bg: RGBA) => {
      const cell = row[x] ?? null;
      if (!cell) {
        const prevCell = x > 0 ? row[x - 1] ?? null : null;
        if (prevCell?.width === 2) {
          renderTarget.drawChar(0, x + renderOffsetX, rowY, bg, bg, 0);
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
        renderTarget.drawChar(codepoint, x + renderOffsetX, rowY, fg, bg, attributes);
      } else {
        renderTarget.setCell(x + renderOffsetX, rowY, char, fg, bg, attributes);
      }

      if (cell.width === 2) {
        const spacerX = x + 1;
        if (spacerX < cols) {
          renderTarget.drawChar(0, spacerX + renderOffsetX, rowY, bg, bg, 0);
        }
      }
    };

    const drawCursorCell = (row: TerminalCell[], rowY: number, x: number) => {
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
        const tmpR = fgR; fgR = bgR; bgR = tmpR;
        const tmpG = fgG; fgG = bgG; bgG = tmpG;
        const tmpB = fgB; fgB = bgB; bgB = tmpB;
      }

      const fg = getCachedRGBA(fgR, fgG, fgB);
      const bg = getCachedRGBA(bgR, bgG, bgB);
      const cursorFg = bg ?? BLACK;
      drawHighlightedCell(row, rowY, x, cursorFg, WHITE);
    };

    // Render rows (partial when safe)
    for (let y = 0; y < rows; y++) {
      if (!useFullRender && dirtyRows && dirtyRows[y] === 0) {
        flushPackedBatch();
        continue;
      }

      const row = rowCache[y];
      const rowDirty = !dirtyRows || dirtyRows[y] === 1;
      let rowHasHighlights = false;
      let selectedRange: { start: number; end: number } | null = null;
      let matchRanges: Array<{ startCol: number; endCol: number }> | null = null;
      let currentMatchStart = -1;
      let currentMatchEnd = -1;
      if (allowPackedBatch && row) {
        if (y === cursorRow) {
          rowHasHighlights = true;
        }
        if (needsRowHighlightCheck) {
          const absoluteY = absoluteRowBase + y;
          if (hasSelection) {
            selectedRange = getSelectedColumnsForRow(ptyId, absoluteY, cols);
            if (selectedRange) {
              rowHasHighlights = true;
            }
          }
          if (hasSearch) {
            matchRanges = getSearchMatchRanges(ptyId, absoluteY);
            if (matchRanges && matchRanges.length > 0) {
              rowHasHighlights = true;
            }
            if (currentMatch && currentMatch.lineIndex === absoluteY && currentMatch.startCol >= 0) {
              currentMatchStart = currentMatch.startCol;
              currentMatchEnd = currentMatch.endCol;
              rowHasHighlights = true;
            }
          }
        }
      }

      if (allowPackedBatch && row && rowHasHighlights && packedRowBatchBuffer) {
        let cachedEntry = packedRowCache ? packedRowCache[y] : null;
        let cacheDirty = packedRowCacheDirty ? packedRowCacheDirty[y] === 1 : rowDirty;
        if (!cachedEntry) {
          cachedEntry = createPackedRowCacheEntry(cols);
          if (packedRowCache) {
            packedRowCache[y] = cachedEntry;
          }
          cacheDirty = true;
        }
        if (cacheDirty) {
          cachedEntry.overlayCount = 0;
          packRowForBatch(
            row,
            y,
            cols,
            fallbackFg,
            fallbackBg,
            rowTextCache,
            cachedEntry,
            0
          );
          if (packedRowCacheDirty) {
            packedRowCacheDirty[y] = 0;
          }
        }

        flushPackedBatch();
        drawPackedRowBatch(
          renderTarget,
          cachedEntry,
          cols,
          renderOffsetX,
          renderOffsetY,
          y,
          1,
          false
        );

        const rowY = y + renderOffsetY;
        if (matchRanges) {
          for (const range of matchRanges) {
            const start = Math.max(range.startCol, 0);
            const end = Math.min(range.endCol, cols);
            for (let x = start; x < end; x++) {
              drawHighlightedCell(row, rowY, x, SEARCH_MATCH_FG, SEARCH_MATCH_BG);
            }
          }
        }
        if (currentMatchStart >= 0 && currentMatchEnd > currentMatchStart) {
          const start = Math.max(currentMatchStart, 0);
          const end = Math.min(currentMatchEnd, cols);
          for (let x = start; x < end; x++) {
            drawHighlightedCell(row, rowY, x, SEARCH_CURRENT_FG, SEARCH_CURRENT_BG);
          }
        }
        if (selectedRange) {
          const start = Math.max(selectedRange.start, 0);
          const end = Math.min(selectedRange.end, cols - 1);
          for (let x = start; x <= end; x++) {
            drawHighlightedCell(row, rowY, x, SELECTION_FG, SELECTION_BG);
          }
        }
        if (y === cursorRow && cursorCol >= 0 && cursorCol < cols) {
          drawCursorCell(row, rowY, cursorCol);
        }

        if (!useFullRender && dirtyRows) {
          dirtyRows[y] = 0;
        }
        continue;
      }

      const canBatchRow = allowPackedBatch && row !== null && !rowHasHighlights;

      if (canBatchRow && packedRowBatchBuffer) {
        let cachedEntry = packedRowCache ? packedRowCache[y] : null;
        let cacheDirty = packedRowCacheDirty ? packedRowCacheDirty[y] === 1 : rowDirty;
        if (!cachedEntry) {
          cachedEntry = createPackedRowCacheEntry(cols);
          if (packedRowCache) {
            packedRowCache[y] = cachedEntry;
          }
          cacheDirty = true;
        }
        if (cacheDirty) {
          cachedEntry.overlayCount = 0;
          packRowForBatch(
            row,
            y,
            cols,
            fallbackFg,
            fallbackBg,
            rowTextCache,
            cachedEntry,
            0
          );
          if (packedRowCacheDirty) {
            packedRowCacheDirty[y] = 0;
          }
        }

        if (batchRowCount === 0) {
          batchStart = y;
          packedRowBatchBuffer.overlayCount = 0;
        }
        const appended = appendCachedRowToBatch(cachedEntry, batchRowCount);
        if (appended) {
          batchRowCount++;
          if (!useFullRender && dirtyRows) {
            dirtyRows[y] = 0;
          }
          continue;
        }
      }

      flushPackedBatch();
      renderRow(
        renderTarget,
        row,
        y,
        cols,
        renderOffsetX,
        renderOffsetY,
        renderOptions,
        renderDeps,
        fallbackFg,
        fallbackBg,
        rowRenderCache ?? undefined
      );
      if (!useFullRender && dirtyRows) {
        dirtyRows[y] = 0;
      }
    }

    flushPackedBatch();

    if (showScrollbar) {
      for (let y = 0; y < rows; y++) {
        const row = rowCache[y];
        const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight;
        const contentCell = contentCol >= 0 ? row?.[contentCol] ?? null : null;
        const underlyingChar = contentCell?.char || ' ';
        const underlyingFg = contentCell
          ? getCachedRGBA(contentCell.fg.r, contentCell.fg.g, contentCell.fg.b)
          : fallbackFg;

        const codepoint = underlyingChar.codePointAt(0) ?? 0x20;
        if (codepoint > 0x7f) {
          renderTarget.drawChar(
            codepoint,
            scrollbarX,
            y + renderOffsetY,
            underlyingFg,
            isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
            0
          );
        } else {
          renderTarget.setCell(
            scrollbarX,
            y + renderOffsetY,
            underlyingChar,
            underlyingFg,
            isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
            0
          );
        }
      }
    }

    if (useFullRender && dirtyRows) {
      dirtyRows.fill(0);
    }
    dirtyAll = false;

    // Paint any unused area (when cols/rows are smaller than the pane) to avoid stale/transparent regions
    const paddingActive = cols < width || rows < height;
    if (paddingActive) {
      const shouldClearPadding = !paddingWasActive ||
        cols !== lastPaddingCols ||
        rows !== lastPaddingRows ||
        width !== lastPaddingWidth ||
        height !== lastPaddingHeight ||
        fallbackBg !== lastPaddingBg;

      if (shouldClearPadding) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (y < rows && x < cols) continue;
            renderTarget.setCell(x + renderOffsetX, y + renderOffsetY, ' ', fallbackFg, fallbackBg, 0);
          }
        }
      }

      paddingWasActive = true;
      lastPaddingCols = cols;
      lastPaddingRows = rows;
      lastPaddingWidth = width;
      lastPaddingHeight = height;
      lastPaddingBg = fallbackBg;
    } else {
      paddingWasActive = false;
    }

    if (frameBuffer) {
      buffer.drawFrameBuffer(offsetX, offsetY, frameBuffer);
    }
  };

  // Request render when selection or search version changes
  // Using on() for explicit dependency tracking - only runs when these signals change
  // defer: true (default) skips initial run since version() controls initial render
  createEffect(
    on(
      [() => selection.selectionVersion, () => search.searchVersion],
      () => {
        const selectionRef = getSelection(props.ptyId) ?? null;
        const searchState = search.searchState;
        const searchPtyId = searchState?.ptyId ?? null;
        const affectsSearch = searchPtyId === props.ptyId || lastSearchPtyId === props.ptyId;

        const selectionChanged = selectionRef !== lastSelectionRef;
        const searchChanged = affectsSearch && searchState !== lastSearchRef;

        if (selectionChanged || searchChanged) {
          dirtyAll = true;
          renderer.requestRender();
        }

        lastSelectionRef = selectionRef;
        if (affectsSearch) {
          lastSearchRef = searchState;
        }
        lastSearchPtyId = searchPtyId;
      }
    )
  );

  return (
    <Show
      when={version() > 0}
      fallback={
        <box
          style={{
            width: props.width,
            height: props.height,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <text fg="#666666">Loading terminal...</text>
        </box>
      }
    >
      <box
        style={{
          width: props.width,
          height: props.height,
        }}
        renderAfter={renderTerminal}
      />
    </Show>
  );
}

export default TerminalView;
