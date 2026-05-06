/**
 * AggregateKeyboardController - Handles all keyboard input for AggregateView
 * Encapsulates vim mode, prefix keys, search mode, copy mode, and navigation.
 *
 * Calls contexts directly; only receives truly external callbacks as props.
 * Returns its public API for use by AggregateView's rendering logic.
 */

import { createEffect, createSignal, onCleanup } from 'solid-js';
import { useAggregateView } from '../../../contexts/AggregateViewContext';
import { useKeyboard } from '../../../contexts/KeyboardContext';
import { useSearch } from '../../../contexts/SearchContext';
import { useConfig } from '../../../contexts/ConfigContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTerminal } from '../../../contexts/TerminalContext';
import { useCopyMode } from '../../../contexts/copy-mode';
import { useSelection } from '../../../contexts/SelectionContext';
import { useLayout } from '../../../contexts/LayoutContext';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { VimInputMode } from '../../../core/vim-sequences';
import { useOverlayKeyboardHandler } from '../../../contexts/keyboard/use-overlay-keyboard-handler';
import { useVimMode, useAggregatePreviewSupport } from '../hooks';
import { createCopyModeKeyHandler } from '../../app/copy-mode-keyboard';
import { createCopyModeVimState } from '../../app/copy-mode-vim';
import { createAggregateKeyboardHandler } from '../keyboard-handlers';
import type { AggregateKeyboardDeps } from '../keyboard/types';

/** Truly external callbacks only — things the parent must provide */
export interface AggregateKeyboardControllerProps {
  isActive: () => boolean;
  onRequestQuit?: () => void;
  onDetach?: () => void;
  onRequestKillPty?: (ptyId: string) => void;
  onToggleCommandPalette?: () => void;
  onToggleConsole?: () => void;
  /** State manager overrides for jump/new pane operations */
  stateManagerOverrides?: {
    handleJumpToPty: () => Promise<boolean>;
    handleNewPaneInSession: () => Promise<void>;
  };
}

/** Public API exposed by the controller for use by AggregateView rendering */
export interface AggregateKeyboardControllerAPI {
  getPreviewableSelectedPtyId: () => string | null;
  getAggregateEmulatorSync: (ptyId: string) => ITerminalEmulator | null;
  getAggregateTerminalStateSync: (ptyId: string) => unknown;
  isAggregateMouseTrackingEnabled: (ptyId: string) => boolean;
  isPreviewCopyModeActive: () => boolean;
  inSearchMode: () => boolean;
  vimMode: () => VimInputMode;
  vimEnabled: () => boolean;
}

/**
 * Controller component that manages all keyboard interactions for AggregateView.
 * Calls contexts directly and returns its public API.
 */
