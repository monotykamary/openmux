/**
 * GhosttyEmulator - Terminal emulator using ghostty-web's WASM VT parser
 */

import { Ghostty, GhosttyTerminal, CellFlags, type GhosttyCell, type Cursor } from 'ghostty-web';
import type { TerminalState, TerminalCell, TerminalCursor } from '../core/types';
import { getDefaultColors, extractRgb, type TerminalColors } from './terminal-colors';

/**
 * Options for creating a GhosttyEmulator
 */
export interface GhosttyEmulatorOptions {
  cols?: number;
  rows?: number;
  colors?: TerminalColors;
}

let ghosttyInstance: Ghostty | null = null;

/**
 * Initialize ghostty WASM module (call once at startup)
 */
export async function initGhostty(): Promise<Ghostty> {
  if (ghosttyInstance) {
    return ghosttyInstance;
  }

  // Load WASM from node_modules
  ghosttyInstance = await Ghostty.load();
  return ghosttyInstance;
}

/**
 * Get the initialized ghostty instance
 */
export function getGhostty(): Ghostty {
  if (!ghosttyInstance) {
    throw new Error('Ghostty not initialized. Call initGhostty() first.');
  }
  return ghosttyInstance;
}

/**
 * Check if ghostty is initialized
 */
export function isGhosttyInitialized(): boolean {
  return ghosttyInstance !== null;
}

/**
 * GhosttyEmulator wraps GhosttyTerminal for use with our PTY manager
 * Optimized with dirty line tracking to minimize allocations
 */
export class GhosttyEmulator {
  private terminal: GhosttyTerminal;
  private _cols: number;
  private _rows: number;
  private subscribers: Set<(state: TerminalState) => void> = new Set();

  // Terminal colors (queried from host or defaults)
  private colors: TerminalColors;

  // Cached cell state for dirty line optimization
  private cachedCells: TerminalCell[][] = [];
  private cellsInitialized = false;
  // Row version tracking for efficient React change detection
  private rowVersions: number[] = [];
  private globalVersion = 0;
  // Cached empty cell to avoid repeated allocation
  private cachedEmptyCell: TerminalCell | null = null;

  constructor(options: GhosttyEmulatorOptions = {}) {
    const { cols = 80, rows = 24, colors } = options;
    const ghostty = getGhostty();
    this._cols = cols;
    this._rows = rows;
    this.colors = colors ?? getDefaultColors();

    const config = {
      scrollbackLimit: 10000,
    } as {
      scrollbackLimit: number;
      bgColor?: number;
      fgColor?: number;
      palette?: number[];
    };

    // Only override the palette when we have real host colors; otherwise let ghostty default
    if (!this.colors.isDefault) {
      config.bgColor = this.colors.background;
      config.fgColor = this.colors.foreground;
      config.palette = this.colors.palette;
    }

    // Configure ghostty-web with queried colors
    this.terminal = ghostty.createTerminal(cols, rows, config);

    // Initialize cached cells
    this.initializeCachedCells();
  }

  /**
   * Initialize the cached cells array with empty cells
   */
  private initializeCachedCells(): void {
    this.cachedCells = [];
    this.rowVersions = [];
    for (let y = 0; y < this._rows; y++) {
      const row: TerminalCell[] = [];
      for (let x = 0; x < this._cols; x++) {
        row.push(this.createEmptyCell());
      }
      this.cachedCells.push(row);
      this.rowVersions.push(0);
    }
    this.cellsInitialized = true;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  /**
   * Get the terminal's color scheme
   */
  getColors(): TerminalColors {
    return this.colors;
  }

  /**
   * Write data to terminal (parses VT sequences)
   */
  write(data: string | Uint8Array): void {
    this.terminal.write(data);
    this.notifySubscribers();
  }

  /**
   * Resize terminal
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.terminal.resize(cols, rows);

    // Reinitialize cached cells for new dimensions
    this.initializeCachedCells();

    // Force full refresh after resize
    this.updateAllCells();
    this.notifySubscribers();
  }

  /**
   * Update all cells from terminal (used after resize or initial load)
   */
  private updateAllCells(): void {
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      const row = this.cachedCells[y] || [];

      if (line) {
        for (let x = 0; x < Math.min(line.length, this._cols); x++) {
          row[x] = this.convertCell(line[x]);
        }
      }
      // Fill remaining with empty cells
      for (let x = (line?.length ?? 0); x < this._cols; x++) {
        row[x] = this.createEmptyCell();
      }

      this.cachedCells[y] = row;
      this.rowVersions[y]++;
    }
    this.globalVersion++;
    this.terminal.clearDirty();
  }

  /**
   * Get cursor position and visibility
   */
  getCursor(): Cursor {
    return this.terminal.getCursor();
  }

