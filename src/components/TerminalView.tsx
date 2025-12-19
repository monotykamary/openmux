/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import type { OptimizedBuffer } from '@opentui/core';
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
// Track when SET_PANE_PTY happens for timing measurement
let setPanePtyTime = 0;
export function notifyTerminalViewMount() {
  setPanePtyTime = performance.now();
}

export function TerminalView(props: TerminalViewProps) {
  // Log component creation time
  if (setPanePtyTime > 0) {
    console.log(`[TERMINAL] component created: ${(performance.now() - setPanePtyTime).toFixed(2)}ms after SET_PANE_PTY`);
  }
  const renderer = useRenderer();
  // Get selection state - keep full context to access selectionVersion reactively
  const selection = useSelection();
  const { isCellSelected, getSelection } = selection;
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch } = search;
  // Store terminal state in a plain variable (Solid has no stale closures)
  let terminalState: TerminalState | null = null;
  // Store scroll state locally from unified updates to avoid race conditions
  // This ensures scroll state and terminal state are always in sync
  let scrollState: TerminalScrollState = { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true };
  // Track last render time to throttle expensive renders during rapid layout changes
  let lastRenderTime = 0;
  let pendingRender = false;
  // Track if content changed (vs just position change)
  let contentDirty = true;
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
          const initStart = performance.now();

          // Get emulator for scrollback access
          const emulatorStart = performance.now();
          const em = await getEmulator(ptyId);
          console.log(`[TERMINAL] getEmulator: ${(performance.now() - emulatorStart).toFixed(2)}ms`);
          if (!mounted) return;
          emulator = em;

          // Subscribe to unified updates (terminal + scroll combined)
          // This replaces separate subscribeToPty + subscribeToScroll with single subscription
          const subscribeStart = performance.now();
          unsubscribe = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
            if (!mounted) return;

            const { terminalUpdate } = update;
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
            } else {
              // Delta update: merge dirty rows into cached state
              const existingState = terminalState;
              if (existingState) {
                // Apply dirty rows to cached rows
                for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
                  cachedRows[rowIdx] = newRow;
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

            // Update scroll state from unified update to ensure it's in sync with terminal state
            // This prevents race conditions where render uses stale scroll state from cache
            scrollState = update.scrollState;

            // Mark content as dirty (actual terminal data changed)
            contentDirty = true;

            // Request batched render
            requestRenderFrame();
          });
          console.log(`[TERMINAL] subscribeUnifiedToPty: ${(performance.now() - subscribeStart).toFixed(2)}ms`);

          // Trigger initial render
          requestRenderFrame();
          console.log(`[TERMINAL] init total: ${(performance.now() - initStart).toFixed(2)}ms`);
        };

        init();

        onCleanup(() => {
          mounted = false;
          if (unsubscribe) {
            unsubscribe();
          }
          terminalState = null;
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
    // Use top-left cell bg as fallback to paint unused area; default to black
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
    const fallbackFg = BLACK;

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
      isSearchMatch,
      isCurrentMatch,
      getSelection,
    };

    // Render all rows
    for (let y = 0; y < rows; y++) {
      const row = rowCache[y];
      renderRow(buffer, row, y, cols, offsetX, offsetY, renderOptions, renderDeps, fallbackFg, fallbackBg);
    }

    // Paint any unused area (when cols/rows are smaller than the pane) to avoid stale/transparent regions
    if (cols < width || rows < height) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          buffer.setCell(x + offsetX, y + offsetY, ' ', fallbackFg, fallbackBg, 0);
        }
      }
    }

    // Render scrollbar when scrolled back (not at bottom)
    if (!isAtBottom) {
      renderScrollbar(buffer, rowCache, {
        viewportOffset,
        scrollbackLength,
        rows,
        cols,
        width,
        offsetX,
        offsetY,
      }, fallbackFg);
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
