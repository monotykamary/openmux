/**
 * SearchContext - manages terminal search state
 *
 * Provides vim-style search functionality with:
 * - Case-insensitive substring search
 * - Match highlighting (all matches + current match)
 * - Navigation between matches with auto-scroll
 */

import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { getEmulator, getTerminalState, getScrollState } from '../effect/bridge';
import { useTerminal } from './TerminalContext';

// Import extracted search utilities
import type { SearchState, SearchContextValue } from './search/types';
import {
  isCellInMatch,
  calculateScrollOffset,
  buildMatchLookup,
} from './search/helpers';

// =============================================================================
// Context
// =============================================================================

const SearchContext = createContext<SearchContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SearchProviderProps extends ParentProps {}

// Search debounce delay in ms
const SEARCH_DEBOUNCE_MS = 150;

export function SearchProvider(props: SearchProviderProps) {
  // Get setScrollOffset from TerminalContext (updates cache for immediate rendering)
  const { setScrollOffset } = useTerminal();

  // Store search state - Solid signals are synchronous, so no need for separate ref
  const [searchState, setSearchState] = createSignal<SearchState | null>(null);

  // Version counter to trigger re-renders when search state changes
  const [searchVersion, setSearchVersion] = createSignal(0);

  // Debounce timer for search
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Pending query for debounced search
  let pendingQuery = '';

  // Spatial index for O(1) match lookup by line
  // Map<lineIndex, Array<{startCol, endCol}>>
  let matchLookup = new Map<number, Array<{ startCol: number; endCol: number }>>();

  // Cleanup on unmount
  onCleanup(() => {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
  });

  // Update state and rebuild spatial index
  const updateSearchState = (newState: SearchState | null) => {
    setSearchState(newState);
    setSearchVersion((v) => v + 1);

    // Rebuild spatial index for fast lookup using extracted helper
    matchLookup = newState?.matches
      ? buildMatchLookup(newState.matches)
      : new Map();
  };

  // Enter search mode
  const enterSearchMode = async (ptyId: string) => {
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
      hasMore: false,
      currentMatchIndex: -1,
      ptyId,
      emulator,
      terminalState,
      scrollbackLength: emulator.getScrollbackLength(),
      originalScrollOffset: scrollState?.viewportOffset ?? 0,
    });
  };

  // Exit search mode
  const exitSearchMode = (restorePosition = false) => {
    const state = searchState();
    if (!state) return;

    // Clear any pending debounced search
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    // Restore original scroll position if requested (on Escape)
    if (restorePosition && state.originalScrollOffset !== undefined) {
      setScrollOffset(state.ptyId, state.originalScrollOffset);
    }

    updateSearchState(null);
  };

  // Update search query (debounced)
  const setSearchQuery = (query: string) => {
    const state = searchState();
    if (!state || !state.emulator || !state.terminalState) return;

    pendingQuery = query;

    // Clear existing debounce timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    // Update query immediately for display (show typing instantly)
    updateSearchState({
      ...state,
      query,
      // Keep previous matches while debouncing (reduces flicker)
    });

    // Debounce the actual search
    searchDebounceTimer = setTimeout(async () => {
      const currentState = searchState();
      if (!currentState || !currentState.emulator || !currentState.terminalState) return;
      if (pendingQuery !== query) return; // Query changed, skip

      // Perform search via emulator (async - may run in worker)
      const { matches, hasMore } = await currentState.emulator.search(query);

      // Check again after async search in case state changed
      if (pendingQuery !== query) return;

      // Start at the most recent match (last in array = closest to bottom of terminal)
      const initialIndex = matches.length > 0 ? matches.length - 1 : -1;

      // Update state with matches
      updateSearchState({
        ...currentState,
        query,
        matches,
        hasMore,
        currentMatchIndex: initialIndex,
      });

      // Auto-scroll to the initial match (most recent)
      if (matches.length > 0) {
        const match = matches[initialIndex];
        const offset = calculateScrollOffset(
          match.lineIndex,
          currentState.scrollbackLength,
          currentState.terminalState.rows
        );
        setScrollOffset(currentState.ptyId, offset);
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  // Navigate to next match
  const nextMatch = () => {
    const state = searchState();
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
  };

  // Navigate to previous match
  const prevMatch = () => {
    const state = searchState();
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
  };

  // Check if cell is any search match (optimized with spatial index)
  // Note: In Solid, this is synchronous - no stale closure issues
  const isSearchMatch = (ptyId: string, x: number, absoluteY: number): boolean => {
    const state = searchState();
    if (!state || state.ptyId !== ptyId) {
      return false;
    }

    // O(1) lookup by line using spatial index
    const lineMatches = matchLookup.get(absoluteY);
    if (!lineMatches) return false;

    // Check matches on this line (usually very few per line)
    for (const { startCol, endCol } of lineMatches) {
      if (x >= startCol && x < endCol) return true;
    }
    return false;
  };

  // Check if cell is the current match
  const isCurrentMatch = (ptyId: string, x: number, absoluteY: number): boolean => {
    const state = searchState();
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
  };

  const getSearchMatchRanges = (
    ptyId: string,
    absoluteY: number
  ): Array<{ startCol: number; endCol: number }> | null => {
    const state = searchState();
    if (!state || state.ptyId !== ptyId) {
      return null;
    }
    return matchLookup.get(absoluteY) ?? null;
  };

  const value: SearchContextValue = {
    get searchState() { return searchState(); },
    enterSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    isSearchMatch,
    isCurrentMatch,
    getSearchMatchRanges,
    get searchVersion() { return searchVersion(); },
  };

  return (
    <SearchContext.Provider value={value}>
      {props.children}
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
