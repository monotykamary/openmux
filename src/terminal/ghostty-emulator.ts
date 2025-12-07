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

    // Configure ghostty-web with queried colors
    this.terminal = ghostty.createTerminal(cols, rows, {
      scrollbackLimit: 10000,
      bgColor: this.colors.background,
      fgColor: this.colors.foreground,
      palette: this.colors.palette,
    });

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
      mouseTracking: false,
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
        // Update cells in place
        for (let x = 0; x < Math.min(line.length, this._cols); x++) {
          const cell = this.convertCell(line[x]);
          row[x] = cell;
        }
        // Fill remaining cells with empty if line is shorter than cols
        for (let x = line.length; x < this._cols; x++) {
          row[x] = this.createEmptyCell();
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
   * Convert a single GhosttyCell to TerminalCell
   */
  private convertCell(cell: GhosttyCell): TerminalCell {
    // Filter out null (0) and replacement character (0xFFFD) which shows as diamond question mark
    const char = (cell.codepoint > 0 && cell.codepoint !== 0xFFFD)
      ? String.fromCodePoint(cell.codepoint)
      : ' ';
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
