/**
 * ITerminalEmulator - Interface for terminal emulator implementations
 *
 * This interface abstracts terminal emulation to support both:
 * - Main thread emulation (GhosttyEmulator)
 * - Worker-based emulation (WorkerEmulator)
 *
 * The abstraction enables moving VT parsing to Web Workers while keeping
 * the rest of the codebase unchanged.
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
  PackedRowUpdate,
} from '../core/types';
import type { TerminalColors } from './terminal-colors';

/**
 * Terminal emulator interface - implemented by both GhosttyEmulator and WorkerEmulator
 */
export interface ITerminalEmulator {
  /** Current terminal width in columns */
  readonly cols: number;

  /** Current terminal height in rows */
  readonly rows: number;

  /** Whether the emulator has been disposed */
  readonly isDisposed: boolean;

  /**
   * Write data to terminal (parses VT sequences).
   * Does NOT notify subscribers - caller is responsible for that.
   */
  write(data: string | Uint8Array): void;

  /**
   * Resize terminal dimensions.
   * Does NOT notify subscribers - caller is responsible for that.
   */
  resize(cols: number, rows: number): void;

  /**
   * Reset the emulator to a clean state (for pool reuse).
   * Clears all state but keeps the underlying resources alive.
   */
  reset(): void;

  /**
   * Free all resources. After this, the emulator should not be used.
   */
  dispose(): void;

  // ============================================================================
  // State Access
  // ============================================================================

  /**
   * Get the total number of lines in the scrollback buffer
   */
  getScrollbackLength(): number;

  /**
   * Get a line from the scrollback buffer
   * @param offset Line offset from top of scrollback (0 = oldest line)
   * @returns Array of cells, or null if not available
   */
  getScrollbackLine(offset: number): TerminalCell[] | null;

  /**
   * Get dirty terminal update with structural sharing.
   * Returns only changed rows instead of full state (key optimization).
   */
  getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate;

  /**
   * Get full terminal state.
   * Creates fresh cell arrays to ensure React detects changes properly.
   */
  getTerminalState(): TerminalState;

  // ============================================================================
  // Mode Queries
  // ============================================================================

  /**
   * Get cursor position and visibility
   */
  getCursor(): { x: number; y: number; visible: boolean };

  /**
   * Get cursor key mode (DECCKM - DEC mode 1)
   * When 'application', arrow keys send \x1bOx instead of \x1b[x
   */
  getCursorKeyMode(): 'normal' | 'application';

  /**
   * Check if mouse tracking is enabled by the terminal application
   */
  isMouseTrackingEnabled(): boolean;

  /**
   * Check if in alternate screen buffer
   */
  isAlternateScreen(): boolean;

  /**
   * Get a DEC private mode state
   */
  getMode(mode: number): boolean;

  // ============================================================================
  // Colors
  // ============================================================================

  /**
   * Get the terminal's color scheme
   */
  getColors(): TerminalColors;

  // ============================================================================
  // Title
  // ============================================================================

  /**
   * Get the current terminal title (set via OSC sequences)
   */
  getTitle(): string;

  /**
   * Subscribe to terminal title changes
   * @returns Unsubscribe function
   */
  onTitleChange(callback: (title: string) => void): () => void;

  /**
   * Subscribe to terminal state updates (fires when write() completes processing)
   * This is essential for async emulators (workers) where write() doesn't block.
   * @returns Unsubscribe function
   */
  onUpdate(callback: () => void): () => void;

  /**
   * Subscribe to terminal mode changes (DECSET/DECRST)
   * Callback receives new modes and optionally previous modes for transition detection.
   * @returns Unsubscribe function
   */
  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void;

  // ============================================================================
  // Search
  // ============================================================================

  /**
   * Search for text in terminal (scrollback + visible area)
   * Returns matches sorted from oldest to newest
   * @param query Search string
   * @param options.limit Maximum number of matches to return (default: 500)
   */
  search(query: string, options?: { limit?: number }): Promise<SearchResult>;
}

