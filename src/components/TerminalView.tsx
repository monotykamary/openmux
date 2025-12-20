/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { OptimizedBuffer } from '@opentui/core';
import type { TerminalState, TerminalCell, TerminalScrollState, UnifiedTerminalUpdate } from '../core/types';
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
  BLACK,
  getCachedRGBA,
} from '../terminal/rendering';
import {
  renderRow,
  renderScrollbar,
  fetchRowsForRendering,
  calculatePrefetchRequest,
  updateTransitionCache,
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
  const { isSearchMatch, isCurrentMatch } = search;
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
  let frameBuffer: OptimizedBuffer | null = null;
  let frameBufferWidth = 0;
  let frameBufferHeight = 0;
  // Cache for lines transitioning from live terminal to scrollback
  // When scrollback grows, the top rows of the terminal move to scrollback.
  // We capture them before the state update so we can render them immediately
  // without waiting for async prefetch from the worker.
  const transitionCache = new Map<number, TerminalCell[]>();
  // Cache emulator for sync access to scrollback lines
  let emulator: ITerminalEmulator | null = null;
  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = createSignal(0);
  // Track pending scrollback prefetch to avoid duplicate requests
  let pendingPrefetch: { ptyId: string; start: number; count: number } | null = null;
  let prefetchInProgress = false;
  // Function reference for executing prefetch (set by effect, used by render)
  let executePrefetchFn: (() => void) | null = null;

  const markAllRowsDirty = (rowCount: number) => {
    if (rowCount <= 0) {
      dirtyRows = null;
      return;
    }
    if (!dirtyRows || dirtyRows.length !== rowCount) {
      dirtyRows = new Uint8Array(rowCount);
    }
    dirtyRows.fill(1);
  };

  const markRowDirty = (rowIndex: number) => {
    if (!dirtyRows || rowIndex < 0 || rowIndex >= dirtyRows.length) return;
    dirtyRows[rowIndex] = 1;
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

  onCleanup(() => {
    frameBuffer?.destroy();
    frameBuffer = null;
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
          pendingPrefetch = null;
          prefetchInProgress = true;

          try {
            await prefetchScrollbackLines(prefetchPtyId, start, count);
            if (mounted) {
              // Trigger re-render after prefetch completes
              requestRenderFrame();
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

            if (terminalState) {
              if (!dirtyRows || dirtyRows.length !== terminalState.rows) {
                dirtyAll = true;
                markAllRowsDirty(terminalState.rows);
              } else {
                const nextCursorRow = terminalState.cursor.y ?? null;
                const nextCursorVisible = terminalState.cursor.visible ?? true;
                if (prevCursorRow !== null) markRowDirty(prevCursorRow);
                if (nextCursorRow !== null) markRowDirty(nextCursorRow);
                if (prevCursorVisible !== nextCursorVisible) {
                  if (prevCursorRow !== null) markRowDirty(prevCursorRow);
                  if (nextCursorRow !== null) markRowDirty(nextCursorRow);
                }
              }
            }

            // Update scroll state from unified update to ensure it's in sync with terminal state
            // This prevents race conditions where render uses stale scroll state from cache
            scrollState = update.scrollState;

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

    if (rows !== lastRenderRows || cols !== lastRenderCols || width !== lastRenderWidth || height !== lastRenderHeight) {
      dirtyAll = true;
      lastRenderRows = rows;
      lastRenderCols = cols;
      lastRenderWidth = width;
      lastRenderHeight = height;
    }

    if (lastIsFocused !== isFocused) {
      dirtyAll = true;
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

    // Pre-fetch all rows we need for rendering (optimization: fetch once per row, not per cell)
    const { rowCache, firstMissingOffset, lastMissingOffset } = fetchRowsForRendering(
      state,
      emulator,
      transitionCache,
      { viewportOffset, scrollbackLength, rows }
    );

    // Schedule prefetch for missing scrollback lines with buffer zone
    const prefetchRequest = calculatePrefetchRequest(
      ptyId,
      firstMissingOffset,
      lastMissingOffset,
      scrollbackLength,
      rows
    );
    if (prefetchRequest && !prefetchInProgress && executePrefetchFn) {
      pendingPrefetch = prefetchRequest;
      // Execute prefetch asynchronously (don't block render)
      queueMicrotask(executePrefetchFn);
    }

    // Pre-check if selection/search is active for this pane (avoid 5760 function calls per frame)
    const hasSelection = !!getSelection(ptyId)?.normalizedRange;
    const currentSearchState = search.searchState;
    const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;

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
    };

    // Create rendering dependencies
    const renderDeps = {
      isCellSelected,
      getSelectedColumnsForRow,
      isSearchMatch,
      isCurrentMatch,
      getSelection,
    };

    const useFullRender = dirtyAll || viewportOffset > 0 || hasSelection || hasSearch || !dirtyRows;

    // Render rows (partial when safe)
    for (let y = 0; y < rows; y++) {
      if (!useFullRender && dirtyRows && dirtyRows[y] === 0) {
        continue;
      }
      const row = rowCache[y];
      renderRow(renderTarget, row, y, cols, renderOffsetX, renderOffsetY, renderOptions, renderDeps, fallbackFg, fallbackBg);
      if (!useFullRender && dirtyRows) {
        dirtyRows[y] = 0;
      }
    }

    if (useFullRender && dirtyRows) {
      dirtyRows.fill(0);
    }
    dirtyAll = false;

    // Paint any unused area (when cols/rows are smaller than the pane) to avoid stale/transparent regions
    if (cols < width || rows < height) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          renderTarget.setCell(x + renderOffsetX, y + renderOffsetY, ' ', fallbackFg, fallbackBg, 0);
        }
      }
    }

    // Render scrollbar when scrolled back (not at bottom)
    if (!isAtBottom) {
      renderScrollbar(renderTarget, rowCache, {
        viewportOffset,
        scrollbackLength,
        rows,
        cols,
        width,
        offsetX: renderOffsetX,
        offsetY: renderOffsetY,
      }, fallbackFg);
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
      () => renderer.requestRender()
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
