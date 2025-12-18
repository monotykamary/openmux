/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { RGBA, type OptimizedBuffer } from '@opentui/core';
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
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
  SCROLLBAR_TRACK,
  SCROLLBAR_THUMB,
  SELECTION_BG,
  SELECTION_FG,
  SEARCH_MATCH_BG,
  SEARCH_MATCH_FG,
  SEARCH_CURRENT_BG,
  SEARCH_CURRENT_FG,
} from '../terminal/rendering';

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
  const { isCellSelected, getSelection } = selection;
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch } = search;
  // Store terminal state in a plain variable (Solid has no stale closures)
  let terminalState: TerminalState | null = null;
  // Store scroll state locally from unified updates to avoid race conditions
  // This ensures scroll state and terminal state are always in sync
  let scrollState: TerminalScrollState = { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true };
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
        const requestRenderFrame = () => {
          if (!renderRequested && mounted) {
            renderRequested = true;
            queueMicrotask(() => {
              if (mounted) {
                renderRequested = false;
                setVersion(v => v + 1);
                renderer.requestRender();
              }
            });
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
            const oldScrollbackLength = scrollState.scrollbackLength;
            const newScrollbackLength = update.scrollState.scrollbackLength;
            const scrollbackDelta = newScrollbackLength - oldScrollbackLength;
            const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;

            // Handle transition cache based on scrollback changes:
            // - When scrollback GROWS (delta > 0): capture lines moving from live terminal to scrollback
            // - When scrollback shrinks (delta < 0): reset occurred, clear stale cache
            // - When scrollback stays same (delta == 0) AND at scrollback limit: content shifted
            //   (old lines evicted, new lines added), clear stale cache
            // - When scrollback stays same (delta == 0) but NOT at limit: just in-place updates
            //   (animations, cursor moves), cache is still valid, don't clear
            if (scrollbackDelta > 0 && terminalState && scrollState.viewportOffset > 0) {
              // Capture lines transitioning from live terminal to scrollback BEFORE updating state.
              // We capture them so we can render them immediately without waiting for async prefetch.
              for (let i = 0; i < scrollbackDelta; i++) {
                const row = terminalState.cells[i];
                if (row) {
                  transitionCache.set(oldScrollbackLength + i, row);
                }
              }
            } else if (scrollbackDelta < 0 ||
                       (scrollbackDelta === 0 && isAtScrollbackLimit && oldScrollbackLength > 0)) {
              // Content shifted (at scrollback limit) or reset - clear stale transition cache entries
              // to prevent returning wrong data for offsets that now have different content
              transitionCache.clear();
            }

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
    const currentEmulator = viewportOffset > 0 ? emulator : null;
    const rowCache: (TerminalCell[] | null)[] = new Array(rows);

    // Track missing scrollback lines for prefetching
    let firstMissingOffset = -1;
    let lastMissingOffset = -1;

    for (let y = 0; y < rows; y++) {
      if (viewportOffset === 0) {
        // Normal case: use live terminal rows
        rowCache[y] = state.cells[y] ?? null;
      } else {
        // Scrolled back: calculate which row to fetch
        const absoluteY = scrollbackLength - viewportOffset + y;

        if (absoluteY < 0) {
          // Before scrollback
          rowCache[y] = null;
        } else if (absoluteY < scrollbackLength) {
          // In scrollback buffer - try emulator cache first, then transition cache
          let line = currentEmulator?.getScrollbackLine(absoluteY) ?? null;
          // Fall back to transition cache for lines that just moved from live terminal
          if (line === null) {
            line = transitionCache.get(absoluteY) ?? null;
          }
          rowCache[y] = line;
          // Track missing scrollback lines (null when should have data)
          if (line === null && currentEmulator) {
            if (firstMissingOffset === -1) {
              firstMissingOffset = absoluteY;
            }
            lastMissingOffset = absoluteY;
          }
        } else {
          // In live terminal area
          const liveY = absoluteY - scrollbackLength;
          rowCache[y] = state.cells[liveY] ?? null;
        }
      }
    }

    // Schedule prefetch for missing scrollback lines with buffer zone
    // Prefetch ahead of scroll direction to reduce flicker during fast scrolling
    if (firstMissingOffset !== -1 && !prefetchInProgress && executePrefetchFn) {
      // Prefetch buffer: 2x viewport height above current position
      const bufferSize = rows * 2;
      const prefetchStart = Math.max(0, firstMissingOffset - bufferSize);
      const prefetchEnd = Math.min(scrollbackLength - 1, lastMissingOffset + rows);
      const count = prefetchEnd - prefetchStart + 1;
      pendingPrefetch = { ptyId, start: prefetchStart, count };
      // Execute prefetch asynchronously (don't block render)
      queueMicrotask(executePrefetchFn);
    }

    // Pre-check if selection/search is active for this pane (avoid 5760 function calls per frame)
    const hasSelection = !!getSelection(ptyId)?.normalizedRange;
    const currentSearchState = search.searchState;
    const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;

    for (let y = 0; y < rows; y++) {
      const row = rowCache[y];
      // Calculate absolute Y for selection check (accounts for scrollback)
      const absoluteY = scrollbackLength - viewportOffset + y;

      // Track the previous cell to detect spacer cells after wide characters
      let prevCellWasWide = false;
      let prevCellBg: RGBA | null = null;

      for (let x = 0; x < cols; x++) {
        const cell = row?.[x] ?? null;

        if (!cell) {
          // No cell data - use fallback
          buffer.setCell(x + offsetX, y + offsetY, ' ', fallbackFg, fallbackBg, 0);
          prevCellWasWide = false;
          prevCellBg = null;
          continue;
        }

        // If previous cell was wide (width=2), this is a spacer cell
        // Use drawChar with codepoint 0 to mark as continuation without overwriting the wide char
        if (prevCellWasWide && prevCellBg) {
          buffer.drawChar(0, x + offsetX, y + offsetY, prevCellBg, prevCellBg, 0);
          prevCellWasWide = false;
          prevCellBg = null;
          continue;
        }

        // Only show cursor when at bottom (not scrolled back) and focused
        const isCursor = isAtBottom && isFocused && state.cursor.visible &&
                         state.cursor.y === y && state.cursor.x === x;

        // Check if cell is selected (skip function call if no active selection)
        const isSelected = hasSelection && isCellSelected(ptyId, x, absoluteY);

        // Check if cell is a search match (skip function calls if no active search)
        const isMatch = hasSearch && isSearchMatch(ptyId, x, absoluteY);
        const isCurrent = hasSearch && isCurrentMatch(ptyId, x, absoluteY);

        // Determine cell colors
        let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
        let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

        // Apply dim effect
        if (cell.dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }

        // Apply inverse (avoid array destructuring for performance)
        if (cell.inverse) {
          const tmpR = fgR; fgR = bgR; bgR = tmpR;
          const tmpG = fgG; fgG = bgG; bgG = tmpG;
          const tmpB = fgB; fgB = bgB; bgB = tmpB;
        }

        let fg = getCachedRGBA(fgR, fgG, fgB);
        let bg = getCachedRGBA(bgR, bgG, bgB);

        // Apply styling in priority order: cursor > selection > current match > other matches
        if (isCursor) {
          // Cursor styling (highest priority when visible)
          fg = bg ?? BLACK;
          bg = WHITE;
        } else if (isSelected) {
          // Selection styling
          fg = SELECTION_FG;
          bg = SELECTION_BG;
        } else if (isCurrent) {
          // Current search match (bright yellow)
          fg = SEARCH_CURRENT_FG;
          bg = SEARCH_CURRENT_BG;
        } else if (isMatch) {
          // Other search matches (orange)
          fg = SEARCH_MATCH_FG;
          bg = SEARCH_MATCH_BG;
        }

        // Calculate attributes
        let attributes = 0;
        if (cell.bold) attributes |= ATTR_BOLD;
        if (cell.italic) attributes |= ATTR_ITALIC;
        if (cell.underline) attributes |= ATTR_UNDERLINE;
        if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

        // Write cell directly to buffer (with offset for pane position)
        // Use fallback space if char is empty to ensure cell is always overwritten
        buffer.setCell(x + offsetX, y + offsetY, cell.char || ' ', fg, bg, attributes);

        // Track if this cell was wide for next iteration
        prevCellWasWide = cell.width === 2;
        prevCellBg = prevCellWasWide ? bg : null;
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
    // Uses semi-transparent overlay to preserve underlying content visibility
    if (!isAtBottom && scrollbackLength > 0) {
      const totalLines = scrollbackLength + rows;
      const thumbHeight = Math.max(1, Math.floor(rows * rows / totalLines));
      const scrollRange = rows - thumbHeight;
      // Position: 0 at top (fully scrolled back), scrollRange at bottom (at live terminal)
      const thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange);

      // Render scrollbar on the rightmost column
      // Preserve underlying character but apply scrollbar background tint
      const scrollbarX = offsetX + width - 1;
      const contentCol = cols - 1; // Last column in terminal content
      for (let y = 0; y < rows; y++) {
        const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight;
        // Get the underlying cell to preserve its character
        const row = rowCache[y];
        const cell = contentCol >= 0 ? row?.[contentCol] : null;
        const underlyingChar = cell?.char || ' ';
        const underlyingFg = cell ? getCachedRGBA(cell.fg.r, cell.fg.g, cell.fg.b) : fallbackFg;
        buffer.setCell(
          scrollbarX,
          y + offsetY,
          underlyingChar,
          underlyingFg,
          isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
          0
        );
      }
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
