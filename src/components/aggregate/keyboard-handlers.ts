/**
 * Keyboard handlers for AggregateView
 * Handles keyboard input for list mode, preview mode, and search mode
 */

import { writeToPty } from '../../effect/bridge';
import { inputHandler } from '../../terminal/input-handler';

export interface KeyboardEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  sequence?: string;
}

export interface AggregateKeyboardDeps {
  // State getters
  getShowAggregateView: () => boolean;
  getPreviewMode: () => boolean;
  getSelectedPtyId: () => string | null;
  getFilterQuery: () => string;
  getSearchState: () => { query: string } | null;
  getInSearchMode: () => boolean;
  getPrefixActive: () => boolean;

  // State setters
  setFilterQuery: (query: string) => void;
  setInSearchMode: (value: boolean) => void;
  setPrefixActive: (value: boolean) => void;

  // Aggregate view actions
  closeAggregateView: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  enterPreviewMode: () => void;
  exitPreviewMode: () => void;

  // Keyboard context actions
  exitAggregateMode: () => void;

  // Search actions
  exitSearchMode: (cancel: boolean) => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  handleEnterSearch: () => Promise<void>;

  // Navigation
  handleJumpToPty: () => Promise<boolean>;

  // External actions
  onRequestQuit?: () => void;
  onRequestKillPty?: (ptyId: string) => void;

  // Prefix timeout management
  clearPrefixTimeout: () => void;
  startPrefixTimeout: () => void;
}

/**
 * Creates keyboard handler for AggregateView
 */
