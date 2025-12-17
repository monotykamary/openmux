/**
 * GhosttyEmulator - Terminal emulator using ghostty-web's WASM VT parser
 *
 * This module provides a wrapper around GhosttyTerminal for use with our PTY manager.
 * It handles:
 * - Terminal state management and cell conversion
 * - Dirty line tracking for efficient updates
 * - Scrollback buffer with LRU caching
 * - Structural sharing for React performance
 */

import { Ghostty, GhosttyTerminal, type GhosttyCell, type Cursor } from 'ghostty-web';
import type { TerminalState, TerminalCell, TerminalCursor, DirtyTerminalUpdate, TerminalScrollState } from '../core/types';
import { getDefaultColors, type TerminalColors } from './terminal-colors';
import type { ITerminalEmulator, SearchMatch } from './emulator-interface';

// Import extracted utilities
import { convertCell, convertLine, createEmptyCell, createEmptyRow, createFillCell, safeRgb } from './ghostty-emulator/cell-converter';
import { ScrollbackCache } from './ghostty-emulator/scrollback-cache';
import { RowVersionTracker } from './ghostty-emulator/structural-sharing';
import { createTitleParser } from './title-parser';

/**
 * Options for creating a GhosttyEmulator
 */
export interface GhosttyEmulatorOptions {
  cols?: number;
  rows?: number;
  colors?: TerminalColors;
}

// Module-level singleton for ghostty WASM instance
let ghosttyInstance: Ghostty | null = null;

/**
 * Initialize ghostty WASM module (call once at startup)
 */
