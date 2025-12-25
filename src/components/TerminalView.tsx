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
  setPtyUpdateEnabled as setPtyUpdateEnabledBridge,
} from '../effect/bridge';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import {
  BLACK,
  getCachedRGBA,
} from '../terminal/rendering';
import {
  extractRgb,
  getDefaultColors,
  getHostColors,
} from '../terminal/terminal-colors';
import { getHostBackgroundColor } from '../effect/bridge';
import {
  renderRow,
  renderScrollbar,
  fetchRowsForRendering,
  calculatePrefetchRequest,
} from './terminal-view';

const visiblePtyCounts = new Map<string, number>();

const applyUpdateGate = (ptyId: string, enabled: boolean, emulator?: ITerminalEmulator | null) => {
  void setPtyUpdateEnabledBridge(ptyId, enabled);
  if (emulator && !emulator.isDisposed) {
    emulator.setUpdateEnabled?.(enabled);
  }
};

const registerVisiblePty = (ptyId: string) => {
  const count = (visiblePtyCounts.get(ptyId) ?? 0) + 1;
  visiblePtyCounts.set(ptyId, count);
  if (count === 1) {
    applyUpdateGate(ptyId, true);
  }
};

const attachVisibleEmulator = (ptyId: string, emulator: ITerminalEmulator | null) => {
  if (!emulator) return;
  if ((visiblePtyCounts.get(ptyId) ?? 0) > 0) {
    applyUpdateGate(ptyId, true, emulator);
  }
};

const unregisterVisiblePty = (ptyId: string, emulator: ITerminalEmulator | null) => {
  const count = (visiblePtyCounts.get(ptyId) ?? 0) - 1;
  if (count <= 0) {
    visiblePtyCounts.delete(ptyId);
    applyUpdateGate(ptyId, false, emulator);
    return;
  }
  visiblePtyCounts.set(ptyId, count);
};

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
  const hostBgColor = getHostBackgroundColor();
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
  // Cache emulator for sync access to scrollback lines
  let emulator: ITerminalEmulator | null = null;
  // Cache recent rows keyed by absolute Y to cover scrollback seam misses.
  let recentRows = new Map<number, TerminalCell[]>();
  let recentRowOrder: number[] = [];
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
            const currentEmulator = emulator;
            if (currentEmulator && 'prefetchScrollbackLines' in currentEmulator) {
              await (currentEmulator as { prefetchScrollbackLines: (start: number, count: number) => Promise<void> })
                .prefetchScrollbackLines(start, count);
            }
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
          registerVisiblePty(ptyId);

          // Get emulator for scrollback access
          const em = await getEmulator(ptyId);
          if (!mounted) return;
          emulator = em;
          attachVisibleEmulator(ptyId, em);

          // Subscribe to unified updates (terminal + scroll combined)
          // This replaces separate subscribeToPty + subscribeToScroll with single subscription
          unsubscribe = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
            if (!mounted) return;

            const { terminalUpdate } = update;
            // Update terminal state
            if (terminalUpdate.isFull && terminalUpdate.fullState) {
              // Full refresh: store complete state
              terminalState = terminalUpdate.fullState;
              cachedRows = [...terminalUpdate.fullState.cells];
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

          // Trigger initial render
          requestRenderFrame();
        };

        init();

        onCleanup(() => {
          mounted = false;
          if (unsubscribe) {
            unsubscribe();
          }
          unregisterVisiblePty(ptyId, emulator);
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
      const colors = getHostColors() ?? getDefaultColors();
      const rgb = extractRgb(colors.background);
      const fallbackBg = getCachedRGBA(rgb.r, rgb.g, rgb.b);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
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
    const supportsPrefetch = !!emulator &&
      typeof (emulator as { prefetchScrollbackLines?: unknown }).prefetchScrollbackLines === 'function';
    if (prefetchRequest && supportsPrefetch && !prefetchInProgress && executePrefetchFn) {
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
      let row = rowCache[y];
      const absoluteY = scrollbackLength - viewportOffset + y;
      if (viewportOffset > 0 && row === null && recentRows.size > 0) {
        row = recentRows.get(absoluteY) ?? row;
      }
      if (row) {
        recentRows.set(absoluteY, row);
        recentRowOrder.push(absoluteY);
      }
      renderRow(buffer, row, y, cols, offsetX, offsetY, renderOptions, renderDeps, fallbackFg, fallbackBg);
    }

    const recentRowLimit = Math.max(100, rows * 4);
    while (recentRowOrder.length > recentRowLimit) {
      const oldest = recentRowOrder.shift();
      if (oldest !== undefined && !recentRowOrder.includes(oldest)) {
        recentRows.delete(oldest);
      }
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

  // Resize events don't always trigger a terminal update, so force a render to avoid blank frames.
  createEffect(
    on(
      [() => props.width, () => props.height],
      () => {
        setVersion(v => v + 1);
        renderer.requestRender();
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
          }}
          backgroundColor={hostBgColor}
        />
      }
    >
      <box
        style={{
          width: props.width,
          height: props.height,
        }}
        backgroundColor={hostBgColor}
        renderAfter={renderTerminal}
      />
    </Show>
  );
}

export default TerminalView;