/**
 * Terminal modes that need to be communicated from worker to main thread
 */
export interface TerminalModes {
  mouseTracking: boolean;
  cursorKeyMode: 'normal' | 'application';
  alternateScreen: boolean;
  /** DECSET 2048 - in-band resize notifications (used by neovim) */
  inBandResize: boolean;
}

/**
 * Serialized dirty update for worker communication
 * Uses ArrayBuffer for efficient transfer via Transferable
 */
export interface SerializedDirtyUpdate {
  /** Which rows changed (indices) */
  dirtyRowIndices: Uint16Array;
  /** Packed cell data for dirty rows (Transferable) */
  dirtyRowData: ArrayBuffer;
  /** Packed row data for fast rendering (worker-emulator only) */
  packedRows?: PackedRowUpdate;
  /** Cursor position */
  cursor: { x: number; y: number; visible: boolean };
  /** Terminal dimensions */
  cols: number;
  rows: number;
  /** Scrollback buffer length */
  scrollbackLength: number;
  /** Whether this is a full refresh */
  isFull: boolean;
  /** Full state data when isFull=true */
  fullStateData?: ArrayBuffer;
  /** Terminal modes */
  alternateScreen: boolean;
  mouseTracking: boolean;
  /** 0 = normal, 1 = application */
  cursorKeyMode: 0 | 1;
  /** DECSET 2048 - in-band resize notifications */
  inBandResize: boolean;
}

// ============================================================================
// Worker Message Types
// ============================================================================

/**
 * Messages sent from main thread to worker
 */
export type WorkerInbound =
  | { type: 'init'; sessionId: string; cols: number; rows: number; colors: WorkerTerminalColors }
  | { type: 'write'; sessionId: string; data: ArrayBuffer }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'reset'; sessionId: string }
  | { type: 'getScrollbackLine'; sessionId: string; offset: number; requestId: number }
  | { type: 'getScrollbackLines'; sessionId: string; startOffset: number; count: number; requestId: number }
  | { type: 'getTerminalState'; sessionId: string; requestId: number }
  | { type: 'search'; sessionId: string; query: string; requestId: number; limit?: number }
  | { type: 'destroy'; sessionId: string };

/**
 * Messages sent from worker to main thread
 */
export type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'initialized'; sessionId: string }
  | { type: 'update'; sessionId: string; update: SerializedDirtyUpdate }
  | { type: 'titleChange'; sessionId: string; title: string }
  | { type: 'modeChange'; sessionId: string; modes: TerminalModes }
  | { type: 'scrollbackLine'; requestId: number; packedRows: PackedRowUpdate | null }
  | { type: 'scrollbackLines'; requestId: number; packedRows: PackedRowUpdate | null }
  | { type: 'terminalState'; requestId: number; state: ArrayBuffer }
  | { type: 'searchResults'; requestId: number; matches: SearchMatch[]; hasMore: boolean }
  | { type: 'destroyed'; sessionId: string }
  | { type: 'error'; sessionId?: string; requestId?: number; message: string };

/**
 * Terminal colors for worker initialization
 */
export interface WorkerTerminalColors {
  foreground: { r: number; g: number; b: number };
  background: { r: number; g: number; b: number };
  palette: Array<{ r: number; g: number; b: number }>;
}

/**
 * Search match result from worker
 */
export interface SearchMatch {
  /** Line index (0 = first scrollback line, scrollbackLength = first visible line) */
  lineIndex: number;
  /** Column where match starts */
  startCol: number;
  /** Column where match ends (exclusive) */
  endCol: number;
}

/**
 * Search result with pagination info
 */
export interface SearchResult {
  /** Matches found (up to limit) */
  matches: SearchMatch[];
  /** Whether more matches exist beyond the limit */
  hasMore: boolean;
}
