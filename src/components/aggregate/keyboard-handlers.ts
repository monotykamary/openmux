/**
 * Keyboard handlers for AggregateView
 * Handles keyboard input for list mode, preview mode, and search mode
 */

import { writeToPty } from '../../effect/bridge';
import { inputHandler } from '../../terminal/input-handler';
import { eventToCombo, matchKeybinding, type ResolvedKeybindings } from '../../core/keybindings';

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
  getKeybindings: () => ResolvedKeybindings;

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
  onDetach?: () => void;
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
    getKeybindings,
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
    onDetach,
    onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
  } = deps;

  /**
   * Handle search mode keyboard input
   * Returns true if key was handled
   */
  const handleSearchModeKeys = (event: KeyboardEvent): boolean => {
    const keybindings = getKeybindings();
    const action = matchKeybinding(keybindings.aggregate.search, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    if (action === 'aggregate.search.cancel') {
      exitSearchMode(true);
      setInSearchMode(false);
      return true;
    }

    if (action === 'aggregate.search.confirm') {
      exitSearchMode(false);
      setInSearchMode(false);
      return true;
    }

    // Wait for searchState to be initialized before handling navigation/input
    const currentSearchState = getSearchState();
    if (!currentSearchState) {
      return true;
    }

    if (action === 'aggregate.search.next') {
      nextMatch();
      return true;
    }

    if (action === 'aggregate.search.prev') {
      prevMatch();
      return true;
    }

    if (action === 'aggregate.search.delete') {
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
  const handlePreviewModeKeys = (event: KeyboardEvent): boolean => {
    const { key } = event;
    const keybindings = getKeybindings();
    const action = matchKeybinding(keybindings.aggregate.preview, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    // Search mode
    if (action === 'aggregate.preview.search') {
      handleEnterSearch();
      return true;
    }

    if (action === 'aggregate.preview.exit') {
      exitPreviewMode();
      return true;
    }

    if (action === 'aggregate.kill') {
      const selectedPtyId = getSelectedPtyId();
      if (selectedPtyId && onRequestKillPty) {
        onRequestKillPty(selectedPtyId);
      }
      return true;
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
  const handleListModeKeys = (event: KeyboardEvent): boolean => {
    const { key } = event;
    const keybindings = getKeybindings();
    const action = matchKeybinding(keybindings.aggregate.list, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    if (action === 'aggregate.list.down') {
      navigateDown();
      return true;
    }

    if (action === 'aggregate.list.up') {
      navigateUp();
      return true;
    }

    if (action === 'aggregate.list.preview') {
      if (getSelectedPtyId()) {
        enterPreviewMode();
      }
      return true;
    }

    if (action === 'aggregate.list.jump') {
      handleJumpToPty();
      return true;
    }

    if (action === 'aggregate.list.delete') {
      setFilterQuery(getFilterQuery().slice(0, -1));
      return true;
    }

    if (action === 'aggregate.list.close') {
      closeAggregateView();
      exitAggregateMode();
      return true;
    }

    if (action === 'aggregate.kill') {
      const selectedPtyId = getSelectedPtyId();
      if (selectedPtyId && onRequestKillPty) {
        onRequestKillPty(selectedPtyId);
      }
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
    const keybindings = getKeybindings();
    const combo = eventToCombo({
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    // Handle search mode first (when active in preview)
    if (getInSearchMode() && getPreviewMode()) {
      return handleSearchModeKeys(event);
    }

    // Global prefix key handling (works in both list and preview mode)
    if (combo === keybindings.prefixKey) {
      setPrefixActive(true);
      clearPrefixTimeout();
      startPrefixTimeout();
      return true;
    }

    // Prefix commands (work in both list and preview mode)
    if (getPrefixActive()) {
      const prefixAction = matchKeybinding(keybindings.aggregate.prefix, {
        key: event.key,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      });

      if (prefixAction) {
        setPrefixActive(false);
        clearPrefixTimeout();
      }

      switch (prefixAction) {
        case 'aggregate.prefix.quit':
          onRequestQuit?.();
          return true;
        case 'aggregate.prefix.detach':
          onDetach?.();
          return true;
        case 'aggregate.prefix.exit':
          if (getPreviewMode()) {
            exitPreviewMode();
          } else {
            closeAggregateView();
            exitAggregateMode();
          }
          return true;
        case 'aggregate.prefix.search':
          if (getPreviewMode()) {
            handleEnterSearch();
          }
          return true;
        default:
          if (prefixAction) {
            return true;
          }
          setPrefixActive(false);
          clearPrefixTimeout();
      }
    }

    // In preview mode, most keys go to the PTY
    if (getPreviewMode()) {
      return handlePreviewModeKeys(event);
    }

    // List mode keyboard handling
    return handleListModeKeys(event);
  };

  return {
    handleKeyDown,
    handleSearchModeKeys,
    handlePreviewModeKeys,
    handleListModeKeys,
  };
}
