/**
 * Selection coordinate utilities
 * Pure functions for handling terminal selection coordinates and text extraction
 */

import type { TerminalCell, SelectionBounds } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * A point in the terminal, with both viewport and absolute coordinates
 */
export interface SelectionPoint {
  /** Column (0-indexed) */
  x: number;
  /** Row in viewport (0-indexed) */
  y: number;
  /** Absolute row including scrollback */
  absoluteY: number;
}

/**
 * Normalized selection range (start is always before end)
 * The focus cell is excluded from selection (Zellij-style)
 */
export interface SelectionRange {
  startX: number;
  startY: number;  // Absolute Y
  endX: number;
  endY: number;    // Absolute Y
  /** True if focus is at end position (forward selection), false if at start (backward) */
  focusAtEnd: boolean;
}

/**
 * Function to get a line of cells from the terminal
 */
export type LineGetter = (absoluteY: number) => TerminalCell[] | null;

// =============================================================================
// Coordinate Transformations
// =============================================================================

/**
 * Calculate absolute Y from viewport Y
 */
export function toAbsoluteY(y: number, scrollbackLength: number, scrollOffset: number): number {
  return scrollbackLength - scrollOffset + y;
}

/**
 * Normalize selection so start is always before end
 * Tracks whether focus is at end (forward) or start (backward) for exclusion
 */
export function normalizeSelection(
  anchor: SelectionPoint,
  focus: SelectionPoint
): SelectionRange {
  const anchorBefore =
    anchor.absoluteY < focus.absoluteY ||
    (anchor.absoluteY === focus.absoluteY && anchor.x <= focus.x);

  if (anchorBefore) {
    // Forward selection: focus is at end
    return {
      startX: anchor.x,
      startY: anchor.absoluteY,
      endX: focus.x,
      endY: focus.absoluteY,
      focusAtEnd: true,
    };
  } else {
    // Backward selection: focus is at start
    return {
      startX: focus.x,
      startY: focus.absoluteY,
      endX: anchor.x,
      endY: anchor.absoluteY,
      focusAtEnd: false,
    };
  }
}

// =============================================================================
// Bounds Calculation
// =============================================================================

/**
 * Calculate bounding box from normalized selection range
 * Enables O(1) spatial rejection in isCellSelected instead of per-cell checks
 */
export function calculateBounds(range: SelectionRange): SelectionBounds {
  return {
    minX: Math.min(range.startX, range.endX),
    maxX: Math.max(range.startX, range.endX),
    minY: range.startY,
    maxY: range.endY,
  };
}

// =============================================================================
// Cell Selection Checks
// =============================================================================

/**
 * Check if a cell at (x, absoluteY) is within the selection range
 * The focus cell is excluded (Zellij-style selection)
 */
export function isCellInRange(
  x: number,
  absoluteY: number,
  range: SelectionRange
): boolean {
  const { startX, startY, endX, endY, focusAtEnd } = range;

  // Outside vertical bounds
  if (absoluteY < startY || absoluteY > endY) {
    return false;
  }

  // Single line selection
  if (startY === endY) {
    // Exclude the focus cell
    if (focusAtEnd) {
      // Forward: exclude end (focus), so x < endX
      return x >= startX && x < endX;
    } else {
      // Backward: exclude start (focus), so x > startX
      return x > startX && x <= endX;
    }
  }

  // Multi-line selection
  if (absoluteY === startY) {
    // First line
    if (!focusAtEnd) {
      // Backward selection: focus is at start, exclude startX
      return x > startX;
    }
    // Forward selection: include from startX to end of line
    return x >= startX;
  }
  if (absoluteY === endY) {
    // Last line
    if (focusAtEnd) {
      // Forward selection: focus is at end, exclude endX
      return x < endX;
    }
    // Backward selection: include from start of line to endX
    return x <= endX;
  }

  // Middle lines: entire line is selected
  return true;
}

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Extract text from the selected range
 * Respects focusAtEnd to exclude the focus cell (Zellij-style)
 */
export function extractSelectedText(
  range: SelectionRange,
  scrollbackLength: number,
  getLine: LineGetter
): string {
  const { startX, startY, endX, endY, focusAtEnd } = range;
  const lines: string[] = [];

  for (let absY = startY; absY <= endY; absY++) {
    const row = getLine(absY);
    if (!row) continue;

    const isFirstRow = absY === startY;
    const isLastRow = absY === endY;
    const isSingleLine = startY === endY;

    // Determine start/end X for this row, respecting focus exclusion
    let rowStartX: number;
    let rowEndX: number;

    if (isSingleLine) {
      // Single line: exclude focus cell
      if (focusAtEnd) {
        rowStartX = startX;
        rowEndX = endX - 1;  // Exclude focus at end
      } else {
        rowStartX = startX + 1;  // Exclude focus at start
        rowEndX = endX;
      }
    } else if (isFirstRow) {
      // First row of multi-line
      if (!focusAtEnd) {
        // Backward: focus at start, exclude it
        rowStartX = startX + 1;
      } else {
        rowStartX = startX;
      }
      rowEndX = row.length - 1;
    } else if (isLastRow) {
      // Last row of multi-line
      rowStartX = 0;
      if (focusAtEnd) {
        // Forward: focus at end, exclude it
        rowEndX = endX - 1;
      } else {
        rowEndX = endX;
      }
    } else {
      // Middle row: entire line
      rowStartX = 0;
      rowEndX = row.length - 1;
    }

    // Skip if invalid range (can happen when focus == anchor)
    if (rowStartX > rowEndX) continue;

    // Extract text from row
    let rowText = '';
    for (let x = rowStartX; x <= Math.min(rowEndX, row.length - 1); x++) {
      const cell = row[x];
      if (!cell) continue;

      rowText += cell.char;

      // Skip placeholder cell for wide characters
      if (cell.width === 2) {
        x++;
      }
    }

    // Trim trailing whitespace from each line
    lines.push(rowText.trimEnd());
  }

  return lines.join('\n');
}
