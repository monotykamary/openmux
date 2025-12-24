/**
 * GhosttyVTEmulator - ITerminalEmulator implementation backed by native libghostty-vt.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from "../../core/types";
import type { ITerminalEmulator, SearchMatch, SearchResult, TerminalModes } from "../emulator-interface";
import type { TerminalColors } from "../terminal-colors";
import { createTitleParser } from "../title-parser";
import { stripProblematicOscSequences } from "./osc-stripping";
import { GhosttyVtTerminal } from "./terminal";
import { DirtyState } from "./types";
import { convertLine, createEmptyRow } from "../ghostty-emulator/cell-converter";
import {
  ScrollbackCache,
  shouldClearCacheOnUpdate,
  createDefaultModes,
  createDefaultScrollState,
  createEmptyTerminalState,
  createEmptyDirtyUpdate,
} from "../emulator-utils";
import { extractLineText, getModes } from "./utils";

const SCROLLBACK_LIMIT = 2000;

export class GhosttyVTEmulator implements ITerminalEmulator {
  private terminal: GhosttyVtTerminal;
  private _cols: number;
  private _rows: number;
  private _disposed = false;
  private colors: TerminalColors;
  private modes: TerminalModes = createDefaultModes();
  private scrollState: TerminalScrollState = createDefaultScrollState();

  private cachedState: TerminalState | null = null;
  private pendingUpdate: DirtyTerminalUpdate | null = null;

  private titleParser: ReturnType<typeof createTitleParser>;
  private currentTitle = "";
  private titleCallbacks = new Set<(title: string) => void>();
  private updateCallbacks = new Set<() => void>();
  private modeChangeCallbacks = new Set<(modes: TerminalModes, prevModes?: TerminalModes) => void>();

  private scrollbackCache = new ScrollbackCache(1000);
  private decoder = new TextDecoder();

  constructor(cols: number, rows: number, colors: TerminalColors) {
    this._cols = cols;
    this._rows = rows;
    this.colors = colors;

    const palette = colors.palette.slice(0, 16);
    this.terminal = new GhosttyVtTerminal(cols, rows, {
      scrollbackLimit: SCROLLBACK_LIMIT,
      fgColor: colors.foreground,
      bgColor: colors.background,
      palette,
    });

    this.titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        this.currentTitle = title;
        for (const callback of this.titleCallbacks) {
          callback(title);
        }
      },
    });

    // Clear terminal state to avoid stale memory artifacts.
    this.terminal.write("\x1b[2J\x1b[H");
    this.terminal.update();
    this.terminal.markClean();

    this.modes = getModes(this.terminal);
    this.prepareUpdate(true);
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  write(data: string | Uint8Array): void {
    if (this._disposed) return;

    const text = typeof data === "string" ? data : this.decoder.decode(data);
    if (text.length === 0) return;

    this.titleParser.processData(text);
    const stripped = stripProblematicOscSequences(text);
    if (stripped.length > 0) {
      this.terminal.write(stripped);
    }

    this.prepareUpdate(false);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  resize(cols: number, rows: number): void {
    if (this._disposed) return;
    if (cols === this._cols && rows === this._rows) return;

    this._cols = cols;
    this._rows = rows;
    this.terminal.resize(cols, rows);
    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  reset(): void {
    if (this._disposed) return;
    this.terminal.write("\x1bc");
    this.currentTitle = "";
    this.scrollbackCache.clear();
    this.prepareUpdate(true);
    for (const callback of this.updateCallbacks) {
      callback();
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.terminal.free();

    this.cachedState = null;
    this.pendingUpdate = null;
    this.titleCallbacks.clear();
    this.updateCallbacks.clear();
    this.modeChangeCallbacks.clear();
    this.scrollbackCache.clear();
  }

  // ==========================================================================
  // State access
  // ==========================================================================

  getScrollbackLength(): number {
    return this.scrollState.scrollbackLength;
  }

  getScrollbackLine(offset: number): TerminalCell[] | null {
    return this.scrollbackCache.get(offset);
  }

  async prefetchScrollbackLines(startOffset: number, count: number): Promise<void> {
    this.terminal.update();
    const lines = new Map<number, TerminalCell[]>();
    for (let i = 0; i < count; i++) {
      const offset = startOffset + i;
      const cached = this.scrollbackCache.get(offset);
      if (cached) {
        lines.set(offset, cached);
        continue;
      }
      const line = this.terminal.getScrollbackLine(offset);
      if (!line) break;
      lines.set(offset, convertLine(line, this._cols, this.colors));
    }
    this.scrollbackCache.setMany(lines);
  }

  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
    this.scrollState = scrollState;

    if (this.pendingUpdate) {
      const mergedScrollState: TerminalScrollState = {
        ...scrollState,
        isAtScrollbackLimit: this.pendingUpdate.scrollState.isAtScrollbackLimit,
      };
      const update = {
        ...this.pendingUpdate,
        scrollState: mergedScrollState,
      };
      this.pendingUpdate = null;
      return update;
    }

    return createEmptyDirtyUpdate(
      this._cols,
      this._rows,
      scrollState,
      this.modes,
      this.cachedState?.cursor
    );
  }

  getTerminalState(): TerminalState {
    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    this.prepareUpdate(true);
    if (this.cachedState) {
      return { ...(this.cachedState as TerminalState) };
    }

    return createEmptyTerminalState(this._cols, this._rows, this.colors, this.modes);
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    if (this.cachedState?.cursor) {
      return {
        x: this.cachedState.cursor.x,
        y: this.cachedState.cursor.y,
        visible: this.cachedState.cursor.visible,
      };
    }
    this.terminal.update();
    return this.terminal.getCursor();
  }

  getCursorKeyMode(): "normal" | "application" {
    return this.modes.cursorKeyMode;
  }

  isMouseTrackingEnabled(): boolean {
    return this.modes.mouseTracking;
  }

  isAlternateScreen(): boolean {
    return this.modes.alternateScreen;
  }

  getMode(mode: number): boolean {
    return this.terminal.getMode(mode, false);
  }

  getColors(): TerminalColors {
    return this.colors;
  }

  getTitle(): string {
    return this.currentTitle;
  }

  onTitleChange(callback: (title: string) => void): () => void {
    this.titleCallbacks.add(callback);
    if (this.currentTitle) {
      callback(this.currentTitle);
    }
    return () => {
      this.titleCallbacks.delete(callback);
    };
  }

  onUpdate(callback: () => void): () => void {
    this.updateCallbacks.add(callback);
    if (this.pendingUpdate) {
      callback();
    }
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void {
    this.modeChangeCallbacks.add(callback);
    return () => {
      this.modeChangeCallbacks.delete(callback);
    };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  async search(query: string, options?: { limit?: number }): Promise<SearchResult> {
    const limit = options?.limit ?? 500;
    const matches: SearchMatch[] = [];
    let hasMore = false;

    if (!query) {
      return { matches, hasMore };
    }

    const lowerQuery = query.toLowerCase();
    const scrollbackLength = this.terminal.getScrollbackLength();

    for (let offset = 0; offset < scrollbackLength; offset++) {
      if (matches.length >= limit) {
        hasMore = true;
        break;
      }

      const cells = this.fetchScrollbackLine(offset);
      if (!cells) continue;

      const text = extractLineText(cells).toLowerCase();
      let pos = 0;
      while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
        if (matches.length >= limit) {
          hasMore = true;
          break;
        }
        matches.push({
          lineIndex: offset,
          startCol: pos,
          endCol: pos + query.length,
        });
        pos += 1;
      }
    }

    if (!hasMore) {
      const state = this.getTerminalState();
      for (let y = 0; y < state.rows; y++) {
        const line = state.cells[y] ?? createEmptyRow(state.cols, this.colors);
        const text = extractLineText(line).toLowerCase();
        let pos = 0;
        while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
          matches.push({
            lineIndex: scrollbackLength + y,
            startCol: pos,
            endCol: pos + query.length,
          });
          pos += 1;
        }
      }
    }

    return { matches, hasMore };
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private fetchScrollbackLine(offset: number): TerminalCell[] | null {
    const cached = this.scrollbackCache.get(offset);
    if (cached) return cached;

    this.terminal.update();
    const line = this.terminal.getScrollbackLine(offset);
    if (!line) return null;

    const converted = convertLine(line, this._cols, this.colors);
    this.scrollbackCache.set(offset, converted);
    return converted;
  }

  private prepareUpdate(forceFull: boolean): void {
    const dirtyState = this.terminal.update();
    const cursor = this.terminal.getCursor();
    const scrollbackLength = this.terminal.getScrollbackLength();
    const isAtScrollbackLimit = scrollbackLength >= SCROLLBACK_LIMIT;
    const prevModes = this.modes;
    const newModes = getModes(this.terminal);

    const updateScrollState: TerminalScrollState = {
      viewportOffset: 0,
      scrollbackLength,
      isAtBottom: true,
      isAtScrollbackLimit,
    };

    const shouldBuildFull = forceFull || dirtyState === DirtyState.FULL || !this.cachedState;
    const viewport = shouldBuildFull || dirtyState !== DirtyState.NONE
      ? this.terminal.getViewport()
      : null;

    let dirtyRows = new Map<number, TerminalCell[]>();
    let fullState: TerminalState | undefined;

    if (shouldBuildFull) {
      const cells: TerminalCell[][] = [];
      if (viewport) {
        for (let y = 0; y < this._rows; y++) {
          const start = y * this._cols;
          const line = viewport.slice(start, start + this._cols);
          cells.push(convertLine(line, this._cols, this.colors));
        }
      }

      fullState = {
        cols: this._cols,
        rows: this._rows,
        cells,
        cursor: {
          x: cursor.x,
          y: cursor.y,
          visible: cursor.visible,
          style: "block",
        },
        alternateScreen: newModes.alternateScreen,
        mouseTracking: newModes.mouseTracking,
        cursorKeyMode: newModes.cursorKeyMode,
      };
      this.cachedState = fullState;
    } else if (viewport) {
      for (let y = 0; y < this._rows; y++) {
        if (!this.terminal.isRowDirty(y)) continue;
        const start = y * this._cols;
        const line = viewport.slice(start, start + this._cols);
        dirtyRows.set(y, convertLine(line, this._cols, this.colors));
      }

      if (this.cachedState) {
        for (const [rowIdx, cells] of dirtyRows) {
          this.cachedState.cells[rowIdx] = cells;
        }
        this.cachedState.cursor = {
          x: cursor.x,
          y: cursor.y,
          visible: cursor.visible,
          style: "block",
        };
        this.cachedState.alternateScreen = newModes.alternateScreen;
        this.cachedState.mouseTracking = newModes.mouseTracking;
        this.cachedState.cursorKeyMode = newModes.cursorKeyMode;
      }
    } else if (this.cachedState) {
      this.cachedState.cursor = {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: "block",
      };
      this.cachedState.alternateScreen = newModes.alternateScreen;
      this.cachedState.mouseTracking = newModes.mouseTracking;
      this.cachedState.cursorKeyMode = newModes.cursorKeyMode;
    }

    const update: DirtyTerminalUpdate = {
      dirtyRows,
      cursor: {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: "block",
      },
      scrollState: updateScrollState,
      cols: this._cols,
      rows: this._rows,
      isFull: shouldBuildFull,
      fullState,
      alternateScreen: newModes.alternateScreen,
      mouseTracking: newModes.mouseTracking,
      cursorKeyMode: newModes.cursorKeyMode,
      inBandResize: newModes.inBandResize,
    };

    this.scrollState = {
      ...this.scrollState,
      scrollbackLength,
    };

    this.scrollbackCache.handleScrollbackChange(scrollbackLength, isAtScrollbackLimit);
    const shouldClearCache = shouldClearCacheOnUpdate(update, prevModes);
    if (shouldClearCache) {
      this.scrollbackCache.clear();
    }

    if (
      prevModes.mouseTracking !== newModes.mouseTracking ||
      prevModes.cursorKeyMode !== newModes.cursorKeyMode ||
      prevModes.alternateScreen !== newModes.alternateScreen ||
      prevModes.inBandResize !== newModes.inBandResize
    ) {
      this.modes = newModes;
      for (const callback of this.modeChangeCallbacks) {
        callback(newModes, prevModes);
      }
    } else {
      this.modes = newModes;
    }

    this.pendingUpdate = update;
    this.terminal.markClean();
  }
}

export function createGhosttyVTEmulator(
  cols: number,
  rows: number,
  colors: TerminalColors
): GhosttyVTEmulator {
  return new GhosttyVTEmulator(cols, rows, colors);
}