export function createAggregateKeyboardHandler(deps: AggregateKeyboardDeps) {
  const {
    getShowAggregateView,
    getPreviewMode,
    getSelectedPtyId,
    getFilterQuery,
    getSearchState,
    getInSearchMode,
    getPrefixActive,
    setFilterQuery,
    setInSearchMode,
    setPrefixActive,
    closeAggregateView,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
    exitAggregateMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    handleEnterSearch,
    handleJumpToPty,
    onRequestQuit,
    onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
  } = deps;

  /**
   * Handle search mode keyboard input
   * Returns true if key was handled
   */
  const handleSearchModeKeys = (event: KeyboardEvent, normalizedKey: string): boolean => {
    if (normalizedKey === 'escape') {
      // Cancel search, restore original scroll position
      exitSearchMode(true);
      setInSearchMode(false);
      return true;
    }

    if (normalizedKey === 'return' || normalizedKey === 'enter') {
      // Confirm search, stay at current position
      exitSearchMode(false);
      setInSearchMode(false);
      return true;
    }

    // Wait for searchState to be initialized before handling navigation/input
    const currentSearchState = getSearchState();
    if (!currentSearchState) {
      return true;
    }

    if (normalizedKey === 'n' && event.ctrl && !event.shift && !event.alt) {
      // Next match (Ctrl+n)
      nextMatch();
      return true;
    }

    if ((normalizedKey === 'n' && event.ctrl && event.shift) || (normalizedKey === 'p' && event.ctrl)) {
      // Previous match (Ctrl+Shift+N or Ctrl+p)
      prevMatch();
      return true;
    }

    if (normalizedKey === 'backspace') {
      // Delete last character from query
      setSearchQuery(currentSearchState.query.slice(0, -1));
      return true;
    }

    // Single printable character - add to search query
    const searchCharCode = event.sequence?.charCodeAt(0) ?? 0;
    const isPrintable = event.sequence?.length === 1 && searchCharCode >= 32 && searchCharCode < 127;
    if (isPrintable && !event.ctrl && !event.alt) {
      setSearchQuery(currentSearchState.query + event.sequence);
      return true;
    }

    // Consume all other keys in search mode
    return true;
  };

  /**
   * Handle preview mode keyboard input
   * Returns true if key was handled
   */
  const handlePreviewModeKeys = (event: KeyboardEvent, normalizedKey: string): boolean => {
    const { key } = event;

    // Alt+F to enter search mode
    if (event.alt && normalizedKey === 'f') {
      handleEnterSearch();
      return true;
    }

    // Alt+Escape or Prefix+Escape exits preview mode back to list
    if (event.alt && normalizedKey === 'escape') {
      exitPreviewMode();
      return true;
    }

    if (getPrefixActive() && normalizedKey === 'escape') {
      setPrefixActive(false);
      clearPrefixTimeout();
      exitPreviewMode();
      return true;
    }

    // Prefix+/ to enter search mode (vim-style)
    if (getPrefixActive() && key === '/') {
      setPrefixActive(false);
      clearPrefixTimeout();
      handleEnterSearch();
      return true;
    }

    // Clear prefix mode on any other key after prefix
    if (getPrefixActive()) {
      setPrefixActive(false);
      clearPrefixTimeout();
    }

    // Forward key to PTY using inputHandler for proper encoding
    const selectedPtyId = getSelectedPtyId();
    if (selectedPtyId) {
      const inputStr = inputHandler.encodeKey({
        key,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      });
      if (inputStr) {
        writeToPty(selectedPtyId, inputStr);
      }
    }
    return true;
  };

  /**
   * Handle list mode keyboard input
   * Returns true if key was handled
   */
  const handleListModeKeys = (event: KeyboardEvent, normalizedKey: string): boolean => {
    const { key } = event;

    // Alt+Esc closes aggregate view
    if (event.alt && normalizedKey === 'escape') {
      closeAggregateView();
      exitAggregateMode();
      return true;
    }

    if (normalizedKey === 'down' || (normalizedKey === 'j' && !event.ctrl)) {
      navigateDown();
      return true;
    }

    if (normalizedKey === 'up' || (normalizedKey === 'k' && !event.ctrl)) {
      navigateUp();
      return true;
    }

    if (normalizedKey === 'return' || normalizedKey === 'enter') {
      // Enter preview mode (interactive terminal)
      if (getSelectedPtyId()) {
        enterPreviewMode();
      }
      return true;
    }

    // Tab jumps to the PTY's workspace/pane
    if (normalizedKey === 'tab') {
      handleJumpToPty();
      return true;
    }

    if (normalizedKey === 'backspace') {
      setFilterQuery(getFilterQuery().slice(0, -1));
      return true;
    }

    // Single printable character - add to filter
    if (key.length === 1 && !event.ctrl && !event.alt) {
      setFilterQuery(getFilterQuery() + key);
      return true;
    }

    return true; // Consume all keys while in aggregate view
  };

  /**
   * Main keyboard handler for AggregateView
   */
  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (!getShowAggregateView()) return false;

    const { key } = event;
    const normalizedKey = key.toLowerCase();

    // Handle search mode first (when active in preview)
    if (getInSearchMode() && getPreviewMode()) {
      return handleSearchModeKeys(event, normalizedKey);
    }

    // Global Alt+X to kill selected PTY (works in both list and preview mode)
    if (event.alt && normalizedKey === 'x') {
      const selectedPtyId = getSelectedPtyId();
      if (selectedPtyId && onRequestKillPty) {
        onRequestKillPty(selectedPtyId);
      }
      return true;
    }

    // Global prefix key handling (Ctrl+B) - works in both list and preview mode
    if (event.ctrl && normalizedKey === 'b') {
      setPrefixActive(true);
      clearPrefixTimeout();
      startPrefixTimeout();
      return true;
    }

    // Global prefix commands (work in both list and preview mode)
    if (getPrefixActive()) {
      // Prefix+q to quit the app (show confirmation modal)
      if (normalizedKey === 'q') {
        setPrefixActive(false);
        clearPrefixTimeout();
        if (onRequestQuit) {
          onRequestQuit();
        }
        return true;
      }
    }

    // In preview mode, most keys go to the PTY
    if (getPreviewMode()) {
      return handlePreviewModeKeys(event, normalizedKey);
    }

    // List mode keyboard handling
    return handleListModeKeys(event, normalizedKey);
  };

  return {
    handleKeyDown,
    handleSearchModeKeys,
    handlePreviewModeKeys,
    handleListModeKeys,
  };
}
