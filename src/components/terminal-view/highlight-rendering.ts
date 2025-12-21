/**
 * Highlight Rendering - handles selection, search match, and cursor cell rendering
 */
import type { OptimizedBuffer, RGBA } from '@opentui/core';
import type { TerminalCell } from '../../core/types';
import {
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE,
  BLACK,
  WHITE,
  getCachedRGBA,
} from '../../terminal/rendering';

export interface HighlightTarget {
  buffer: OptimizedBuffer;
  offsetX: number;
  offsetY: number;
}

/**
 * Draw a cell with highlight colors (used for selection and search matches)
 */
export function drawHighlightedCell(
  target: HighlightTarget,
  row: TerminalCell[],
  rowY: number,
  x: number,
  fg: RGBA,
  bg: RGBA,
  cols: number
): void {
  const cell = row[x] ?? null;
  if (!cell) {
    // Handle wide character spacer
    const prevCell = x > 0 ? row[x - 1] ?? null : null;
    if (prevCell?.width === 2) {
      target.buffer.drawChar(0, x + target.offsetX, rowY, bg, bg, 0);
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
    target.buffer.drawChar(codepoint, x + target.offsetX, rowY, fg, bg, attributes);
  } else {
    target.buffer.setCell(x + target.offsetX, rowY, char, fg, bg, attributes);
  }

  // Handle wide character spacer cell
  if (cell.width === 2) {
    const spacerX = x + 1;
    if (spacerX < cols) {
      target.buffer.drawChar(0, spacerX + target.offsetX, rowY, bg, bg, 0);
    }
  }
}

/**
 * Draw cursor cell with inverted colors
 */
export function drawCursorCell(
  target: HighlightTarget,
  row: TerminalCell[],
  rowY: number,
  x: number,
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
    const tmpR = fgR; fgR = bgR; bgR = tmpR;
    const tmpG = fgG; fgG = bgG; bgG = tmpG;
    const tmpB = fgB; fgB = bgB; bgB = tmpB;
  }

  const bg = getCachedRGBA(bgR, bgG, bgB);
  const cursorFg = bg ?? BLACK;

  drawHighlightedCell(target, row, rowY, x, cursorFg, WHITE, cols);
}

export interface HighlightRanges {
  selectedRange: { start: number; end: number } | null;
  matchRanges: Array<{ startCol: number; endCol: number }> | null;
  currentMatchStart: number;
  currentMatchEnd: number;
  cursorCol: number;
  cursorRow: number;
}

export interface HighlightColors {
  selectionFg: RGBA;
  selectionBg: RGBA;
  searchMatchFg: RGBA;
  searchMatchBg: RGBA;
  searchCurrentFg: RGBA;
  searchCurrentBg: RGBA;
}

/**
 * Draw all highlights for a row (selection, search matches, cursor)
 */
export function drawRowHighlights(
  target: HighlightTarget,
  row: TerminalCell[],
  rowY: number,
  rowIndex: number,
  cols: number,
  ranges: HighlightRanges,
  colors: HighlightColors
): void {
  const { selectedRange, matchRanges, currentMatchStart, currentMatchEnd, cursorCol, cursorRow } = ranges;
  const { selectionFg, selectionBg, searchMatchFg, searchMatchBg, searchCurrentFg, searchCurrentBg } = colors;

  // Draw search matches (background layer)
  if (matchRanges) {
    for (const range of matchRanges) {
      const start = Math.max(range.startCol, 0);
      const end = Math.min(range.endCol, cols);
      for (let x = start; x < end; x++) {
        drawHighlightedCell(target, row, rowY, x, searchMatchFg, searchMatchBg, cols);
      }
    }
  }

  // Draw current search match (overlays regular matches)
  if (currentMatchStart >= 0 && currentMatchEnd > currentMatchStart) {
    const start = Math.max(currentMatchStart, 0);
    const end = Math.min(currentMatchEnd, cols);
    for (let x = start; x < end; x++) {
      drawHighlightedCell(target, row, rowY, x, searchCurrentFg, searchCurrentBg, cols);
    }
  }

  // Draw selection (overlays search)
  if (selectedRange) {
    const start = Math.max(selectedRange.start, 0);
    const end = Math.min(selectedRange.end, cols - 1);
    for (let x = start; x <= end; x++) {
      drawHighlightedCell(target, row, rowY, x, selectionFg, selectionBg, cols);
    }
  }

  // Draw cursor (top layer)
  if (rowIndex === cursorRow && cursorCol >= 0 && cursorCol < cols) {
    drawCursorCell(target, row, rowY, cursorCol, cols);
  }
}

/**
 * Check if a row needs highlight rendering
 */
export function rowNeedsHighlights(
  rowIndex: number,
  cursorRow: number,
  hasSelection: boolean,
  hasSearch: boolean,
  getSelectedColumnsForRow: (ptyId: string, absoluteY: number, cols: number) => { start: number; end: number } | null,
  getSearchMatchRanges: (ptyId: string, absoluteY: number) => Array<{ startCol: number; endCol: number }> | null,
  currentMatch: { lineIndex: number; startCol: number; endCol: number } | null,
  ptyId: string,
  absoluteY: number,
  cols: number
): HighlightRanges {
  let selectedRange: { start: number; end: number } | null = null;
  let matchRanges: Array<{ startCol: number; endCol: number }> | null = null;
  let currentMatchStart = -1;
  let currentMatchEnd = -1;

  if (hasSelection) {
    selectedRange = getSelectedColumnsForRow(ptyId, absoluteY, cols);
  }

  if (hasSearch) {
    matchRanges = getSearchMatchRanges(ptyId, absoluteY);
    if (currentMatch && currentMatch.lineIndex === absoluteY && currentMatch.startCol >= 0) {
      currentMatchStart = currentMatch.startCol;
      currentMatchEnd = currentMatch.endCol;
    }
  }

  return {
    selectedRange,
    matchRanges,
    currentMatchStart,
    currentMatchEnd,
    cursorCol: rowIndex === cursorRow ? cursorRow : -1,
    cursorRow,
  };
}

/**
 * Check if row has any highlights that need rendering
 */
export function hasRowHighlights(ranges: HighlightRanges, rowIndex: number): boolean {
  return (
    rowIndex === ranges.cursorRow ||
    ranges.selectedRange !== null ||
    (ranges.matchRanges !== null && ranges.matchRanges.length > 0) ||
    ranges.currentMatchStart >= 0
  );
}
