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
        let lastCell: TerminalCell | null = null;

        // Update cells in place
        for (let x = 0; x < lineLength; x++) {
          const cell = this.convertCell(line[x]);
          row[x] = cell;
          lastCell = cell;
        }

        // If the line is shorter than the viewport width, fill the remainder
        // using the last cell's style so background colors (e.g., htop headers)
        // continue across the row.
        const fillCell =
          lastCell ??
          this.createEmptyCell(); // lineLength could be 0 on a cleared line
        for (let x = lineLength; x < this._cols; x++) {
          row[x] = {
            ...fillCell,
            char: ' ',
          };
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
   * Check if a codepoint is a zero-width character that should use default colors
   * These are invisible modifiers that can carry stale color information
   */
  private isZeroWidthChar(codepoint: number): boolean {
    // Zero-width space (U+200B)
    if (codepoint === 0x200B) return true;
    // Zero-width non-joiner (U+200C)
    if (codepoint === 0x200C) return true;
    // Zero-width joiner (U+200D)
    if (codepoint === 0x200D) return true;
    // Left-to-right mark (U+200E)
    if (codepoint === 0x200E) return true;
    // Right-to-left mark (U+200F)
    if (codepoint === 0x200F) return true;
    // Word joiner (U+2060)
    if (codepoint === 0x2060) return true;
    // Byte order mark / Zero-width no-break space (U+FEFF)
    if (codepoint === 0xFEFF) return true;
    // Variation selectors (U+FE00-U+FE0F)
    if (codepoint >= 0xFE00 && codepoint <= 0xFE0F) return true;
    return false;
  }

  /**
   * Convert a single GhosttyCell to TerminalCell
   */
  private convertCell(cell: GhosttyCell): TerminalCell {
    // Zero-width characters should use default colors to prevent color artifacts
    // These are invisible modifiers that shouldn't carry styling
    if (this.isZeroWidthChar(cell.codepoint)) {
      return this.createEmptyCell();
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
   * Create an empty cell using the terminal's color scheme
   */
  private createEmptyCell(): TerminalCell {
    const fg = extractRgb(this.colors.foreground);
    const bg = extractRgb(this.colors.background);

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
