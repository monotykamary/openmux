/**
 * GhosttyEmulator - Terminal emulator using ghostty-web's WASM VT parser
 */

import { Ghostty, GhosttyTerminal, CellFlags, type GhosttyCell, type Cursor } from 'ghostty-web';
import type { TerminalState, TerminalCell, TerminalCursor, DirtyTerminalUpdate, TerminalScrollState } from '../core/types';
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
  // Scrollback line cache - avoids re-converting cells on each scroll
  private scrollbackCache: Map<number, TerminalCell[]> = new Map();
  // LRU tracking for scrollback cache (stores insertion order)
  private scrollbackCacheOrder: number[] = [];
  private static readonly SCROLLBACK_CACHE_MAX = 1000;
  private static readonly SCROLLBACK_CACHE_TRIM = 500;

  // Structural sharing: stable row references for efficient React updates
  private stableRows: TerminalCell[][] = [];
  // Track last dimensions for detecting resize (triggers full refresh)
  private lastCols: number = 0;
  private lastRows: number = 0;
  // Track last alternate screen state (triggers full refresh on switch)
  private lastAlternateScreen: boolean = false;

  constructor(options: GhosttyEmulatorOptions = {}) {
    const { cols = 80, rows = 24, colors } = options;
    const ghostty = getGhostty();
    this._cols = cols;
    this._rows = rows;
    this.colors = colors ?? getDefaultColors();

    // Configure ghostty-web with colors
    // Always pass the palette to ensure consistent 256-color rendering
    // The xterm-256color palette is standardized, so even default colors should be passed
    const config = {
      scrollbackLimit: 10000,
      bgColor: this.colors.background,
      fgColor: this.colors.foreground,
      palette: this.colors.palette,
    };

    this.terminal = ghostty.createTerminal(cols, rows, config);

    // Initialize cached cells
    this.initializeCachedCells();

    // Initialize structural sharing tracking
    this.lastCols = cols;
    this.lastRows = rows;
    this.lastAlternateScreen = false;
    this.stableRows = [...this.cachedCells];
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
   * Note: Does NOT notify subscribers - the caller (Pty service) is responsible
   * for calling getTerminalState() and notifying its own subscribers.
   * This prevents double-notification which would clear dirty flags prematurely.
   */
  write(data: string | Uint8Array): void {
    this.terminal.write(data);
    // LRU eviction for scrollback cache - only trim when exceeding max
    // This is more efficient than clearing all on every write
    this.trimScrollbackCache();
  }

  /**
   * Trim scrollback cache using LRU eviction when it exceeds max size
   */
  private trimScrollbackCache(): void {
    if (this.scrollbackCache.size > GhosttyEmulator.SCROLLBACK_CACHE_MAX) {
      // Remove oldest entries (first N entries in order array)
      const toRemove = this.scrollbackCache.size - GhosttyEmulator.SCROLLBACK_CACHE_TRIM;
      const keysToRemove = this.scrollbackCacheOrder.splice(0, toRemove);
      for (const key of keysToRemove) {
        this.scrollbackCache.delete(key);
      }
    }
  }

  /**
   * Resize terminal
   * Note: Does NOT notify subscribers - the caller (Pty service) is responsible
   * for notifying its own subscribers after resize.
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.terminal.resize(cols, rows);

    // Reinitialize cached cells for new dimensions
    this.initializeCachedCells();

    // Clear scrollback cache - resize may reflow lines
    this.scrollbackCache.clear();
    this.scrollbackCacheOrder = [];

    // Force full refresh after resize
    this.updateAllCells();

    // Update stableRows for structural sharing
    this.stableRows = [...this.cachedCells];
  }

  /**
   * Update all cells from terminal (used after resize or initial load)
   */
  private updateAllCells(): void {
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      const row = this.cachedCells[y] || [];
      const lineLength = line ? Math.min(line.length, this._cols) : 0;

      if (line) {
        for (let x = 0; x < lineLength; x++) {
          row[x] = this.convertCell(line[x]);
        }
      }

      // Fill remaining cells with last cell's background color (terminal EOL behavior)
      if (lineLength < this._cols) {
        const lastCell = line && lineLength > 0 ? line[lineLength - 1] : null;
        const fillBg = lastCell
          ? { r: lastCell.bg_r, g: lastCell.bg_g, b: lastCell.bg_b }
          : extractRgb(this.colors.background);
        const fillFg = lastCell
          ? { r: lastCell.fg_r, g: lastCell.fg_g, b: lastCell.fg_b }
          : extractRgb(this.colors.foreground);

        const fillCell: TerminalCell = {
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

        for (let x = lineLength; x < this._cols; x++) {
          row[x] = fillCell;
        }
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
    // Check cache first
    const cached = this.scrollbackCache.get(offset);
    if (cached) {
      return cached;
    }

    // Fetch from terminal and convert
    const line = this.terminal.getScrollbackLine(offset);
    if (!line) return null;

    const converted = line.map(cell => this.convertCell(cell));

    // Cache the converted line and track LRU order
    this.scrollbackCache.set(offset, converted);
    this.scrollbackCacheOrder.push(offset);

    return converted;
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
   * Get a DEC private mode state
   * @param mode The mode number (e.g., 1 for DECCKM, 25 for DECTCEM, etc.)
   * @returns true if set, false if reset
   */
  getMode(mode: number): boolean {
    return this.terminal.getMode(mode, false);
  }

  /**
   * Get terminal state in our format
   * Creates fresh cell arrays to ensure React detects changes properly
   */
  getTerminalState(): TerminalState {
    const cursor = this.getCursor();

    // Build fresh cells array from terminal state
    const cells: TerminalCell[][] = [];
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      const row: TerminalCell[] = [];
      const lineLength = line ? Math.min(line.length, this._cols) : 0;

      if (line) {
        for (let x = 0; x < lineLength; x++) {
          row.push(this.convertCell(line[x]));
        }
      }

      // Fill remaining cells with last cell's background color
      if (lineLength < this._cols) {
        const lastCell = line && lineLength > 0 ? line[lineLength - 1] : null;
        const fillBg = lastCell
          ? this.safeRgb(lastCell.bg_r, lastCell.bg_g, lastCell.bg_b)
          : extractRgb(this.colors.background);
        const fillFg = lastCell
          ? this.safeRgb(lastCell.fg_r, lastCell.fg_g, lastCell.fg_b)
          : extractRgb(this.colors.foreground);

        const fillCell: TerminalCell = {
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

        for (let x = lineLength; x < this._cols; x++) {
          row.push(fillCell);
        }
      }

      cells.push(row);
    }

    this.terminal.clearDirty();

    return {
      cols: this._cols,
      rows: this._rows,
      cells,
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
   * Get dirty terminal update with structural sharing.
   * This is the key optimization - only returns changed rows instead of full state.
   *
   * Returns isFull=true when:
   * - Terminal dimensions changed (resize)
   * - Alternate screen state changed (vim, htop, etc.)
   *
   * When isFull=false, only dirtyRows contains the changed rows.
   * Unchanged rows can be reused from previous state (structural sharing).
   */
  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    const cursor = this.getCursor();
    const alternateScreen = this.isAlternateScreen();
    const scrollbackLength = this.getScrollbackLength();

    // Detect if full refresh is needed
    const needsFullRefresh =
      this._cols !== this.lastCols ||
      this._rows !== this.lastRows ||
      alternateScreen !== this.lastAlternateScreen;

    // Update tracking state
    this.lastCols = this._cols;
    this.lastRows = this._rows;
    this.lastAlternateScreen = alternateScreen;

    const terminalCursor: TerminalCursor = {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block',
    };

    if (needsFullRefresh) {
      // Full refresh: rebuild all rows and return complete state
      this.rebuildAllStableRows();
      const fullState = this.getTerminalState();

      return {
        dirtyRows: new Map(), // Empty - use fullState instead
        cursor: terminalCursor,
        scrollState: {
          viewportOffset: scrollState.viewportOffset,
          scrollbackLength,
          isAtBottom: scrollState.isAtBottom,
        },
        cols: this._cols,
        rows: this._rows,
        isFull: true,
        fullState,
        alternateScreen,
        mouseTracking: this.isMouseTrackingEnabled(),
        cursorKeyMode: this.getCursorKeyMode(),
      };
    }

    // Delta update: get only dirty lines from ghostty
    const ghosttyDirty = this.terminal.getDirtyLines();
    const dirtyRows = new Map<number, TerminalCell[]>();

    for (const [y, line] of ghosttyDirty) {
      if (y >= 0 && y < this._rows) {
        // Convert line to TerminalCell array
        const newRow = this.convertLine(line);
        // Update stable row reference (structural sharing: new reference = changed)
        this.stableRows[y] = newRow;
        this.rowVersions[y]++;
        dirtyRows.set(y, newRow);
      }
    }

    this.globalVersion++;
    this.terminal.clearDirty();

    return {
      dirtyRows,
      cursor: terminalCursor,
      scrollState: {
        viewportOffset: scrollState.viewportOffset,
        scrollbackLength,
        isAtBottom: scrollState.isAtBottom,
      },
      cols: this._cols,
      rows: this._rows,
      isFull: false,
      alternateScreen,
      mouseTracking: this.isMouseTrackingEnabled(),
      cursorKeyMode: this.getCursorKeyMode(),
    };
  }

  /**
   * Rebuild all stable rows (used after resize or alternate screen switch)
   */
  private rebuildAllStableRows(): void {
    this.stableRows = [];
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      this.stableRows[y] = line ? this.convertLine(line) : this.createEmptyRow();
      this.rowVersions[y]++;
    }
    this.globalVersion++;
    this.terminal.clearDirty();
  }

  /**
   * Convert a GhosttyCell line to TerminalCell array with EOL fill
   */
  private convertLine(line: GhosttyCell[]): TerminalCell[] {
    const row: TerminalCell[] = [];
    const lineLength = Math.min(line.length, this._cols);

    for (let x = 0; x < lineLength; x++) {
      row.push(this.convertCell(line[x]));
    }

    // Fill remaining cells with last cell's background color (terminal EOL behavior)
    if (lineLength < this._cols) {
      const lastCell = lineLength > 0 ? line[lineLength - 1] : null;
      const fillBg = lastCell
        ? this.safeRgb(lastCell.bg_r, lastCell.bg_g, lastCell.bg_b)
        : extractRgb(this.colors.background);
      const fillFg = lastCell
        ? this.safeRgb(lastCell.fg_r, lastCell.fg_g, lastCell.fg_b)
        : extractRgb(this.colors.foreground);

      const fillCell: TerminalCell = {
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

      for (let x = lineLength; x < this._cols; x++) {
        row.push(fillCell);
      }
    }

    return row;
  }

  /**
   * Create an empty row using the terminal's default colors
   */
  private createEmptyRow(): TerminalCell[] {
    const row: TerminalCell[] = [];
    for (let x = 0; x < this._cols; x++) {
      row.push(this.createEmptyCell());
    }
    return row;
  }

  /**
   * Get stable row reference for structural sharing
   * Returns the row array that will maintain reference equality if unchanged
   */
  getStableRow(y: number): TerminalCell[] | null {
    return this.stableRows[y] ?? null;
  }

  /**
   * Get all stable rows for full state reconstruction
   */
  getStableRows(): TerminalCell[][] {
    return this.stableRows;
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

        // If the line is shorter than the viewport width, fill remaining cells
        // with spaces that inherit the last cell's background color.
        // This matches terminal behavior where background color extends to EOL.
        if (lineLength < this._cols) {
          const lastCell = lineLength > 0 ? line[lineLength - 1] : null;
          const fillBg = lastCell
            ? { r: lastCell.bg_r, g: lastCell.bg_g, b: lastCell.bg_b }
            : extractRgb(this.colors.background);
          const fillFg = lastCell
            ? { r: lastCell.fg_r, g: lastCell.fg_g, b: lastCell.fg_b }
            : extractRgb(this.colors.foreground);

          const fillCell: TerminalCell = {
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

          for (let x = lineLength; x < this._cols; x++) {
            row[x] = fillCell;
          }
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
    // Type safety: must be a finite positive integer
    if (typeof codepoint !== 'number' ||
        !Number.isFinite(codepoint) ||
        codepoint !== (codepoint | 0) ||  // Must be integer (32-bit)
        codepoint <= 0) {
      return false;
    }
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
   * Safely extract RGB values from a GhosttyCell, ensuring they are valid numbers
   */
  private safeRgb(r: number, g: number, b: number): { r: number; g: number; b: number } {
    return {
      r: typeof r === 'number' && !Number.isNaN(r) ? r : 0,
      g: typeof g === 'number' && !Number.isNaN(g) ? g : 0,
      b: typeof b === 'number' && !Number.isNaN(b) ? b : 0,
    };
  }

  /**
   * Convert a single GhosttyCell to TerminalCell
   */
  private convertCell(cell: GhosttyCell): TerminalCell {
    // Safely extract colors with validation
    const fg = this.safeRgb(cell.fg_r, cell.fg_g, cell.fg_b);
    const bg = this.safeRgb(cell.bg_r, cell.bg_g, cell.bg_b);

    // Zero-width characters render as space but preserve background color
    // Only strip foreground to prevent invisible colored text
    if (this.isZeroWidthChar(cell.codepoint)) {
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
    if (this.isSpaceLikeChar(cell.codepoint)) {
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
    if (this.isCjkIdeograph(cell.codepoint) && cell.width !== 2) {
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

    // For other invalid codepoints (null, control chars, etc.), preserve the cell's
    // colors but replace the character with a space. This keeps htop-style colored
    // backgrounds working while filtering out unprintable glyphs.
    let char = ' ';
    const cp = cell.codepoint;
    if (!isInvisible && typeof cp === 'number' && cp >= 0x20) {
      if (cp <= 0x7E) {
        // Printable ASCII
        char = String.fromCharCode(cp);
      } else if (cp >= 0xA0 && cp <= 0xD7FF) {
        // Latin-1 Supplement through pre-surrogate BMP
        char = String.fromCharCode(cp);
      } else if (cp >= 0xE000 && cp <= 0xFFFD && cp !== 0xFFFD) {
        // Private Use Area (nerd fonts) through end of BMP, excluding U+FFFD
        char = String.fromCharCode(cp);
      } else if (cp >= 0x10000 && cp <= 0xCFFFF) {
        // Planes 1-12 (skip Plane 13 - unassigned, ghostty-web returns garbage here)
        try {
          char = String.fromCodePoint(cp);
        } catch {
          char = ' ';
        }
      } else if (cp >= 0xE0000 && cp <= 0xEFFFF) {
        // Plane 14: SSP (tags, variation selectors supplement)
        try {
          char = String.fromCodePoint(cp);
        } catch {
          char = ' ';
        }
      } else if (cp >= 0xF0000 && cp <= 0xFFFFF) {
        // Plane 15: PUA-A (Supplementary Private Use Area A - file icons)
        try {
          char = String.fromCodePoint(cp);
        } catch {
          char = ' ';
        }
      }
      // Implicitly skip: DEL (0x7F), C1 controls (0x80-0x9F), surrogates (0xD800-0xDFFF),
      // replacement char (0xFFFD), non-characters, Plane 13 + Plane 16 (ghostty-web bug)
    }

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
