/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list with j/k, Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useLayout } from '../contexts/LayoutContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { getHostBackgroundColor, writeToPty, registerKeyboardHandler } from '../effect/bridge';
import { inputHandler } from '../terminal/input-handler';
import { findPtyLocation, findPaneLocation } from './aggregate/utils';
import { PtyCard } from './aggregate/PtyCard';
import { InteractivePreview } from './aggregate/InteractivePreview';

interface AggregateViewProps {
  width: number;
  height: number;
  onRequestQuit?: () => void;
}

export function AggregateView(props: AggregateViewProps) {
  const {
    state,
    closeAggregateView,
    setFilterQuery,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
  } = useAggregateView();
  const { exitAggregateMode, enterSearchMode: keyboardEnterSearchMode } = useKeyboardState();
  const { state: layoutState, switchWorkspace, focusPane, clearAll } = useLayout();
  const { state: sessionState, switchSession } = useSession();
  const { findSessionForPty, scrollTerminal, isMouseTrackingEnabled, isAlternateScreen } = useTerminal();
  const theme = useTheme();
  const { clearAllSelections } = useSelection();
  // Keep search context to access searchState reactively (it's a getter)
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;

  // Track prefix mode for prefix+esc to exit interactive mode
  const [prefixActive, setPrefixActive] = createSignal(false);
  let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track pending navigation after session switch
  let pendingPaneNavigation: string | null = null;

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

  // Track if we're in search mode within aggregate view
  const [inSearchMode, setInSearchMode] = createSignal(false);

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

  // Handle keyboard input when aggregate view is open
  const handleKeyDown = (event: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; sequence?: string }) => {
    if (!state.showAggregateView) return false;

    const { key } = event;
    const normalizedKey = key.toLowerCase();

    // Handle search mode first (when active in preview)
    if (inSearchMode() && state.previewMode) {
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
      const currentSearchState = search.searchState;
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
    }

    // Global prefix key handling (Ctrl+B) - works in both list and preview mode
    if (event.ctrl && normalizedKey === 'b') {
      setPrefixActive(true);
      // Set timeout to clear prefix mode after 2 seconds
      if (prefixTimeout) {
        clearTimeout(prefixTimeout);
      }
      prefixTimeout = setTimeout(() => {
        setPrefixActive(false);
      }, 2000);
      return true;
    }

    // Global prefix commands (work in both list and preview mode)
    if (prefixActive()) {
      // Prefix+q to quit the app (show confirmation modal)
      if (normalizedKey === 'q') {
        setPrefixActive(false);
        if (prefixTimeout) {
          clearTimeout(prefixTimeout);
        }
        if (props.onRequestQuit) {
          props.onRequestQuit();
        }
        return true;
      }
    }

    // In preview mode, most keys go to the PTY
    if (state.previewMode) {

      // Alt+F to enter search mode
      if (event.alt && normalizedKey === 'f') {
        handleEnterSearch();
        return true;
      }

      // Alt+Escape or Prefix+Escape exits preview mode back to list (allows programs to use plain Esc)
      if (event.alt && normalizedKey === 'escape') {
        exitPreviewMode();
        return true;
      }

      if (prefixActive() && normalizedKey === 'escape') {
        setPrefixActive(false);
        if (prefixTimeout) {
          clearTimeout(prefixTimeout);
        }
        exitPreviewMode();
        return true;
      }

      // Prefix+/ to enter search mode (vim-style)
      if (prefixActive() && key === '/') {
        setPrefixActive(false);
        if (prefixTimeout) {
          clearTimeout(prefixTimeout);
        }
        handleEnterSearch();
        return true;
      }

      // Clear prefix mode on any other key after prefix
      if (prefixActive()) {
        setPrefixActive(false);
        if (prefixTimeout) {
          clearTimeout(prefixTimeout);
        }
      }

      // Forward key to PTY using inputHandler for proper encoding
      const selectedPtyId = state.selectedPtyId;
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
    }

    // List mode keyboard handling
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
      if (state.selectedPtyId) {
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
      setFilterQuery(state.filterQuery.slice(0, -1));
      return true;
    }

    // Single printable character - add to filter
    if (key.length === 1 && !event.ctrl && !event.alt) {
      setFilterQuery(state.filterQuery + key);
      return true;
    }

    return true; // Consume all keys while in aggregate view
  };

  // Register keyboard handler with KeyboardRouter
  createEffect(() => {
    let unsubscribe: (() => void) | null = null;

    registerKeyboardHandler('aggregateView', handleKeyDown).then((unsub) => {
      unsubscribe = unsub;
    });

    onCleanup(() => {
      if (unsubscribe) {
        unsubscribe();
      }
    });
  });

  // Get host terminal background color to match user's theme
  const hostBgColor = getHostBackgroundColor();

  // Map borderStyle to OpenTUI BorderStyle type
  const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
    single: 'single',
    double: 'double',
    rounded: 'rounded',
    bold: 'single',
  };

  // Layout calculations
  // Reserve 1 row for footer (status bar with search + hints)
  const footerHeight = 1;
  const contentHeight = () => props.height - footerHeight;

  // Split width: list pane (35%) and preview pane (65%)
  const listPaneWidth = () => Math.floor(props.width * 0.35);
  const previewPaneWidth = () => props.width - listPaneWidth();

  // Inner dimensions (account for borders: -2 for left/right border)
  const listInnerWidth = () => Math.max(1, listPaneWidth() - 2);
  const listInnerHeight = () => Math.max(1, contentHeight() - 2);
  const previewInnerWidth = () => Math.max(1, previewPaneWidth() - 2);
  const previewInnerHeight = () => Math.max(1, contentHeight() - 2);

  // Each card is 2 lines, calculate max visible cards
  const maxVisibleCards = () => Math.floor(listInnerHeight() / 2);

  // Mouse handler for preview pane
  const handlePreviewMouseEvent = (event: OpenTUIMouseEvent, type: 'down' | 'up' | 'move' | 'drag' | 'scroll') => {
    if (!state.previewMode || !state.selectedPtyId) return;

    // Calculate coordinates relative to preview content (subtract border and pane position)
    const previewX = listPaneWidth();
    const previewY = 0; // No header now, panes start at top
    const relX = event.x - previewX - 1;
    const relY = event.y - previewY - 1;

    // Only forward if inside the content area
    if (relX < 0 || relY < 0 || relX >= previewInnerWidth() || relY >= previewInnerHeight()) return;

    // Handle scroll specially
    if (type === 'scroll') {
      const scrollUp = event.scroll?.direction === 'up';
      const button = scrollUp ? 4 : 5;
      const sequence = inputHandler.encodeMouse({
        type: 'scroll',
        button,
        x: relX,
        y: relY,
        shift: event.modifiers?.shift,
        alt: event.modifiers?.alt,
        ctrl: event.modifiers?.ctrl,
      });
      writeToPty(state.selectedPtyId, sequence);
      return;
    }

    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });
    writeToPty(state.selectedPtyId, sequence);
  };

  const handlePreviewMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'down');
  };

  const handlePreviewMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'up');
  };

  const handlePreviewMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'move');
  };

  const handlePreviewMouseDrag = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'drag');
  };

  const handlePreviewMouseScroll = (event: OpenTUIMouseEvent) => {
    if (!state.previewMode || !state.selectedPtyId) return;

    // Calculate coordinates relative to preview content (subtract border and pane position)
    const previewX = listPaneWidth();
    const previewY = 0;
    const relX = event.x - previewX - 1;
    const relY = event.y - previewY - 1;

    // Check if the app has mouse tracking enabled - if so, forward scroll to it
    const shouldForwardToApp = isAlternateScreen(state.selectedPtyId) || isMouseTrackingEnabled(state.selectedPtyId);

    if (shouldForwardToApp) {
      // Forward scroll event to the PTY
      const scrollUp = event.scroll?.direction === 'up';
      const button = scrollUp ? 4 : 5;
      const sequence = inputHandler.encodeMouse({
        type: 'scroll',
        button,
        x: relX,
        y: relY,
        shift: event.modifiers?.shift,
        alt: event.modifiers?.alt,
        ctrl: event.modifiers?.ctrl,
      });
      writeToPty(state.selectedPtyId, sequence);
    } else {
      // Handle scroll locally - scroll through scrollback buffer
      const scrollSpeed = 3;
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        // Scroll up = look at older content = increase viewport offset
        scrollTerminal(state.selectedPtyId, scrollSpeed);
      } else if (direction === 'down') {
        // Scroll down = look at newer content = decrease viewport offset
        scrollTerminal(state.selectedPtyId, -scrollSpeed);
      }
    }
  };

  // Build hints text based on mode
  const hintsText = () => {
    if (inSearchMode()) {
      return 'Enter: confirm | Esc: cancel | ^n/^p: next/prev';
    }
    return state.previewMode
      ? 'Alt+Esc: back | Alt+F: search'
      : '↑↓/jk: navigate | Enter: interact | Tab: jump | Alt+Esc: close';
  };

  // Build search/filter text
  const filterText = () => `Filter: ${state.filterQuery}_`;

  // Calculate how much space hints need (right-aligned)
  const hintsWidth = () => hintsText().length;
  const filterWidth = () => props.width - hintsWidth() - 2; // -2 for spacing

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
        }}
        backgroundColor={hostBgColor}
      >
        {/* Main content - two panes side by side */}
        <box style={{ flexDirection: 'row', height: contentHeight() }}>
          {/* Left pane - PTY list (bordered, highlighted when in list mode) */}
          <box
            style={{
              width: listPaneWidth(),
              height: contentHeight(),
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: state.previewMode ? theme.pane.borderColor : theme.pane.focusedBorderColor,
            }}
            title={`PTYs (${state.matchedPtys.length})`}
            titleAlignment="left"
          >
            <box style={{ flexDirection: 'column' }}>
              <Show
                when={state.matchedPtys.length > 0}
                fallback={
                  <box style={{ height: 1 }}>
                    <text fg="#666666">No PTYs match filter</text>
                  </box>
                }
              >
                <For each={state.matchedPtys.slice(0, maxVisibleCards())}>
                  {(pty, index) => (
                    <PtyCard
                      pty={pty}
                      isSelected={index() === state.selectedIndex}
                      maxWidth={listInnerWidth()}
                    />
                  )}
                </For>
              </Show>
            </box>
          </box>

          {/* Right pane - Terminal preview (bordered, with mouse support) */}
          <box
            style={{
              width: previewPaneWidth(),
              height: contentHeight(),
              border: true,
              borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
              borderColor: state.previewMode ? theme.pane.focusedBorderColor : theme.pane.borderColor,
            }}
            onMouseDown={handlePreviewMouseDown}
            onMouseUp={handlePreviewMouseUp}
            onMouseMove={handlePreviewMouseMove}
            onMouseDrag={handlePreviewMouseDrag}
            onMouseScroll={handlePreviewMouseScroll}
          >
            <InteractivePreview
              ptyId={state.selectedPtyId}
              width={previewInnerWidth()}
              height={previewInnerHeight()}
              isInteractive={state.previewMode}
              offsetX={listPaneWidth() + 1}
              offsetY={1}
            />
          </box>
        </box>

        {/* Footer status bar - search on left, hints on right */}
        <box style={{ height: 1, flexDirection: 'row' }}>
          <box style={{ width: filterWidth() }}>
            <text fg="#CCCCCC">{filterText().slice(0, filterWidth())}</text>
          </box>
          <box style={{ width: hintsWidth() + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <text fg="#666666">{hintsText()}</text>
          </box>
        </box>
      </box>
    </Show>
  );
}