export async function initGhostty(): Promise<Ghostty> {
  if (ghosttyInstance) {
    return ghosttyInstance;
  }
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
 * GhosttyEmulator wraps GhosttyTerminal for use with our PTY manager.
 * Optimized with dirty line tracking to minimize allocations.
 *
 * Implements ITerminalEmulator interface to support both main thread
 * and worker-based terminal emulation.
 */
export class GhosttyEmulator implements ITerminalEmulator {
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
  private versionTracker: RowVersionTracker;

  // Cached empty cell to avoid repeated allocation
  private cachedEmptyCell: TerminalCell | null = null;

  // Scrollback line cache - avoids re-converting cells on each scroll
  private scrollbackCache: ScrollbackCache;

  // Structural sharing: stable row references for efficient React updates
  private stableRows: TerminalCell[][] = [];

  // Track last dimensions for detecting resize (triggers full refresh)
  private lastCols: number = 0;
  private lastRows: number = 0;

  // Track last alternate screen state (triggers full refresh on switch)
  private lastAlternateScreen: boolean = false;

  // Track if emulator has been disposed (prevents WASM errors)
  private _disposed: boolean = false;

  // Terminal title (set via OSC sequences)
  private currentTitle: string = '';
  private titleChangeCallbacks: Set<(title: string) => void> = new Set();
  private titleParser: ReturnType<typeof createTitleParser>;

  // Update callbacks (fires after write() completes)
  private updateCallbacks: Set<() => void> = new Set();

  constructor(options: GhosttyEmulatorOptions = {}) {
    const { cols = 80, rows = 24, colors } = options;
    const ghostty = getGhostty();
    this._cols = cols;
    this._rows = rows;
    this.colors = colors ?? getDefaultColors();

    // Initialize tracking utilities
    this.versionTracker = new RowVersionTracker(rows);
    this.scrollbackCache = new ScrollbackCache({ maxSize: 1000, trimSize: 500 });

    // Configure ghostty-web with colors
    const config = {
      scrollbackLimit: 10000,
      bgColor: this.colors.background,
      fgColor: this.colors.foreground,
      palette: this.colors.palette,
    };

    this.terminal = ghostty.createTerminal(cols, rows, config);

    // Create title parser to detect OSC title sequences
    this.titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        this.currentTitle = title;
        for (const callback of this.titleChangeCallbacks) {
          callback(title);
        }
      },
    });

    // Initialize cached cells
    this.initializeCachedCells();

    // Initialize structural sharing tracking
    this.lastCols = cols;
    this.lastRows = rows;
    this.lastAlternateScreen = false;
    this.stableRows = [...this.cachedCells];
  }

  /**
   * Initialize the cached cells array with empty cells.
   * Uses optimized array creation to avoid O(n²) object allocation.
   */
  private initializeCachedCells(): void {
    const emptyCell = this.getEmptyCell();
    // Create all rows at once using Array.from with fill
    // Each row is a new array reference, cells share the same empty cell reference
    // This is much faster than nested loops with individual push operations
    this.cachedCells = Array.from({ length: this._rows }, () =>
      Array(this._cols).fill(emptyCell)
    );
    this.cellsInitialized = true;
  }

  /**
   * Get a cached empty cell (avoids repeated allocation)
   */
  private getEmptyCell(): TerminalCell {
    if (!this.cachedEmptyCell) {
      this.cachedEmptyCell = createEmptyCell(this.colors);
    }
    return this.cachedEmptyCell;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  /**
   * Check if the emulator has been disposed
   */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Get the terminal's color scheme
   */
  getColors(): TerminalColors {
    return this.colors;
  }

  /**
   * Write data to terminal (parses VT sequences).
   * Calls onUpdate callbacks after processing completes.
   */
  write(data: string | Uint8Array): void {
    // Guard against writes after disposal (prevents WASM out-of-bounds errors)
    if (this._disposed) return;

    // Parse data for title changes (OSC sequences)
    // Convert to string if needed for title parsing
    const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.titleParser.processData(dataStr);

    this.terminal.write(data);
    this.scrollbackCache.trim();

    // Notify update subscribers
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  /**
   * Resize terminal.
   * Note: Does NOT notify subscribers - the caller (Pty service) is responsible
   * for notifying its own subscribers after resize.
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.terminal.resize(cols, rows);

    // Reinitialize cached cells for new dimensions
    this.versionTracker.resize(rows);
    this.initializeCachedCells();

    // Clear scrollback cache - resize may reflow lines
    this.scrollbackCache.clear();

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
      this.cachedCells[y] = line
        ? convertLine(line, this._cols, this.colors)
        : createEmptyRow(this._cols, this.colors);
      this.versionTracker.incrementVersion(y);
    }
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

    // Fetch from terminal and convert with proper EOL padding
    const line = this.terminal.getScrollbackLine(offset);
    if (!line) return null;

    // Use convertLine to properly pad with EOL fill cells
    const converted = convertLine(line, this._cols, this.colors);

    // Cache the converted line
    this.scrollbackCache.set(offset, converted);

    return converted;
  }

  /**
   * Get cursor key mode (DECCKM - DEC mode 1)
   * When enabled, arrow keys should send application sequences (\x1bOx instead of \x1b[x)
   */
  getCursorKeyMode(): 'normal' | 'application' {
    return this.terminal.getMode(1, false) ? 'application' : 'normal';
  }

  /**
   * Check if mouse tracking is enabled by the application running in the terminal
   */
  isMouseTrackingEnabled(): boolean {
    const mode1000 = this.terminal.getMode(1000, false);
    const mode1002 = this.terminal.getMode(1002, false);
    const mode1003 = this.terminal.getMode(1003, false);
    return mode1000 || mode1002 || mode1003;
  }

  /**
   * Get the current terminal title (set via OSC sequences)
   */
  getTitle(): string {
    return this.currentTitle;
  }

  /**
   * Subscribe to terminal title changes
   * @returns Unsubscribe function
   */
  onTitleChange(callback: (title: string) => void): () => void {
    this.titleChangeCallbacks.add(callback);
    // Immediately call with current title if set
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleChangeCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to terminal state updates
   * @returns Unsubscribe function
   */
  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  /**
   * Get a DEC private mode state
   */
  getMode(mode: number): boolean {
    return this.terminal.getMode(mode, false);
  }

  /**
   * Get terminal state in our format.
   * Creates fresh cell arrays to ensure React detects changes properly.
   */
  getTerminalState(): TerminalState {
    const cursor = this.getCursor();

    // Build fresh cells array from terminal state
    const cells: TerminalCell[][] = [];
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      cells.push(line ? convertLine(line, this._cols, this.colors) : createEmptyRow(this._cols, this.colors));
    }

    this.terminal.clearDirty();

    return {
      cols: this._cols,
      rows: this._rows,
      cells,
      rowVersions: this.versionTracker.getAllVersions(),
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
        dirtyRows: new Map(),
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
        inBandResize: this.getMode(2048),
      };
    }

    // Delta update: get only dirty lines from ghostty
    const ghosttyDirty = this.terminal.getDirtyLines();
    const dirtyRows = new Map<number, TerminalCell[]>();

    for (const [y, line] of ghosttyDirty) {
      if (y >= 0 && y < this._rows) {
        const newRow = convertLine(line, this._cols, this.colors);
        this.stableRows[y] = newRow;
        this.versionTracker.incrementVersion(y);
        dirtyRows.set(y, newRow);
      }
    }

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
      inBandResize: this.getMode(2048),
    };
  }

  /**
   * Rebuild all stable rows (used after resize or alternate screen switch)
   */
  private rebuildAllStableRows(): void {
    this.stableRows = [];
    for (let y = 0; y < this._rows; y++) {
      const line = this.terminal.getLine(y);
      this.stableRows[y] = line
        ? convertLine(line, this._cols, this.colors)
        : createEmptyRow(this._cols, this.colors);
      this.versionTracker.incrementVersion(y);
    }
    this.terminal.clearDirty();
  }

  /**
   * Get stable row reference for structural sharing
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
   * Subscribe to terminal state changes
   */
  subscribe(callback: (state: TerminalState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.getTerminalState());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Reset the emulator to a clean state for pool reuse.
   * This clears all state but keeps the WASM terminal alive.
   */
  reset(): void {
    if (this._disposed) return;

    // Send reset sequence to clear terminal state
    // ESC c = Full Reset (RIS)
    this.terminal.write('\x1bc');

    // Clear title
    this.currentTitle = '';

    // Clear scrollback cache
    this.scrollbackCache.clear();

    // Reset version tracking
    this.versionTracker.reset();

    // Reinitialize cached cells
    this.initializeCachedCells();

    // Reset stableRows
    this.stableRows = [...this.cachedCells];

    // Reset tracking state
    this.lastCols = this._cols;
    this.lastRows = this._rows;
    this.lastAlternateScreen = false;

    // Clear dirty state
    this.terminal.clearDirty();
  }

  /**
   * Search for text in terminal (scrollback + visible area)
   * Implements ITerminalEmulator.search() for main-thread emulation
   */
  async search(query: string): Promise<SearchMatch[]> {
    if (!query) return [];

    const matches: SearchMatch[] = [];
    const lowerQuery = query.toLowerCase();
    const scrollbackLength = this.getScrollbackLength();

    // Search scrollback lines (oldest to newest)
    for (let offset = 0; offset < scrollbackLength; offset++) {
      const cells = this.getScrollbackLine(offset);
      if (!cells) continue;

      const lineText = this.extractLineText(cells).toLowerCase();
      let searchPos = 0;
      while ((searchPos = lineText.indexOf(lowerQuery, searchPos)) !== -1) {
        matches.push({
          lineIndex: offset,
          startCol: searchPos,
          endCol: searchPos + query.length,
        });
        searchPos += 1; // Move past this match to find overlapping matches
      }
    }

    // Search visible lines
    for (let y = 0; y < this._rows; y++) {
      const cells = this.stableRows[y];
      if (!cells) continue;

      const lineText = this.extractLineText(cells).toLowerCase();
      let searchPos = 0;
      while ((searchPos = lineText.indexOf(lowerQuery, searchPos)) !== -1) {
        matches.push({
          lineIndex: scrollbackLength + y,
          startCol: searchPos,
          endCol: searchPos + query.length,
        });
        searchPos += 1;
      }
    }

    return matches;
  }

  /**
   * Extract text from a row of terminal cells
   */
  private extractLineText(cells: TerminalCell[]): string {
    const chars: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      chars.push(cells[i].char);
      // Skip placeholder for wide characters
      if (cells[i].width === 2) {
        i++;
      }
    }
    return chars.join('');
  }

  /**
   * Free resources
   */
  dispose(): void {
    this._disposed = true;
    this.subscribers.clear();
    this.titleChangeCallbacks.clear();
    this.updateCallbacks.clear();
    this.terminal.free();
  }
}
