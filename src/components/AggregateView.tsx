/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list with j/k, Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, For, createSignal, createEffect, onCleanup, createMemo } from 'solid-js';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useConfig } from '../contexts/ConfigContext';
import { useLayout } from '../contexts/LayoutContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { getHostBackgroundColor, registerKeyboardHandler } from '../effect/bridge';
import {
  PtyCard,
  InteractivePreview,
  findPtyLocation,
  findPaneLocation,
  createAggregateKeyboardHandler,
  createAggregateMouseHandlers,
  borderStyleMap,
  calculateLayoutDimensions,
  getHintsText,
  getFilterText,
  calculateFooterWidths,
} from './aggregate';

interface AggregateViewProps {
  width: number;
  height: number;
  onRequestQuit?: () => void;
  onDetach?: () => void;
  onRequestKillPty?: (ptyId: string) => void;
}

export function AggregateView(props: AggregateViewProps) {
  const config = useConfig();
  const {
    state,
    closeAggregateView,
    setFilterQuery,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
    selectPty,
  } = useAggregateView();
  const { exitAggregateMode, enterSearchMode: keyboardEnterSearchMode } = useKeyboardState();
  const { state: layoutState, switchWorkspace, focusPane } = useLayout();
  const { state: sessionState, switchSession } = useSession();
  const { findSessionForPty, scrollTerminal, isMouseTrackingEnabled, getScrollState, getEmulatorSync, getTerminalStateSync } = useTerminal();
  const theme = useTheme();
  const { clearAllSelections, startSelection, updateSelection, completeSelection, clearSelection, getSelection } = useSelection();
  // Keep search context to access searchState reactively (it's a getter)
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;

  // Track prefix mode for prefix+esc to exit interactive mode
  const [prefixActive, setPrefixActive] = createSignal(false);
  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track pending navigation after session switch
  let pendingPaneNavigation: string | null = null;

  // Track if we're in search mode within aggregate view
  const [inSearchMode, setInSearchMode] = createSignal(false);

  // Layout dimensions (memoized)
  const layout = createMemo(() =>
    calculateLayoutDimensions({ width: props.width, height: props.height })
  );

  // Clear prefix timeout on unmount
  onCleanup(() => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
    }
  });

  // Handle pending navigation after session switch
  createEffect(() => {
    // Track session ID to detect changes
    const _sessionId = sessionState.activeSessionId;

    if (!pendingPaneNavigation) return;
    const pendingPaneId = pendingPaneNavigation;

    // Clear the pending navigation
    pendingPaneNavigation = null;

    // Find the workspace containing this pane in the current (newly loaded) workspaces
    const paneLocation = findPaneLocation(pendingPaneId, layoutState.workspaces);
    if (paneLocation) {
      switchWorkspace(paneLocation.workspaceId);
    }
    focusPane(pendingPaneId);
  });

  // Jump to the selected PTY's workspace and pane (supports cross-session jumps)
  const handleJumpToPty = async () => {
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return false;

    // Close aggregate view first
    closeAggregateView();
    exitAggregateMode();

    // First, check if PTY is in the current session
    const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
    if (location) {
      // PTY is in current session - navigate to it
      if (layoutState.activeWorkspaceId !== location.workspaceId) {
        switchWorkspace(location.workspaceId);
      }
      focusPane(location.paneId);
      return true;
    }

    // PTY not in current session - check if it's in another session
    const sessionLocation = findSessionForPty(selectedPtyId);
    if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
      // Store the target pane ID for navigation after session loads
      pendingPaneNavigation = sessionLocation.paneId;

      // Switch to the other session - the effect will handle navigation after load
      await switchSession(sessionLocation.sessionId);

      return true;
    }

    return false;
  };

  // Helper to enter search mode for the selected PTY
  const handleEnterSearch = async () => {
    const selectedPtyId = state.selectedPtyId;
    if (!selectedPtyId) return;

    // Clear any existing selection
    clearAllSelections();

    // Enter search mode for the selected PTY
    await enterSearchMode(selectedPtyId);
    keyboardEnterSearchMode();
    setInSearchMode(true);
  };

  // Prefix timeout management
  const clearPrefixTimeout = () => {
    if (prefixTimeout) {
      clearTimeout(prefixTimeout);
      prefixTimeout = null;
    }
  };

  const startPrefixTimeout = () => {
    prefixTimeout = setTimeout(() => {
      setPrefixActive(false);
    }, config.keybindings().prefixTimeoutMs);
  };

  // Create keyboard handler using factory
  const keyboardHandler = createAggregateKeyboardHandler({
    getShowAggregateView: () => state.showAggregateView,
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getFilterQuery: () => state.filterQuery,
    getSearchState: () => search.searchState,
    getInSearchMode: inSearchMode,
    getPrefixActive: prefixActive,
    getKeybindings: () => config.keybindings(),
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
    onRequestQuit: props.onRequestQuit,
    onDetach: props.onDetach,
    onRequestKillPty: props.onRequestKillPty,
    clearPrefixTimeout,
    startPrefixTimeout,
  });

  // Create mouse handlers using factory (uses shared terminal-mouse-handler)
  const mouseHandlers = createAggregateMouseHandlers({
    getPreviewMode: () => state.previewMode,
    getSelectedPtyId: () => state.selectedPtyId,
    getListPaneWidth: () => layout().listPaneWidth,
    getPreviewInnerWidth: () => layout().previewInnerWidth,
    getPreviewInnerHeight: () => layout().previewInnerHeight,
    isMouseTrackingEnabled,
    getScrollState,
    scrollTerminal,
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    getSelection,
    getEmulatorSync,
    getTerminalStateSync,
  });

  // Cleanup mouse handler state (auto-scroll intervals, pending selection) on unmount
  onCleanup(() => {
    mouseHandlers.cleanup();
  });

  // Register keyboard handler with KeyboardRouter
  createEffect(() => {
    const unsubscribe = registerKeyboardHandler('aggregateView', keyboardHandler.handleKeyDown);
    onCleanup(() => unsubscribe());
  });

  // Get host terminal background color to match user's theme
  const hostBgColor = getHostBackgroundColor();

  // Build hints text based on mode
  const hintsText = () => getHintsText(inSearchMode(), state.previewMode, config.keybindings());

  // Build search/filter text
  const filterText = () => getFilterText(state.filterQuery);

  // Calculate footer widths
  const footerWidths = () => calculateFooterWidths(props.width, hintsText());

  return (
    <Show when={state.showAggregateView}>
      <box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: props.width,
          height: props.height,
          flexDirection: 'column',
          zIndex: 100,
        }}
        backgroundColor={hostBgColor}
      >
        {/* Main content - two panes side by side */}
        <box style={{ flexDirection: 'row', height: layout().contentHeight }}>
          {/* Left pane - PTY list (bordered, highlighted when in list mode) */}
          <box
            style={{
              width: layout().listPaneWidth,
              height: layout().contentHeight,
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: state.previewMode ? theme.pane.borderColor : theme.pane.focusedBorderColor,
            }}
            title={` PTYs (${state.matchedPtys.length}) `}
            titleAlignment="left"
            onMouseDown={(e: { preventDefault: () => void }) => {
              e.preventDefault();
              // Clicking on list pane exits preview mode
              if (state.previewMode) {
                exitPreviewMode();
              }
            }}
          >
            <box style={{ flexDirection: 'column' }}>
              <Show
                when={state.matchedPtys.length > 0}
                fallback={
                  <box style={{ height: layout().listInnerHeight, justifyContent: 'center', alignItems: 'center' }}>
                    <text fg="#666666">No PTYs match filter</text>
                  </box>
                }
              >
                <For each={state.matchedPtys.slice(0, layout().maxVisibleCards)}>
                  {(pty, index) => (
                    <PtyCard
                      pty={pty}
                      isSelected={index() === state.selectedIndex}
                      maxWidth={layout().listInnerWidth}
                      index={index()}
                      totalCount={state.matchedPtys.length}
                      onClick={() => {
                        // Select this PTY and exit preview mode if active
                        selectPty(pty.ptyId);
                        if (state.previewMode) {
                          exitPreviewMode();
                        }
                      }}
                    />
                  )}
                </For>
              </Show>
            </box>
          </box>

          {/* Right pane - Terminal preview (bordered, with mouse support) */}
          <box
            style={{
              width: layout().previewPaneWidth,
              height: layout().contentHeight,
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: state.previewMode ? theme.pane.focusedBorderColor : theme.pane.borderColor,
            }}
            onMouseDown={(e: Parameters<typeof mouseHandlers.handlePreviewMouseDown>[0]) => {
              // Click on preview enters preview mode if not already in it
              if (!state.previewMode) {
                e.preventDefault();
                enterPreviewMode();
                return;
              }
              mouseHandlers.handlePreviewMouseDown(e);
            }}
            onMouseUp={mouseHandlers.handlePreviewMouseUp}
            onMouseMove={mouseHandlers.handlePreviewMouseMove}
            onMouseDrag={mouseHandlers.handlePreviewMouseDrag}
            onMouseScroll={mouseHandlers.handlePreviewMouseScroll}
          >
            <InteractivePreview
              ptyId={state.selectedPtyId}
              width={layout().previewInnerWidth}
              height={layout().previewInnerHeight}
              isInteractive={state.previewMode}
              offsetX={layout().listPaneWidth + 1}
              offsetY={1}
            />
          </box>
        </box>

        {/* Footer status bar - search on left, hints on right */}
        <box style={{ height: 1, flexDirection: 'row' }}>
          <box style={{ width: footerWidths().filterWidth }}>
            <text fg="#CCCCCC">{filterText().slice(0, footerWidths().filterWidth)}</text>
          </box>
          <box style={{ width: footerWidths().hintsWidth + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <text fg="#666666">{hintsText()}</text>
          </box>
        </box>
      </box>
    </Show>
  );
}
