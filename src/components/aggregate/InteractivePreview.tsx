/**
 * Interactive terminal preview component for aggregate view
 * Renders terminal using direct buffer access for performance
 * Uses the same approach as the main TerminalView (renderAfter callback)
 */

import { Show, createSignal, createEffect, onCleanup, on } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { RGBA, type OptimizedBuffer } from '@opentui/core';
import { resizePty, subscribeUnifiedToPty, getEmulator } from '../../effect/bridge';
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
} from '../../terminal/rendering';
import { useSelection } from '../../contexts/SelectionContext';
import { useSearch } from '../../contexts/SearchContext';
import { useTerminal } from '../../contexts/TerminalContext';
import type { TerminalState, TerminalCell, UnifiedTerminalUpdate } from '../../core/types';
import type { GhosttyEmulator } from '../../terminal/ghostty-emulator';

interface InteractivePreviewProps {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}

export function InteractivePreview(props: InteractivePreviewProps) {
  const renderer = useRenderer();
  // Get selection state - keep full context to access selectionVersion reactively
  const selection = useSelection();
  const { isCellSelected, getSelection } = selection;
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch } = search;
  // Get scroll state from context cache (synchronous, already updated by scroll events)
  const { getScrollState: getScrollStateFromCache } = useTerminal();

  // Plain variables (in Solid, no stale closure issues)
  let lastResize: { ptyId: string; width: number; height: number } | null = null;
  let terminalState: TerminalState | null = null;
  let unsubscribe: (() => void) | null = null;
  let cachedRows: TerminalCell[][] = [];
  // Cache emulator for sync access to scrollback lines
  let emulator: GhosttyEmulator | null = null;

  const [version, setVersion] = createSignal(0);

  // Resize PTY when previewing to match preview dimensions
  // Using on() with explicit deps - runs when ptyId, width, or height changes
  createEffect(
    on(
      [() => props.ptyId, () => props.width, () => props.height],
      ([ptyId, width, height]) => {
        if (!ptyId) return;

        // Only resize if dimensions actually changed
        if (lastResize && lastResize.ptyId === ptyId && lastResize.width === width && lastResize.height === height) {
          return;
        }

        // Resize the PTY to match the preview dimensions
        // When aggregate view closes, App.tsx will restore the original pane dimensions
        resizePty(ptyId, width, height);
        lastResize = { ptyId, width, height };
      },
      { defer: false }
    )
  );

  // Subscribe to terminal updates
  // Using on() for explicit ptyId dependency - effect re-runs only when ptyId changes
  createEffect(
    on(
      () => props.ptyId,
      (ptyId) => {
        // Clean up previous subscription first
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }

        if (!ptyId) {
          terminalState = null;
          setVersion(v => v + 1);
          return;
        }

        let mounted = true;
        // Frame batching: moved inside effect to ensure reset on re-run
        let renderRequested = false;
        cachedRows = [];

        // Batched render request
        const requestRender = () => {
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

        const init = async () => {
          // Get emulator for scrollback access
          const em = await getEmulator(ptyId);
          if (!mounted) return;
          emulator = em;

          const unsub = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
            if (!mounted) return;

            const { terminalUpdate } = update;

            if (terminalUpdate.isFull && terminalUpdate.fullState) {
              terminalState = terminalUpdate.fullState;
              cachedRows = [...terminalUpdate.fullState.cells];
            } else {
              const existingState = terminalState;
              if (existingState) {
                for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
                  cachedRows[rowIdx] = newRow;
                }
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

            requestRender();
          });

          if (mounted) {
            unsubscribe = unsub;
          } else {
            unsub();
          }

          if (mounted) {
            requestRender();
          }
        };

        init();

        onCleanup(() => {
          mounted = false;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          terminalState = null;
          emulator = null;
          cachedRows = [];
        });
      },
      { defer: false }
    )
  );

  // Direct buffer render callback (same approach as TerminalView)
  const renderTerminal = (buffer: OptimizedBuffer) => {
    const state = terminalState;
    const width = props.width;
    const height = props.height;
    const offsetX = props.offsetX ?? 0;
    const offsetY = props.offsetY ?? 0;
    const isInteractive = props.isInteractive;
    const ptyId = props.ptyId;

    if (!state || !ptyId) {
      // Clear buffer when no state
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
        }
      }
      return;
    }

    // Get scroll state from context cache (synchronous, no async overhead)
    const scrollState = getScrollStateFromCache(ptyId);
    const viewportOffset = scrollState?.viewportOffset ?? 0;
    const scrollbackLength = scrollState?.scrollbackLength ?? 0;
    const isAtBottom = viewportOffset === 0;

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    // Use top-left cell bg as fallback to paint unused area; default to black
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
    const fallbackFg = BLACK;

    // Pre-fetch all rows we need for rendering (optimization: fetch once per row, not per cell)
    const currentEmulator = viewportOffset > 0 ? emulator : null;
    const rowCache: (TerminalCell[] | null)[] = new Array(rows);

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
          // In scrollback buffer
          rowCache[y] = currentEmulator?.getScrollbackLine(absoluteY) ?? null;
        } else {
          // In live terminal area
          const liveY = absoluteY - scrollbackLength;
          rowCache[y] = state.cells[liveY] ?? null;
        }
      }
    }

    // Pre-check if selection/search is active for this pane (avoid many function calls per frame)
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

        // Only show cursor when at bottom (not scrolled back) and interactive
        const isCursor = isAtBottom && isInteractive && state.cursor.visible &&
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
          // Current search match (bright magenta/pink)
          fg = SEARCH_CURRENT_FG;
          bg = SEARCH_CURRENT_BG;
        } else if (isMatch) {
          // Other search matches (muted brown)
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
    if (!isAtBottom && scrollbackLength > 0) {
      const totalLines = scrollbackLength + rows;
      const thumbHeight = Math.max(1, Math.floor(rows * rows / totalLines));
      const scrollRange = rows - thumbHeight;
      // Position: 0 at top (fully scrolled back), scrollRange at bottom (at live terminal)
      const thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange);

      // Render scrollbar on the rightmost column
      const scrollbarX = offsetX + width - 1;
      for (let y = 0; y < rows; y++) {
        const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight;
        buffer.setCell(
          scrollbarX,
          y + offsetY,
          isThumb ? '█' : '░',
          isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
          SCROLLBAR_TRACK,
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

  // For Solid reactivity - version() triggers re-render
  const _v = () => version();

  return (
    <Show
      when={props.ptyId}
      fallback={
        <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
          <text fg="#666666">No terminal selected</text>
        </box>
      }
    >
      <Show
        when={terminalState || _v() >= 0}
        fallback={
          <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
            <text fg="#666666">Loading...</text>
          </box>
        }
      >
        <box style={{ width: props.width, height: props.height }} renderAfter={renderTerminal} />
      </Show>
    </Show>
  );
}
