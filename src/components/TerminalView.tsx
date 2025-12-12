/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { RGBA, type OptimizedBuffer } from '@opentui/core';
import type { TerminalState, TerminalCell, TerminalScrollState } from '../core/types';
import type { GhosttyEmulator } from '../terminal/ghostty-emulator';
import {
  getTerminalState,
  subscribeToPty,
  subscribeToScroll,
  getScrollState,
  getEmulator,
} from '../effect/bridge';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';

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
const SEARCH_MATCH_BG = RGBA.fromInts(180, 140, 0);    // Orange/gold for matches
const SEARCH_MATCH_FG = RGBA.fromInts(0, 0, 0);        // Black text
const SEARCH_CURRENT_BG = RGBA.fromInts(255, 200, 0);  // Bright yellow for current match
const SEARCH_CURRENT_FG = RGBA.fromInts(0, 0, 0);      // Black text

// RGBA cache to avoid per-cell allocations (pack RGB into single number as key)
const rgbaCache = new Map<number, RGBA>();
function getCachedRGBA(r: number, g: number, b: number): RGBA {
  const key = (r << 16) | (g << 8) | b;
  let cached = rgbaCache.get(key);
  if (!cached) {
    cached = RGBA.fromInts(r, g, b);
    rgbaCache.set(key, cached);
  }
  return cached;
}

// Text attributes for buffer API
const ATTR_BOLD = 1;
const ATTR_ITALIC = 2;
const ATTR_UNDERLINE = 4;
const ATTR_STRIKETHROUGH = 8;

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export const TerminalView = memo(function TerminalView({
  ptyId,
  width,
  height,
  isFocused,
  offsetX = 0,
  offsetY = 0,
}: TerminalViewProps) {
  // Get selection state
  const { isCellSelected, selectionVersion } = useSelection();
  // Get search state
  const { isSearchMatch, isCurrentMatch, searchVersion } = useSearch();

  // Store terminal state in a ref to avoid React re-renders
  const terminalStateRef = useRef<TerminalState | null>(null);
  // Cache scroll state for sync access in render
  const scrollStateRef = useRef<TerminalScrollState>({
    viewportOffset: 0,
    scrollbackLength: 0,
    isAtBottom: true,
  });
  // Cache emulator for sync access to scrollback lines
  const emulatorRef = useRef<GhosttyEmulator | null>(null);
  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = useState(0);
  // Track pending scroll update for throttling (setImmediate handle)
  const pendingScrollRef = useRef<ReturnType<typeof setImmediate> | null>(null);

  useEffect(() => {
    let unsubscribeState: (() => void) | null = null;
    let unsubscribeScroll: (() => void) | null = null;
    let mounted = true;

    // Initialize async resources
    const init = async () => {
      // Get initial terminal state
      const initialState = await getTerminalState(ptyId);
      if (!mounted) return;
      terminalStateRef.current = initialState;

      // Get emulator for scrollback access
      const emulator = await getEmulator(ptyId);
      if (!mounted) return;
      emulatorRef.current = emulator;

      // Get initial scroll state
      const scrollState = await getScrollState(ptyId);
      if (!mounted) return;
      if (scrollState) {
        scrollStateRef.current = scrollState;
      }

      // Subscribe to terminal state updates
      unsubscribeState = await subscribeToPty(ptyId, (state) => {
        terminalStateRef.current = state;
        // Increment version to trigger re-render
        setVersion(v => v + 1);
      });

      // Subscribe to scroll changes (throttled with setImmediate to batch rapid scrolls)
      unsubscribeScroll = await subscribeToScroll(ptyId, () => {
        // If we already have an update scheduled, let it handle this one too
        if (pendingScrollRef.current !== null) {
          return;
        }

        // Schedule update for next tick (batches multiple scroll events)
        pendingScrollRef.current = setImmediate(async () => {
          pendingScrollRef.current = null;

          if (!mounted) return;

          // Update scroll state ref
          const newScrollState = await getScrollState(ptyId);
          if (mounted && newScrollState) {
            scrollStateRef.current = newScrollState;
          }
          // Increment version to trigger re-render
          setVersion(v => v + 1);
        });
      });

      // Trigger initial render
      setVersion(v => v + 1);
    };

    init();

    return () => {
      mounted = false;
      if (unsubscribeState) {
        unsubscribeState();
      }
      if (unsubscribeScroll) {
        unsubscribeScroll();
      }
      // Cancel any pending scroll update
      if (pendingScrollRef.current !== null) {
        clearImmediate(pendingScrollRef.current);
        pendingScrollRef.current = null;
      }
    };
  }, [ptyId]);

  // Update scroll state periodically (for scrollback rendering)
  useEffect(() => {
    const updateScrollState = async () => {
      const scrollState = await getScrollState(ptyId);
      if (scrollState) {
        scrollStateRef.current = scrollState;
      }
    };

    // Update scroll state on each render (version change)
    updateScrollState();
  }, [ptyId, version]);

  // Render callback that directly writes to buffer
  const renderTerminal = useCallback((buffer: OptimizedBuffer) => {
    const state = terminalStateRef.current;
    if (!state) {
      // Clear the buffer area when state is null (PTY destroyed)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
        }
      }
      return;
    }

    // Get scroll state from cache
    const scrollState = scrollStateRef.current;
    const viewportOffset = scrollState.viewportOffset;
    const scrollbackLength = scrollState.scrollbackLength;
    const isAtBottom = viewportOffset === 0;

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    // Use top-left cell bg as fallback to paint unused area; default to black
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
    const fallbackFg = BLACK;

    // Pre-fetch all rows we need for rendering (optimization: fetch once per row, not per cell)
    const emulator = viewportOffset > 0 ? emulatorRef.current : null;
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
          rowCache[y] = emulator?.getScrollbackLine(absoluteY) ?? null;
        } else {
          // In live terminal area
          const liveY = absoluteY - scrollbackLength;
          rowCache[y] = state.cells[liveY] ?? null;
        }
      }
    }

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

        // Check if cell is selected
        const isSelected = isCellSelected(ptyId, x, absoluteY);

        // Check if cell is a search match
        const isMatch = isSearchMatch(ptyId, x, absoluteY);
        const isCurrent = isCurrentMatch(ptyId, x, absoluteY);

        // Determine cell colors
        let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
        let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

        // Apply dim effect
        if (cell.dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }

        // Apply inverse
        if (cell.inverse) {
          [fgR, bgR] = [bgR, fgR];
          [fgG, bgG] = [bgG, fgG];
          [fgB, bgB] = [bgB, fgB];
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

    }, [width, height, isFocused, offsetX, offsetY, ptyId, isCellSelected, selectionVersion, isSearchMatch, isCurrentMatch, searchVersion]);

  const terminalState = terminalStateRef.current;

  if (!terminalState) {
    return (
      <box
        style={{
          width,
          height,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg="#666666">Loading terminal...</text>
      </box>
    );
  }

  return (
    <box
      style={{
        width,
        height,
      }}
      renderAfter={renderTerminal}
    />
  );
});

export default TerminalView;