  /**
   * Get a line of cells
   */
  getLine(y: number): GhosttyCell[] | null {
    return this.terminal.getLine(y);
  }

  /**
   * Get all visible lines
   */
  getAllLines(): GhosttyCell[][] {
    return this.terminal.getAllLines();
  }

  /**
   * Check if terminal is dirty (needs redraw)
   */
  isDirty(): boolean {
    return this.terminal.isDirty();
  }

  /**
   * Clear dirty flags after rendering
   */
  clearDirty(): void {
    this.terminal.clearDirty();
  }

  /**
   * Check if in alternate screen buffer
   */
  isAlternateScreen(): boolean {
    return this.terminal.isAlternateScreen();
  }

  /**
   * Get scrollback length
   */
  getScrollbackLength(): number {
    return this.terminal.getScrollbackLength();
  }

  /**
   * Get a line from the scrollback buffer
   * @param offset Line offset from top of scrollback (0 = oldest line)
   * @returns Array of cells, or null if not available
   */
  getScrollbackLine(offset: number): TerminalCell[] | null {
    const line = this.terminal.getScrollbackLine(offset);
    if (!line) return null;
    return line.map(cell => this.convertCell(cell));
  }

  /**
   * Get cursor key mode (DECCKM - DEC mode 1)
   * When enabled, arrow keys should send application sequences (\x1bOx instead of \x1b[x)
   */
  getCursorKeyMode(): 'normal' | 'application' {
    // DEC mode 1 = DECCKM (Cursor Key Mode)
    // false = DEC mode, not ANSI mode
    return this.terminal.getMode(1, false) ? 'application' : 'normal';
  }

  /**
   * Check if mouse tracking is enabled by the application running in the terminal
   *
   * Mouse tracking modes (DEC private modes):
   * - 1000: Normal Mouse Tracking (X10 compatible) - reports button press/release
   * - 1002: Button-Event Tracking - reports motion when button pressed
   * - 1003: Any-Event Tracking - reports all motion
   * - 1006: SGR Extended Mode - extended coordinate format
   *
   * Returns true if any mouse tracking mode is enabled
   */
  isMouseTrackingEnabled(): boolean {
    // Check if any mouse tracking mode is enabled
    // These are DEC private modes (second param = false)
    const mode1000 = this.terminal.getMode(1000, false); // Normal tracking
    const mode1002 = this.terminal.getMode(1002, false); // Button-event tracking
    const mode1003 = this.terminal.getMode(1003, false); // Any-event tracking

    return mode1000 || mode1002 || mode1003;
  }

  /**
   * Get terminal state in our format
   * Uses dirty line tracking for efficient updates
   */
  getTerminalState(): TerminalState {
    const cursor = this.getCursor();

    // Update only dirty lines (major optimization)
    this.updateDirtyCells();

    return {
      cols: this._cols,
      rows: this._rows,
      cells: this.cachedCells,
      rowVersions: this.rowVersions,
      cursor: {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: 'block',
      },
      alternateScreen: this.isAlternateScreen(),
      mouseTracking: this.isMouseTrackingEnabled(),
      cursorKeyMode: this.getCursorKeyMode(),
    };
  }

  /**
   * Update only dirty cells using ghostty's dirty tracking
   * This is the key optimization - instead of rebuilding all cells,
   * we only update the rows that have changed
   *
   * Uses in-place mutation with version tracking for efficient React updates
   */
  private updateDirtyCells(): void {
    // If not initialized, do a full update
    if (!this.cellsInitialized) {
      this.updateAllCells();
      return;
    }

    // Get only the dirty lines from ghostty
    const dirtyLines = this.terminal.getDirtyLines();

    // Update only the dirty rows in our cache (in-place mutation)
    // Increment version for dirty rows so React can detect changes
    for (const [y, line] of dirtyLines) {
      if (y >= 0 && y < this._rows && this.cachedCells[y]) {
        const row = this.cachedCells[y];
        const lineLength = Math.min(line.length, this._cols);

        // Update cells in place
        for (let x = 0; x < lineLength; x++) {
          row[x] = this.convertCell(line[x]);
        }

        // If the line is shorter than the viewport width, fill with empty cells
        // Don't propagate lastCell's colors - let ghostty-web handle styling
        const emptyCell = this.createEmptyCell();
        for (let x = lineLength; x < this._cols; x++) {
          row[x] = emptyCell;
        }
        // Increment version for this row
        this.rowVersions[y]++;
        this.globalVersion++;
      }
    }

    // Clear dirty flags after processing
    this.terminal.clearDirty();
  }

