/**
 * Cell conversion utilities for terminal rendering.
 * Converts GhosttyCell format to our internal TerminalCell format.
 */

import { CellFlags, type GhosttyCell } from '../ghostty-vt';
import type { TerminalCell } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import { extractRgb } from '../terminal-colors';
import { isZeroWidthChar, isSpaceLikeChar, isCjkIdeograph, codepointToChar } from './codepoint-utils';

/**
 * RGB color value
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Safely extract RGB values, ensuring they are valid numbers.
 * Converts NaN, undefined, and non-numbers to 0.
 *
 * @param r - Red component
 * @param g - Green component
 * @param b - Blue component
 * @returns Validated RGB object
 */
export function safeRgb(r: number, g: number, b: number): RGB {
  return {
    r: typeof r === 'number' && !Number.isNaN(r) ? r : 0,
    g: typeof g === 'number' && !Number.isNaN(g) ? g : 0,
    b: typeof b === 'number' && !Number.isNaN(b) ? b : 0,
  };
}

/**
 * Create an empty terminal cell with the given colors.
 *
 * @param colors - Terminal color scheme
 * @returns Empty cell with default colors
 */
export function createEmptyCell(colors: TerminalColors): TerminalCell {
  const fg = extractRgb(colors.foreground);
  const bg = extractRgb(colors.background);

  return {
    char: ' ',
    fg,
    bg,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}

/**
 * Create a fill cell for EOL padding.
 * Uses the last cell's background color or defaults.
 *
 * @param lastCell - The last cell in the line (or null)
 * @param colors - Terminal color scheme for defaults
 * @returns Fill cell for EOL padding
 */
export function createFillCell(lastCell: GhosttyCell | null, colors: TerminalColors): TerminalCell {
  const fillBg = lastCell
    ? safeRgb(lastCell.bg_r, lastCell.bg_g, lastCell.bg_b)
    : extractRgb(colors.background);
  const fillFg = lastCell
    ? safeRgb(lastCell.fg_r, lastCell.fg_g, lastCell.fg_b)
    : extractRgb(colors.foreground);

  return {
    char: ' ',
    fg: fillFg,
    bg: fillBg,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}

/**
 * Convert a single GhosttyCell to TerminalCell.
 * Handles special cases like zero-width chars, space-like chars, CJK validation, etc.
 *
 * @param cell - The GhosttyCell to convert
 * @returns Converted TerminalCell
 */
export function convertCell(cell: GhosttyCell): TerminalCell {
  // Safely extract colors with validation
  const fg = safeRgb(cell.fg_r, cell.fg_g, cell.fg_b);
  const bg = safeRgb(cell.bg_r, cell.bg_g, cell.bg_b);

  // Zero-width characters render as space but preserve background color
  // Only strip foreground to prevent invisible colored text
  if (isZeroWidthChar(cell.codepoint)) {
    return {
      char: ' ',
      fg: bg, // fg = bg (invisible)
      bg: bg,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    };
  }

  // Space-like characters (braille blank, typographic spaces, etc.) should be
  // normalized to regular space to avoid rendering inconsistencies between
  // terminals. The colors are preserved so backgrounds render correctly.
  if (isSpaceLikeChar(cell.codepoint)) {
    return {
      char: ' ',
      fg,
      bg,
      bold: (cell.flags & CellFlags.BOLD) !== 0,
      italic: (cell.flags & CellFlags.ITALIC) !== 0,
      underline: (cell.flags & CellFlags.UNDERLINE) !== 0,
      strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
      inverse: (cell.flags & CellFlags.INVERSE) !== 0,
      blink: (cell.flags & CellFlags.BLINK) !== 0,
      dim: (cell.flags & CellFlags.FAINT) !== 0,
      width: 1, // Normalize to width 1 for consistent rendering
    };
  }

  // Width=0 cells are spacer/continuation cells for wide characters
  // They should render as empty space with the cell's background color
  if (cell.width === 0) {
    return {
      char: ' ',
      fg,
      bg,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    };
  }

  // Check for INVISIBLE flag (CellFlags.INVISIBLE = 32)
  // Invisible cells should render as space but keep their colors
  const isInvisible = (cell.flags & 32) !== 0;

  // CJK ideographs should always have width=2. If we see a CJK codepoint with
  // width=1, it's likely corrupted cell data (e.g., from byte misalignment in
  // fast-rendering demos). Filter these out to prevent random Chinese chars.
  if (isCjkIdeograph(cell.codepoint) && cell.width !== 2) {
    return {
      char: ' ',
      fg,
      bg,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    };
  }

  // Convert codepoint to character
  const char = codepointToChar(cell.codepoint, isInvisible);

  return {
    char,
    fg,
    bg,
    bold: (cell.flags & CellFlags.BOLD) !== 0,
    italic: (cell.flags & CellFlags.ITALIC) !== 0,
    underline: (cell.flags & CellFlags.UNDERLINE) !== 0,
    strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
    inverse: (cell.flags & CellFlags.INVERSE) !== 0,
    blink: (cell.flags & CellFlags.BLINK) !== 0,
    dim: (cell.flags & CellFlags.FAINT) !== 0,
    width: cell.width as 1 | 2,
    hyperlinkId: cell.hyperlink_id,
  };
}

/**
 * Convert a line of GhosttyCell to TerminalCell array with EOL fill.
 *
 * @param line - Array of GhosttyCell from the terminal
 * @param cols - Number of columns to fill to
 * @param colors - Terminal color scheme for fill cells
 * @returns Array of TerminalCell with EOL padding
 */
export function convertLine(line: GhosttyCell[], cols: number, colors: TerminalColors): TerminalCell[] {
  const row: TerminalCell[] = [];
  const lineLength = Math.min(line.length, cols);

  for (let x = 0; x < lineLength; x++) {
    row.push(convertCell(line[x]));
  }

  // Fill remaining cells with default background color (not last cell's color)
  // Using default prevents "smearing" where colored backgrounds extend to EOL
  if (lineLength < cols) {
    const fg = extractRgb(colors.foreground);
    const bg = extractRgb(colors.background);

    for (let x = lineLength; x < cols; x++) {
      // Create a new object for each cell to avoid shared references
      row.push({
        char: ' ',
        fg,
        bg,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      });
    }
  }

  return row;
}

/**
 * Create an empty row using the terminal's default colors.
 *
 * @param cols - Number of columns
 * @param colors - Terminal color scheme
 * @returns Array of empty cells
 */
export function createEmptyRow(cols: number, colors: TerminalColors): TerminalCell[] {
  const row: TerminalCell[] = [];
  const fg = extractRgb(colors.foreground);
  const bg = extractRgb(colors.background);

  for (let x = 0; x < cols; x++) {
    // Create a new object for each cell to avoid shared references
    row.push({
      char: ' ',
      fg,
      bg,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    });
  }
  return row;
}