export function AggregateKeyboardController(props: AggregateKeyboardControllerProps) {
  const aggregate = useAggregateView();
  const keyboard = useKeyboard();
  const search = useSearch();
  const config = useConfig();
  const session = useSession();
  const terminal = useTerminal();
  const copyMode = useCopyMode();
  const selection = useSelection();
  const layout = useLayout();

  const { isActive } = props;

  // Vim mode (moved from AggregateView)
  const vim = useVimMode({ isAggregateVisible: isActive });

  // Preview support (moved from AggregateView)
  const {
    getPreviewableSelectedPtyId,
    getAggregateEmulatorSync,
    getAggregateTerminalStateSync,
    isAggregateMouseTrackingEnabled,
  } = useAggregatePreviewSupport({
    isActive,
    getSelectedPtyId: () => aggregate.state.selectedPtyId,
    getSelectedIndex: () => aggregate.state.selectedIndex,
    getFlattenedTree: () => aggregate.state.flattenedTree,
    getTrackedPtys: () => aggregate.state.matchedPtys,
    getActiveSessionId: () => session.state.activeSessionId,
    getWorkspaces: () => layout.state.workspaces,
    findSessionForPty: terminal.findSessionForPty,
    getEmulatorSync: terminal.getEmulatorSync,
    getTerminalStateSync: terminal.getTerminalStateSync,
    isMouseTrackingEnabled: terminal.isMouseTrackingEnabled,
  });

  // Local UI state (moved from AggregateView)
  const [prefixActive, setPrefixActive] = createSignal(false);
  const [inSearchMode, setInSearchMode] = createSignal(false);
  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearPrefixTimeout = () => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
      prefixTimeout = null;
    }
  };
  const startPrefixTimeout = () => {
    prefixTimeout = setTimeout(() => setPrefixActive(false), config.keybindings().prefixTimeoutMs);
  };

  // Copy mode helpers (moved from AggregateView)
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => isActive() && keyboard.state.mode === 'copy',
  });

  const isPreviewCopyModeActive = () => {
    const previewPtyId = getPreviewableSelectedPtyId();
    return aggregate.state.previewMode && !!previewPtyId && copyMode.isActive(previewPtyId);
  };

  const handleEnterSearch = async () => {
    const ptyId = getPreviewableSelectedPtyId();
    if (!ptyId) return;
    selection.clearAllSelections();
    await search.enterSearchMode(ptyId);
    keyboard.enterSearchMode();
    setInSearchMode(true);
  };

  const handleEnterCopyMode = () => {
    const ptyId = getPreviewableSelectedPtyId();
    if (!aggregate.state.previewMode || !ptyId) return;
    selection.clearAllSelections();
    keyboard.enterCopyMode();
    copyMode.enterCopyMode(ptyId, (id) => getAggregateTerminalStateSync(id));
  };

  const handleCopyModeKeys = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: () => {
      copyMode.exitCopyMode();
      if (keyboard.state.mode === 'copy') {
        keyboard.exitCopyMode();
        if (isActive()) keyboard.enterAggregateMode();
      }
    },
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  const handleListEnter = () => {
    const item = aggregate.state.flattenedTree[aggregate.state.selectedIndex];
    if (!item) return true;
    if (item.node.type === 'pty') {
      aggregate.enterPreviewMode();
      return true;
    }
    if (item.node.type === 'session' && item.node.loadState.status === 'loaded') {
      aggregate.toggleSessionExpanded(item.node.session.id);
      return true;
    }
    return true;
  };

  // Assemble keyboard deps
  const keyboardDeps: AggregateKeyboardDeps = {
    getPreviewMode: () => aggregate.state.previewMode,
    getSelectedPtyId: () => aggregate.state.selectedPtyId,
    getPreviewPtyId: getPreviewableSelectedPtyId,
    getFilterQuery: () => aggregate.state.filterQuery,
    getSearchState: () => search.searchState,
    getInSearchMode: () => inSearchMode(),
    getCopyModeActive: isPreviewCopyModeActive,
    getPrefixActive: prefixActive,
    getKeybindings: () => config.keybindings(),
    getMatchedCount: () => aggregate.state.flattenedTree.length,
    getVimEnabled: vim.isEnabled,
    getVimMode: vim.mode,
    setVimMode: vim.setMode,
    getSearchVimMode: () => search.vimMode,
    setSearchVimMode: search.setVimMode,
    getVimHandlers: vim.getHandlers,
    getEmulatorSync: getAggregateEmulatorSync,
    setFilterQuery: aggregate.setFilterQuery,
    toggleShowInactive: aggregate.toggleShowInactive,
    setInSearchMode,
    setPrefixActive,
    setSelectedIndex: aggregate.setSelectedIndex,
    closeAggregateView: aggregate.closeAggregateView,
    navigateUp: aggregate.navigateUp,
    navigateDown: aggregate.navigateDown,
    navigateToPrevPty: aggregate.navigateToPrevPty,
    navigateToNextPty: aggregate.navigateToNextPty,
    enterPreviewMode: aggregate.enterPreviewMode,
    togglePreviewZoom: aggregate.togglePreviewZoom,
    exitAggregateMode: keyboard.exitAggregateMode,
    exitSearchMode: search.exitSearchMode,
    setSearchQuery: search.setSearchQuery,
    nextMatch: search.nextMatch,
    prevMatch: search.prevMatch,
    handleEnterSearch,
    handleEnterCopyMode,
    handleCopyModeKeys,
    handleJumpToPty: props.stateManagerOverrides?.handleJumpToPty ?? (() => Promise.resolve(false)),
    handleNewPaneInSession:
      props.stateManagerOverrides?.handleNewPaneInSession ?? (() => Promise.resolve()),
    handleListEnter,
    onToggleSessionPicker: session.togglePicker,
    onToggleCommandPalette: props.onToggleCommandPalette,
    onToggleConsole: props.onToggleConsole,
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    onPaste: () => terminal.pasteToFocused(),
    clearPrefixTimeout,
    startPrefixTimeout,
    scrollListUp: aggregate.scrollListUp,
    scrollListDown: aggregate.scrollListDown,
    setListScrollOffset: aggregate.setListScrollOffset,
    togglePtyPicker: aggregate.openPtyPicker,
  };

  // Create keyboard handler
  const keyboardHandler = createAggregateKeyboardHandler(keyboardDeps);

  // Vim mode sync effects
  createEffect(() => {
    if (!isActive() || !vim.isEnabled()) return;
    if (inSearchMode() || aggregate.state.previewMode) {
      vim.setMode('normal');
    }
  });

  // Sync aggregate inSearchMode with global search state.
  // When search is exited via the global handler (e.g. pressing `q` in
  // search mode), the global handler clears search.searchState but does
  // not clear the aggregate's local inSearchMode flag. This effect
  // ensures the aggregate view doesn't require a second `q` press.
  createEffect(() => {
    if (!search.searchState && inSearchMode()) {
      setInSearchMode(false);
    }
  });

  // Register keyboard handler
  useOverlayKeyboardHandler({
    overlay: 'aggregateView',
    isActive,
    handler: keyboardHandler.handleKeyDown,
    ignoreRelease: false,
  });

  onCleanup(() => {
    // Keyboard handlers don't hold resources, but mouse handlers might
  });

  // Return public API for AggregateView rendering
  return {
    getPreviewableSelectedPtyId,
    getAggregateEmulatorSync,
    getAggregateTerminalStateSync,
    isAggregateMouseTrackingEnabled,
    isPreviewCopyModeActive,
    inSearchMode: inSearchMode,
    vimMode: vim.mode,
    vimEnabled: vim.isEnabled,
  } satisfies AggregateKeyboardControllerAPI;
}
