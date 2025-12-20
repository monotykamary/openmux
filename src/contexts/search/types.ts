/**
 * Search context types
 */
import type { TerminalState } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';

/**
 * A single search match in the terminal
 */
export interface SearchMatch {
  /** Absolute line index (0 = oldest scrollback line) */
  lineIndex: number;
  /** Starting column of match */
  startCol: number;
  /** Ending column of match (exclusive) */
  endCol: number;
}

/**
 * Search state
 */
export interface SearchState {
  /** Current search query */
  query: string;
  /** All matches found (up to limit) */
  matches: SearchMatch[];
  /** Whether more matches exist beyond the limit */
  hasMore: boolean;
  /** Index of currently highlighted match (-1 if no matches) */
  currentMatchIndex: number;
  /** The ptyId being searched */
  ptyId: string;
  /** Cached emulator for scrollback access */
  emulator: ITerminalEmulator | null;
  /** Cached terminal state */
  terminalState: TerminalState | null;
  /** Total scrollback length at search time */
  scrollbackLength: number;
  /** Original scroll offset before search started (to restore on cancel) */
  originalScrollOffset: number;
}

/**
 * Search context value
 */
export interface SearchContextValue {
  /** Current search state (null if not searching) */
  searchState: SearchState | null;
  /** Enter search mode for a pane */
  enterSearchMode: (ptyId: string) => Promise<void>;
  /** Exit search mode */
  exitSearchMode: (restorePosition?: boolean) => void;
  /** Update search query (triggers re-search) */
  setSearchQuery: (query: string) => void;
  /** Navigate to next match */
  nextMatch: () => void;
  /** Navigate to previous match */
  prevMatch: () => void;
  /** Check if a cell is any search match */
  isSearchMatch: (ptyId: string, x: number, absoluteY: number) => boolean;
  /** Check if a cell is the current match */
  isCurrentMatch: (ptyId: string, x: number, absoluteY: number) => boolean;
  /** Get all match ranges for a line (null if none) */
  getSearchMatchRanges: (
    ptyId: string,
    absoluteY: number
  ) => Array<{ startCol: number; endCol: number }> | null;
  /** Version counter for triggering re-renders */
  searchVersion: number;
}
