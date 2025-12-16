/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import { RGBA, type OptimizedBuffer } from '@opentui/core';
import type { TerminalState, TerminalCell, TerminalScrollState, UnifiedTerminalUpdate } from '../core/types';
import type { GhosttyEmulator } from '../terminal/ghostty-emulator';
import {
  getTerminalState,
  subscribeUnifiedToPty,
  getEmulator,
} from '../effect/bridge';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { useTerminal } from '../contexts/TerminalContext';

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

const WHITE = RGBA.fromInts(255, 255, 255);
const BLACK = RGBA.fromInts(0, 0, 0);

// Scrollbar colors
const SCROLLBAR_TRACK = RGBA.fromInts(40, 40, 40);
const SCROLLBAR_THUMB = RGBA.fromInts(100, 100, 100);

// Selection colors
const SELECTION_BG = RGBA.fromInts(80, 120, 200);
const SELECTION_FG = RGBA.fromInts(255, 255, 255);

// Search highlight colors
const SEARCH_MATCH_BG = RGBA.fromInts(100, 80, 60);    // Muted brown for other matches
const SEARCH_MATCH_FG = RGBA.fromInts(200, 180, 160);  // Light tan text
const SEARCH_CURRENT_BG = RGBA.fromInts(255, 50, 150); // Bright magenta/pink for current match
const SEARCH_CURRENT_FG = RGBA.fromInts(255, 255, 255); // White text

// RGBA cache to avoid per-cell allocations (pack RGB into single number as key)
// Pre-cache common colors to skip Map lookup entirely
const rgbaCache = new Map<number, RGBA>();
rgbaCache.set(0x000000, BLACK);  // Pre-cache black
rgbaCache.set(0xFFFFFF, WHITE);  // Pre-cache white

function getCachedRGBA(r: number, g: number, b: number): RGBA {
  // Fast path for black (most common background)
  if ((r | g | b) === 0) return BLACK;
  // Fast path for white
  if (r === 255 && g === 255 && b === 255) return WHITE;

  const key = (r << 16) | (g << 8) | b;
  let cached = rgbaCache.get(key);
  if (!cached) {
    cached = RGBA.fromInts(r, g, b);
    rgbaCache.set(key, cached);
  }
  return cached;
}

// Text attributes for buffer API - must match OpenTUI's TextAttributes
// See: @opentui/core TextAttributes { BOLD: 1, DIM: 2, ITALIC: 4, UNDERLINE: 8, BLINK: 16, INVERSE: 32, HIDDEN: 64, STRIKETHROUGH: 128 }
const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_STRIKETHROUGH = 128;

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
  // Get scroll state from context cache (synchronous, already updated by scroll events)
  const { getScrollState: getScrollStateFromCache } = useTerminal();

  // Store terminal state in a plain variable (Solid has no stale closures)
  let terminalState: TerminalState | null = null;
  // Cache emulator for sync access to scrollback lines
  let emulator: GhosttyEmulator | null = null;
  // Frame batching: coalesce multiple updates into single render per event loop tick
  let renderRequested = false;

  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    const ptyId = props.ptyId;
    let unsubscribe: (() => void) | null = null;
    let mounted = true;

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
            renderer.requestRender();  // Trigger OpenTUI render
          }
        });
      }
    };

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

        // Request batched render (scroll state comes from context cache)
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
    });
  });

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

    // Pre-check if selection/search is active for this pane (avoid 5760 function calls per frame)
    const hasSelection = !!getSelection(ptyId)?.normalizedRange;
    const currentSearchState = search.searchState;
    const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;

    for (let y = 0; y < rows; y++) {
      const row = rowCache[y];
      // Calculate absolute Y for selection check (accounts for scrollback)
      const absoluteY = scrollbackLength - viewportOffset + y;

      for (let x = 0; x < cols; x++) {
        const cell = row?.[x] ?? null;

        if (!cell) {
          // No cell data - use fallback
          buffer.setCell(x + offsetX, y + offsetY, ' ', fallbackFg, fallbackBg, 0);
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
        buffer.setCell(x + offsetX, y + offsetY, cell.char, fg, bg, attributes);
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
  createEffect(() => {
    const sv = selection.selectionVersion;
    const searchV = search.searchVersion;
    renderer.requestRender();
  });

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
