/**
 * ITerminalEmulator - Interface for terminal emulator implementations
 *
 * This interface abstracts terminal emulation so the PTY layer doesn't
 * care about the backend (native libghostty-vt, shim client, etc.).
 */

import type {
  TerminalCell,
  TerminalState,
  TerminalScrollState,
  DirtyTerminalUpdate,
} from '../core/types';
import type { TerminalColors } from './terminal-colors';

/**
 * Terminal emulator interface - implemented by native and remote emulators.
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
   * Update terminal pixel dimensions (used for kitty graphics sizing).
   */
  setPixelSize?(widthPx: number, heightPx: number): void;

  /**
   * Reset the emulator to a clean state (for pool reuse).
   * Clears all state but keeps the underlying resources alive.
   */
  reset(): void;

  /**
   * Free all resources. After this, the emulator should not be used.
   */
  dispose(): void;

  /**
   * Get the total number of lines in the scrollback buffer
   */
  getScrollbackLength(): number;

  /**
   * Virtually trim the newest N scrollback lines without physically removing
   * pages. Used after pi full redraws to prevent duplicate content from
   * LF-triggered scrolls appearing in scrollback.
   */
  eraseScrollbackTail?(lines: number): void;

  /**
   * Get a line from the scrollback buffer
   * @param offset Line offset from top of scrollback (0 = oldest line)
   * @returns Array of cells, or null if not available
   */
  getScrollbackLine(offset: number): TerminalCell[] | null;

  /**
   * Prefetch a range of scrollback lines into any internal cache.
   * Optional because local emulators may already have synchronous access.
   */
  prefetchScrollbackLines?(startOffset: number, count: number): Promise<void>;

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
   * Get active Kitty keyboard protocol flags for input encoding.
   */
  getKittyKeyboardFlags(): number;

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

  /**
   * Get the terminal's color scheme
   */
  getColors(): TerminalColors;

  /**
   * Update the terminal's color scheme (best-effort).
   */
  setColors?(colors: TerminalColors): void;

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
   * This is essential for async emulators where write() doesn't block.
   * @returns Unsubscribe function
   */
  onUpdate(callback: () => void): () => void;

  /**
   * Enable or disable update notifications (used to gate hidden panes).
   */
  setUpdateEnabled?(enabled: boolean): void;

  /**
   * Force a refresh of cached state and notify subscribers.
   * Used after operations that change terminal dimensions but may have been
   * missed by subscribers due to visibility races.
   */
  refresh?(): void;

  /**
   * Subscribe to terminal mode changes (DECSET/DECRST)
   * Callback receives new modes and optionally previous modes for transition detection.
   * @returns Unsubscribe function
   */
  onModeChange(callback: (modes: TerminalModes, prevModes?: TerminalModes) => void): () => void;

  /**
   * Drain pending terminal responses (e.g., Kitty graphics query replies).
   * Returns an array of response strings to write back to the PTY.
   */
  drainResponses?(): string[];

  /**
   * Search for text in terminal (scrollback + visible area)
   * Returns matches sorted from oldest to newest
   * @param query Search string
   * @param options.limit Maximum number of matches to return (default: 500)
   */
  search(query: string, options?: { limit?: number }): Promise<SearchResult>;
}

/**
 * Optional Kitty graphics extension implemented by emulators that expose
 * image metadata, pixel payloads, and placement state.
 */
export interface IKittyGraphicsEmulator {
  /** Check if kitty images/placements changed since last clear. */
  getKittyImagesDirty(): boolean;

  /** Clear kitty images/placements dirty flag. */
  clearKittyImagesDirty(): void;

  /** Get list of kitty image IDs. */
  getKittyImageIds(): number[];

  /** Get kitty image metadata by ID. */
  getKittyImageInfo(imageId: number): KittyGraphicsImageInfo | null;

  /** Get kitty image data by ID. */
  getKittyImageData(imageId: number): Uint8Array | null;

  /**
   * Whether renderer should seed host image bytes for a broker-mapped image.
   * Used by shim emulators to request explicit fallback seeding on selected updates.
   */
  shouldSeedKittyImage?(imageId: number): boolean;

  /** Get kitty placements for the active screen. */
  getKittyPlacements(): KittyGraphicsPlacement[];
}

export type KittyGraphicsEmulator = ITerminalEmulator & IKittyGraphicsEmulator;

export function isKittyGraphicsEmulator(
  emulator: ITerminalEmulator | null | undefined
): emulator is KittyGraphicsEmulator {
  const candidate = emulator as Partial<IKittyGraphicsEmulator> | null | undefined;
  return Boolean(
    emulator &&
    typeof candidate?.getKittyImagesDirty === 'function' &&
    typeof candidate?.clearKittyImagesDirty === 'function' &&
    typeof candidate?.getKittyImageIds === 'function' &&
    typeof candidate?.getKittyImageInfo === 'function' &&
    typeof candidate?.getKittyImageData === 'function' &&
    typeof candidate?.getKittyPlacements === 'function'
  );
}

/**
 * Terminal modes that need to be communicated from emulator to UI
 */
export interface TerminalModes {
  mouseTracking: boolean;
  cursorKeyMode: 'normal' | 'application';
  alternateScreen: boolean;
  /** DECSET 2048 - in-band resize notifications (used by neovim) */
  inBandResize: boolean;
}

export const enum KittyGraphicsFormat {
  RGB = 0,
  RGBA = 1,
  PNG = 2,
  GRAY_ALPHA = 3,
  GRAY = 4,
}

export const enum KittyGraphicsCompression {
  NONE = 0,
  ZLIB_DEFLATE = 1,
}

export const enum KittyGraphicsPlacementTag {
  INTERNAL = 0,
  EXTERNAL = 1,
}

export interface KittyGraphicsImageInfo {
  id: number;
  number: number;
  width: number;
  height: number;
  dataLength: number;
  format: KittyGraphicsFormat;
  compression: KittyGraphicsCompression;
  implicitId: boolean;
  transmitTime: bigint;
}

export interface KittyGraphicsPlacement {
  imageId: number;
  placementId: number;
  placementTag: KittyGraphicsPlacementTag;
  screenX: number;
  screenY: number;
  xOffset: number;
  yOffset: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  columns: number;
  rows: number;
  z: number;
}

/**
 * Serialized dirty update for transport
 * Uses ArrayBuffer for efficient transfer via Transferable
 */
export interface SerializedDirtyUpdate {
  /** Which rows changed (indices) */
  dirtyRowIndices: Uint16Array;
  /** Packed cell data for dirty rows (Transferable) */
  dirtyRowData: ArrayBuffer;
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
  /** Kitty keyboard protocol flags (bitset). */
  kittyKeyboardFlags?: number;
  /** DECSET 2048 - in-band resize notifications */
  inBandResize: boolean;
}

/**
 * Search match result
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