  /**
   * Check if a codepoint is valid and renderable
   * Filters out null, replacement chars, surrogates, control chars, and invalid Unicode
   */
  private isValidCodepoint(codepoint: number): boolean {
    // Null/zero codepoint
    if (codepoint <= 0) return false;
    // C0 control characters (0x01-0x1F) except space (0x20)
    // These are non-printable and shouldn't be rendered as glyphs
    if (codepoint < 0x20) return false;
    // DEL character (0x7F)
    if (codepoint === 0x7F) return false;
    // C1 control characters (0x80-0x9F)
    if (codepoint >= 0x80 && codepoint <= 0x9F) return false;
    // Replacement character (U+FFFD) - renders as diamond question mark
    if (codepoint === 0xFFFD) return false;
    // Unicode surrogates (U+D800-U+DFFF) - invalid on their own
    if (codepoint >= 0xD800 && codepoint <= 0xDFFF) return false;
    // Non-characters (U+FFFE, U+FFFF, and U+nFFFE/U+nFFFF in each plane)
    if ((codepoint & 0xFFFE) === 0xFFFE) return false;
    // Out of Unicode range
    if (codepoint > 0x10FFFF) return false;
    // Note: Zero-width characters (U+200B-U+200F, U+2060, U+FEFF, U+FE00-U+FE0F)
    // are handled separately in isZeroWidthChar() with different treatment
    return true;
  }

  /**
   * Check if a codepoint is a CJK ideograph that requires width=2
   * These should only be rendered if the cell has proper double-width (width=2)
   * If they appear with width=1, it's likely corrupted cell data
   */
  private isCjkIdeograph(codepoint: number): boolean {
    // CJK Unified Ideographs (U+4E00-U+9FFF)
    if (codepoint >= 0x4E00 && codepoint <= 0x9FFF) return true;
    // CJK Unified Ideographs Extension A (U+3400-U+4DBF)
    if (codepoint >= 0x3400 && codepoint <= 0x4DBF) return true;
    // CJK Unified Ideographs Extension B (U+20000-U+2A6DF)
    if (codepoint >= 0x20000 && codepoint <= 0x2A6DF) return true;
    // CJK Unified Ideographs Extension C (U+2A700-U+2B73F)
    if (codepoint >= 0x2A700 && codepoint <= 0x2B73F) return true;
    // CJK Unified Ideographs Extension D (U+2B740-U+2B81F)
    if (codepoint >= 0x2B740 && codepoint <= 0x2B81F) return true;
    // CJK Unified Ideographs Extension E (U+2B820-U+2CEAF)
    if (codepoint >= 0x2B820 && codepoint <= 0x2CEAF) return true;
    // CJK Unified Ideographs Extension F (U+2CEB0-U+2EBEF)
    if (codepoint >= 0x2CEB0 && codepoint <= 0x2EBEF) return true;
    // CJK Compatibility Ideographs (U+F900-U+FAFF)
    if (codepoint >= 0xF900 && codepoint <= 0xFAFF) return true;
    // CJK Compatibility Ideographs Supplement (U+2F800-U+2FA1F)
    if (codepoint >= 0x2F800 && codepoint <= 0x2FA1F) return true;
    return false;
  }

  /**
   * Check if a codepoint is a space-like character that should be normalized to regular space
   * These are visually empty/blank characters that might cause rendering inconsistencies
   * if not converted to standard space (U+0020)
   */
  private isSpaceLikeChar(codepoint: number): boolean {
    // No-break space (U+00A0)
    if (codepoint === 0x00A0) return true;
    // Ogham space mark (U+1680) - renders as space in most fonts
    if (codepoint === 0x1680) return true;
    // Various width spaces (U+2000-U+200A)
    // EN QUAD, EM QUAD, EN SPACE, EM SPACE, etc.
    if (codepoint >= 0x2000 && codepoint <= 0x200A) return true;
    // NARROW NO-BREAK SPACE (U+202F)
    if (codepoint === 0x202F) return true;
    // MEDIUM MATHEMATICAL SPACE (U+205F)
    if (codepoint === 0x205F) return true;
    // IDEOGRAPHIC SPACE (U+3000) - full-width CJK space
    if (codepoint === 0x3000) return true;
    // BRAILLE PATTERN BLANK (U+2800) - all dots off, looks empty
    // Often used in TUI graphics that use braille patterns
    if (codepoint === 0x2800) return true;
    return false;
  }

