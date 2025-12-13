/**
 * SearchContext - manages terminal search state
 *
 * Provides vim-style search functionality with:
 * - Case-insensitive substring search
 * - Match highlighting (all matches + current match)
 * - Navigation between matches with auto-scroll
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TerminalCell, TerminalState } from '../core/types';
import { getEmulator, getTerminalState, getScrollState } from '../effect/bridge';
import type { GhosttyEmulator } from '../terminal/ghostty-emulator';
import { useTerminal } from './TerminalContext';

// =============================================================================
// Types
// =============================================================================

/**
 * A single search match in the terminal
 */
interface SearchMatch {
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
interface SearchState {
  /** Current search query */
  query: string;
  /** All matches found */
  matches: SearchMatch[];
  /** Index of currently highlighted match (-1 if no matches) */
  currentMatchIndex: number;
  /** The ptyId being searched */
  ptyId: string;
  /** Cached emulator for scrollback access */
  emulator: GhosttyEmulator | null;
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
interface SearchContextValue {
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
  /** Version counter for triggering re-renders */
  searchVersion: number;
}

// =============================================================================
// Context
// =============================================================================

const SearchContext = createContext<SearchContextValue | null>(null);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract text from a row of terminal cells
 */
function extractLineText(cells: TerminalCell[]): string {
  let text = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    text += cell.char;
    // Skip placeholder for wide characters
    if (cell.width === 2) {
      i++;
    }
  }
  return text;
}

/**
 * Perform case-insensitive search across scrollback and visible terminal
 */
function performSearch(
  query: string,
  emulator: GhosttyEmulator,
  terminalState: TerminalState
): SearchMatch[] {
  if (!query) return [];

  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();
  const scrollbackLength = emulator.getScrollbackLength();

  // Search scrollback lines (oldest to newest)
  for (let offset = 0; offset < scrollbackLength; offset++) {
    const cells = emulator.getScrollbackLine(offset);
    if (!cells) continue;

    const lineText = extractLineText(cells).toLowerCase();
    let searchPos = 0;

    while (true) {
      const matchStart = lineText.indexOf(lowerQuery, searchPos);
      if (matchStart === -1) break;

      matches.push({
        lineIndex: offset,
        startCol: matchStart,
        endCol: matchStart + query.length,
      });

      searchPos = matchStart + 1; // Find overlapping matches
    }
  }

  // Search visible terminal lines
  for (let row = 0; row < terminalState.rows; row++) {
    const cells = terminalState.cells[row];
    if (!cells) continue;

    const lineText = extractLineText(cells).toLowerCase();
    let searchPos = 0;

    while (true) {
      const matchStart = lineText.indexOf(lowerQuery, searchPos);
      if (matchStart === -1) break;

      matches.push({
        lineIndex: scrollbackLength + row,
        startCol: matchStart,
        endCol: matchStart + query.length,
      });

      searchPos = matchStart + 1;
    }
  }

  return matches;
}

/**
 * Check if a cell at (x, absoluteY) is within a match
 */
function isCellInMatch(
  x: number,
  absoluteY: number,
  match: SearchMatch
): boolean {
  return (
    absoluteY === match.lineIndex &&
    x >= match.startCol &&
    x < match.endCol
  );
}

/**
 * Height of search overlay (3 rows + 1 margin from bottom + 1 for status bar)
 * This is used to avoid centering matches behind the search bar
 */
const SEARCH_OVERLAY_HEIGHT = 5;

/**
 * Calculate viewport offset to show a specific line centered in viewport
 * Accounts for the search overlay at the bottom by centering in the visible area above it
 *
 * Coordinate system:
 * - lineIndex: absolute line index (0 = oldest scrollback, scrollbackLength = first visible terminal line)
 * - viewportOffset: how many lines scrolled back (0 = at bottom showing live terminal)
 * - Screen row y shows absoluteY = scrollbackLength - viewportOffset + y
 */
function calculateScrollOffset(
  lineIndex: number,
  scrollbackLength: number,
  terminalRows: number
): number {
  // Calculate effective viewport (excluding search overlay area)
  const effectiveRows = terminalRows - SEARCH_OVERLAY_HEIGHT;
  const centerPoint = Math.floor(effectiveRows / 2);

  // To show lineIndex at screen row centerPoint:
  // lineIndex = scrollbackLength - viewportOffset + centerPoint
  // viewportOffset = scrollbackLength - lineIndex + centerPoint
  const targetOffset = scrollbackLength - lineIndex + centerPoint;

  // Clamp to valid range [0, scrollbackLength]
  return Math.max(0, Math.min(targetOffset, scrollbackLength));
}

// =============================================================================
// Provider
// =============================================================================

interface SearchProviderProps {
  children: ReactNode;
}

export function SearchProvider({ children }: SearchProviderProps) {
  // Get setScrollOffset from TerminalContext (updates cache for immediate rendering)
  const { setScrollOffset } = useTerminal();

  // Store search state - use state so context consumers get updates
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  // Also keep a ref for synchronous access in render callbacks (isSearchMatch/isCurrentMatch)
  const searchStateRef = useRef<SearchState | null>(null);

  // Version counter to trigger re-renders when search state changes
  const [searchVersion, setSearchVersion] = useState(0);

  // Update both state and ref
  const updateSearchState = useCallback((newState: SearchState | null) => {
    searchStateRef.current = newState;
    setSearchState(newState);
    setSearchVersion((v) => v + 1);
  }, []);

  // Enter search mode
  const enterSearchMode = useCallback(async (ptyId: string) => {
    // Get emulator and terminal state
    const emulator = await getEmulator(ptyId);
    const terminalState = await getTerminalState(ptyId);
    const scrollState = await getScrollState(ptyId);

    if (!emulator || !terminalState) {
      return;
    }

    updateSearchState({
      query: '',
      matches: [],
      currentMatchIndex: -1,
      ptyId,
      emulator,
      terminalState,
      scrollbackLength: emulator.getScrollbackLength(),
      originalScrollOffset: scrollState?.viewportOffset ?? 0,
    });
  }, [updateSearchState]);

  // Exit search mode
  const exitSearchMode = useCallback((restorePosition = false) => {
    const state = searchStateRef.current;
    if (!state) return;

    // Restore original scroll position if requested (on Escape)
    if (restorePosition && state.originalScrollOffset !== undefined) {
      setScrollOffset(state.ptyId, state.originalScrollOffset);
    }

    updateSearchState(null);
  }, [updateSearchState]);

  // Update search query
  const setSearchQuery = useCallback((query: string) => {
    const state = searchStateRef.current;
    if (!state || !state.emulator || !state.terminalState) return;

    // Perform search
    const matches = performSearch(query, state.emulator, state.terminalState);

    // Start at the most recent match (last in array = closest to bottom of terminal)
    const initialIndex = matches.length > 0 ? matches.length - 1 : -1;

    // Update state
    const newState = {
      ...state,
      query,
      matches,
      currentMatchIndex: initialIndex,
    };
    updateSearchState(newState);

    // Auto-scroll to the initial match (most recent)
    if (matches.length > 0) {
      const match = matches[initialIndex];
      const offset = calculateScrollOffset(
        match.lineIndex,
        state.scrollbackLength,
        state.terminalState.rows
      );
      setScrollOffset(state.ptyId, offset);
    }
  }, [updateSearchState]);

  // Navigate to next match
  const nextMatch = useCallback(() => {
    const state = searchStateRef.current;
    if (!state || state.matches.length === 0 || !state.terminalState) return;

    const newIndex = (state.currentMatchIndex + 1) % state.matches.length;
    const match = state.matches[newIndex];

    updateSearchState({
      ...state,
      currentMatchIndex: newIndex,
    });

    // Scroll to show match
    const offset = calculateScrollOffset(
      match.lineIndex,
      state.scrollbackLength,
      state.terminalState.rows
    );
    setScrollOffset(state.ptyId, offset);
  }, [updateSearchState]);

  // Navigate to previous match
  const prevMatch = useCallback(() => {
    const state = searchStateRef.current;
    if (!state || state.matches.length === 0 || !state.terminalState) return;

    const newIndex = state.currentMatchIndex <= 0
      ? state.matches.length - 1
      : state.currentMatchIndex - 1;
    const match = state.matches[newIndex];

    updateSearchState({
      ...state,
      currentMatchIndex: newIndex,
    });

    // Scroll to show match
    const offset = calculateScrollOffset(
      match.lineIndex,
      state.scrollbackLength,
      state.terminalState.rows
    );
    setScrollOffset(state.ptyId, offset);
  }, [updateSearchState]);

  // Check if cell is any search match
  const isSearchMatch = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const state = searchStateRef.current;
      if (!state || state.ptyId !== ptyId || state.matches.length === 0) {
        return false;
      }

      // Check all matches
      for (const match of state.matches) {
        if (isCellInMatch(x, absoluteY, match)) {
          return true;
        }
      }
      return false;
    },
    []
  );

  // Check if cell is the current match
  const isCurrentMatch = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const state = searchStateRef.current;
      if (
        !state ||
        state.ptyId !== ptyId ||
        state.currentMatchIndex < 0 ||
        state.currentMatchIndex >= state.matches.length
      ) {
        return false;
      }

      const currentMatch = state.matches[state.currentMatchIndex];
      return isCellInMatch(x, absoluteY, currentMatch);
    },
    []
  );

  const value: SearchContextValue = {
    searchState,
    enterSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    isSearchMatch,
    isCurrentMatch,
    searchVersion,
  };

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useSearch(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