  /**
   * Check if a codepoint is a zero-width/invisible character that should use default colors
   * These are invisible modifiers that can carry stale color information
   * Based on Unicode "Default_Ignorable_Code_Point" property
   */
  private isZeroWidthChar(codepoint: number): boolean {
    // Soft hyphen (U+00AD) - invisible unless at line break
    if (codepoint === 0x00AD) return true;
    // Combining grapheme joiner (U+034F)
    if (codepoint === 0x034F) return true;
    // Arabic letter mark (U+061C)
    if (codepoint === 0x061C) return true;
    // Hangul jungseong/jongseong fillers (U+115F-U+1160)
    if (codepoint >= 0x115F && codepoint <= 0x1160) return true;
    // Khmer vowel inherent (U+17B4-U+17B5)
    if (codepoint >= 0x17B4 && codepoint <= 0x17B5) return true;
    // Mongolian free variation selectors and vowel separator (U+180B-U+180F)
    if (codepoint >= 0x180B && codepoint <= 0x180F) return true;
    // Zero-width and directional formatting (U+200B-U+200F)
    if (codepoint >= 0x200B && codepoint <= 0x200F) return true;
    // Line/paragraph separators (U+2028-U+2029)
    if (codepoint >= 0x2028 && codepoint <= 0x2029) return true;
    // Bidirectional formatting (U+202A-U+202E)
    if (codepoint >= 0x202A && codepoint <= 0x202E) return true;
    // Word joiner and invisible operators (U+2060-U+206F)
    if (codepoint >= 0x2060 && codepoint <= 0x206F) return true;
    // Hangul filler (U+3164)
    if (codepoint === 0x3164) return true;
    // Variation selectors (U+FE00-U+FE0F)
    if (codepoint >= 0xFE00 && codepoint <= 0xFE0F) return true;
    // Byte order mark / Zero-width no-break space (U+FEFF)
    if (codepoint === 0xFEFF) return true;
    // Halfwidth Hangul filler (U+FFA0)
    if (codepoint === 0xFFA0) return true;
    // Shorthand format controls (U+1BCA0-U+1BCA3)
    if (codepoint >= 0x1BCA0 && codepoint <= 0x1BCA3) return true;
    // Musical symbol formatting (U+1D173-U+1D17A)
    if (codepoint >= 0x1D173 && codepoint <= 0x1D17A) return true;
    // Language tag (U+E0001)
    if (codepoint === 0xE0001) return true;
    // Tag characters (U+E0020-U+E007F)
    if (codepoint >= 0xE0020 && codepoint <= 0xE007F) return true;
    // Variation selectors supplement (U+E0100-U+E01EF)
    if (codepoint >= 0xE0100 && codepoint <= 0xE01EF) return true;
    return false;
  }

  /**
   * Convert a single GhosttyCell to TerminalCell
   */
  private convertCell(cell: GhosttyCell): TerminalCell {
    // Zero-width characters render as space but preserve background color
    // Only strip foreground to prevent invisible colored text
    if (this.isZeroWidthChar(cell.codepoint)) {
      return {
        char: ' ',
        fg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b }, // fg = bg (invisible)
        bg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b },
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
    if (this.isSpaceLikeChar(cell.codepoint)) {
      return {
        char: ' ',
        fg: { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b },
        bg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b },
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
        fg: { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b },
        bg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b },
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
    if (this.isCjkIdeograph(cell.codepoint) && cell.width !== 2) {
      return {
        char: ' ',
        fg: { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b },
        bg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b },
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

    // For other invalid codepoints (null, control chars, etc.), preserve the cell's
    // colors but replace the character with a space. This keeps htop-style colored
    // backgrounds working while filtering out unprintable glyphs.
    let char = ' ';
    if (!isInvisible && this.isValidCodepoint(cell.codepoint)) {
      try {
        char = String.fromCodePoint(cell.codepoint);
      } catch {
        // Fallback to space if fromCodePoint fails
        char = ' ';
      }
    }

    return {
      char,
      fg: { r: cell.fg_r, g: cell.fg_g, b: cell.fg_b },
      bg: { r: cell.bg_r, g: cell.bg_g, b: cell.bg_b },
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
   * Create an empty cell using the terminal's color scheme (cached)
   */
  private createEmptyCell(): TerminalCell {
    if (this.cachedEmptyCell) {
      return this.cachedEmptyCell;
    }
    const fg = extractRgb(this.colors.foreground);
    const bg = extractRgb(this.colors.background);

    this.cachedEmptyCell = {
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
    return this.cachedEmptyCell;
  }

  /**
   * Subscribe to terminal state changes
   */
  subscribe(callback: (state: TerminalState) => void): () => void {
    this.subscribers.add(callback);
    // Immediately call with current state
    callback(this.getTerminalState());

    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(): void {
    const state = this.getTerminalState();
    for (const callback of this.subscribers) {
      callback(state);
    }
  }

  /**
   * Free resources
   */
  dispose(): void {
    this.subscribers.clear();
    this.terminal.free();
  }
}
