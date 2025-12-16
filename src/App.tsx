/**
 * Main App component for openmux
 */

import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/solid';
import type { PasteEvent } from '@opentui/core';
import {
  ThemeProvider,
  LayoutProvider,
  KeyboardProvider,
  TerminalProvider,
  useLayout,
  useKeyboardHandler,
  useKeyboardState,
  useTerminal,
} from './contexts';
import { SelectionProvider, useSelection } from './contexts/SelectionContext';
import { SearchProvider, useSearch } from './contexts/SearchContext';
import { useSession } from './contexts/SessionContext';
import { AggregateViewProvider, useAggregateView } from './contexts/AggregateViewContext';
import { PaneContainer, StatusBar, KeyboardHints, CopyNotification, ConfirmationDialog } from './components';
import type { ConfirmationType } from './core/types';
import { SessionPicker } from './components/SessionPicker';
import { SearchOverlay } from './components/SearchOverlay';
import { AggregateView } from './components/AggregateView';
import { SessionBridge } from './components/SessionBridge';
import { inputHandler } from './terminal';
import type { WorkspaceId } from './core/types';
import { getFocusedPtyId } from './core/workspace-utils';
import {
  routeKeyboardEventSync,
  markPtyCreated,
  isPtyCreated,
  getSessionCwd as getSessionCwdFromCoordinator,
} from './effect/bridge';

function AppContent() {
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const { setViewport, newPane, closePane } = layout;
  // Don't destructure isInitialized - it's a reactive getter that loses reactivity when destructured
  const terminal = useTerminal();
  const { createPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedCwd, getFocusedCursorKeyMode, destroyAllPTYs, getSessionCwd } = terminal;
  const { togglePicker, state: sessionState, saveSession } = useSession();
  // Keep selection/search contexts to access reactive getters
  const selection = useSelection();
  const { clearAllSelections } = selection;
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const { state: aggregateState, openAggregateView } = useAggregateView();
  const { enterConfirmMode, exitConfirmMode, exitSearchMode: keyboardExitSearchMode } = useKeyboardState();
  const renderer = useRenderer();

  // Track pending CWD for new panes (captured before NEW_PANE dispatch)
  let pendingCwd: string | null = null;

  // Confirmation dialog state
  const [confirmationState, setConfirmationState] = createSignal<{
    visible: boolean;
    type: ConfirmationType;
  }>({ visible: false, type: 'close_pane' });

  // Create new pane handler that captures CWD first
  const handleNewPane = async () => {
    // Capture the focused pane's CWD before creating the new pane
    const cwd = await getFocusedCwd();
    pendingCwd = cwd;
    newPane();
    // Session save is triggered automatically via layoutVersion change
  };

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = () => {
    pasteToFocused();
  };

  // Quit handler - save session and cleanup terminal before exiting
  const handleQuit = async () => {
    // Save the current session before quitting
    await saveSession();
    renderer.destroy();
    process.exit(0);
  };

  // Session picker toggle handler
  const handleToggleSessionPicker = () => {
    togglePicker();
  };

  // Toggle debug console
  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  // Search mode enter handler
  const handleEnterSearch = async () => {
    // Clear any existing selection so it doesn't hide search highlights
    clearAllSelections();

    // Get the focused pane's PTY ID using centralized utility
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    if (focusedPtyId) {
      await enterSearchMode(focusedPtyId);
    }
  };

  // Aggregate view toggle handler
  const handleToggleAggregateView = () => {
    openAggregateView();
  };

  // Request close pane (show confirmation)
  const handleRequestClosePane = () => {
    enterConfirmMode('close_pane');
    setConfirmationState({ visible: true, type: 'close_pane' });
  };

  // Request quit (show confirmation)
  const handleRequestQuit = () => {
    enterConfirmMode('exit');
    setConfirmationState({ visible: true, type: 'exit' });
  };

  // Confirmation dialog handlers
  const handleConfirmAction = async () => {
    const { type } = confirmationState();
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });

    if (type === 'close_pane') {
      closePane();
    } else if (type === 'exit') {
      await saveSession();
      renderer.destroy();
      process.exit(0);
    }
  };

  const handleCancelConfirmation = () => {
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });
  };

  // Handle bracketed paste from host terminal (Cmd+V sends this)
  createEffect(() => {
    const handleBracketedPaste = (event: PasteEvent) => {
      // Write the pasted text directly to the focused pane's PTY
      const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
      if (focusedPtyId) {
        writeToPTY(focusedPtyId, event.text);
      }
    };

    renderer.keyInput.on('paste', handleBracketedPaste);

    onCleanup(() => {
      renderer.keyInput.off('paste', handleBracketedPaste);
    });
  });

  const keyboardHandler = useKeyboardHandler({
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onQuit: handleQuit,
    onRequestQuit: handleRequestQuit,
    onRequestClosePane: handleRequestClosePane,
    onToggleSessionPicker: handleToggleSessionPicker,
    onEnterSearch: handleEnterSearch,
    onToggleConsole: handleToggleConsole,
    onToggleAggregateView: handleToggleAggregateView,
  });
  const { handleKeyDown } = keyboardHandler;

  // Retry counter to trigger effect re-run when PTY creation fails
  const [ptyRetryCounter, setPtyRetryCounter] = createSignal(0);

  // Update viewport when terminal resizes
  createEffect(() => {
    const w = width();
    const h = height();
    if (w > 0 && h > 0) {
      // Reserve 1 row for status bar
      setViewport({ x: 0, y: 0, width: w, height: h - 1 });
    }
  });

  // Create first pane on mount
  onMount(() => {
    newPane('shell');
  });

  // Create PTYs for panes that don't have one
  createEffect(() => {
    if (!terminal.isInitialized) return;

    // Track retry counter to re-trigger effect
    const _retry = ptyRetryCounter();
    let hadFailure = false;

    const createPtysForPanes = async () => {
      for (const pane of layout.panes) {
        const alreadyCreated = await isPtyCreated(pane.id);
        if (!pane.ptyId && !alreadyCreated) {
          // Calculate pane dimensions (account for border)
          const rect = pane.rectangle ?? { width: 80, height: 24 };
          const cols = Math.max(1, rect.width - 2);
          const rows = Math.max(1, rect.height - 2);

          // Check for session-restored CWD first, then pending CWD from new pane,
          // then OPENMUX_ORIGINAL_CWD (set by wrapper to preserve user's cwd)
          const sessionCwd = await getSessionCwdFromCoordinator(pane.id);
          let cwd = sessionCwd ?? pendingCwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? undefined;
          pendingCwd = null; // Clear after use

          try {
            createPTY(pane.id, cols, rows, cwd);
            // Only mark as created AFTER successful PTY creation
            // This allows retry on subsequent renders if creation fails
            await markPtyCreated(pane.id);
          } catch (err) {
            console.error(`Failed to create PTY for pane ${pane.id}:`, err);
            hadFailure = true;
          }
        }
      }

      // Schedule a retry if any PTY creation failed
      if (hadFailure) {
        setTimeout(() => {
          setPtyRetryCounter(c => c + 1);
        }, 100);
      }
    };

    createPtysForPanes();
  });

  // Resize PTYs and update positions when pane dimensions change
  createEffect(() => {
    if (!terminal.isInitialized) return;

    for (const pane of layout.panes) {
      if (pane.ptyId && pane.rectangle) {
        const cols = Math.max(1, pane.rectangle.width - 2);
        const rows = Math.max(1, pane.rectangle.height - 2);
        resizePTY(pane.ptyId, cols, rows);
        // Update pane position for graphics passthrough (+1 for border)
        setPanePosition(pane.ptyId, pane.rectangle.x + 1, pane.rectangle.y + 1);
      }
    }
  });

  // Track previous aggregate view state to detect close
  let prevShowAggregateView = aggregateState.showAggregateView;

  // Restore PTY sizes when aggregate view closes
  // The preview resizes PTYs to preview dimensions, so we need to restore pane dimensions
  createEffect(() => {
    const wasOpen = prevShowAggregateView;
    const isOpen = aggregateState.showAggregateView;
    prevShowAggregateView = isOpen;

    // Only trigger resize when closing (was open, now closed)
    if (wasOpen && !isOpen && terminal.isInitialized) {
      for (const pane of layout.panes) {
        if (pane.ptyId && pane.rectangle) {
          const cols = Math.max(1, pane.rectangle.width - 2);
          const rows = Math.max(1, pane.rectangle.height - 2);
          resizePTY(pane.ptyId, cols, rows);
        }
      }
    }
  });

  // Handle keyboard input
  useKeyboard(
    (event: { name: string; ctrl?: boolean; shift?: boolean; option?: boolean; meta?: boolean; sequence?: string }) => {
      // Route to overlays via KeyboardRouter (handles confirmation, session picker, aggregate view)
      // Use event.sequence for printable chars (handles shift for uppercase/symbols)
      // Fall back to event.name for special keys
      const charCode = event.sequence?.charCodeAt(0) ?? 0;
      const isPrintableChar = event.sequence?.length === 1 && charCode >= 32 && charCode < 127;
      const keyToPass = isPrintableChar ? event.sequence! : event.name;

      const routeResult = routeKeyboardEventSync({
        key: keyToPass,
        ctrl: event.ctrl,
        alt: event.option,
        shift: event.shift,
        sequence: event.sequence,
      });

      // If an overlay handled the key, don't process further
      if (routeResult.handled) {
        return;
      }

      // If in search mode, handle search-specific keys
      if (keyboardHandler.mode === 'search') {
        const key = event.name.toLowerCase();

        if (key === 'escape') {
          // Cancel search, restore original scroll position
          exitSearchMode(true);
          keyboardExitSearchMode();
          return;
        }

        if (key === 'return' || key === 'enter') {
          // Confirm search, stay at current position
          exitSearchMode(false);
          keyboardExitSearchMode();
          return;
        }

        // Wait for searchState to be initialized before handling navigation/input
        const currentSearchState = search.searchState;
        if (!currentSearchState) {
          return;
        }

        if (key === 'n' && event.ctrl && !event.shift && !event.option) {
          // Next match (Ctrl+n)
          nextMatch();
          return;
        }

        if ((key === 'n' && event.ctrl && event.shift) || (key === 'p' && event.ctrl)) {
          // Previous match (Ctrl+Shift+N or Ctrl+p)
          prevMatch();
          return;
        }

        if (key === 'backspace') {
          // Delete last character from query
          setSearchQuery(currentSearchState.query.slice(0, -1));
          return;
        }

        // Single printable character - add to search query
        const searchCharCode = event.sequence?.charCodeAt(0) ?? 0;
        const isPrintable = event.sequence?.length === 1 && searchCharCode >= 32 && searchCharCode < 127;
        if (isPrintable && !event.ctrl && !event.option && !event.meta) {
          setSearchQuery(currentSearchState.query + event.sequence);
          return;
        }

        // Consume all other keys in search mode
        return;
      }

      // First, check if this is a multiplexer command
      const handled = handleKeyDown({
        key: event.name,
        ctrl: event.ctrl,
        shift: event.shift,
        alt: event.option, // OpenTUI uses 'option' for Alt key
        meta: event.meta,
      });

      // If not handled by multiplexer and in normal mode, forward to PTY
      if (!handled && keyboardHandler.mode === 'normal' && !sessionState.showSessionPicker) {

        // Clear any active selection when user types
        clearAllSelections();

        // Get the focused pane's cursor key mode (DECCKM)
        // This affects how arrow keys are encoded (application vs normal mode)
        const cursorKeyMode = getFocusedCursorKeyMode();
        inputHandler.setCursorMode(cursorKeyMode);

        // Convert keyboard event to terminal escape sequence
        // Use event.sequence for single printable chars (handles shift for uppercase/symbols)
        // Fall back to event.name for special keys (arrows, function keys, etc.)
        // Don't use sequence for control chars (< 32) or DEL (127) as we need name for Shift+Tab etc.
        const keyCharCode = event.sequence?.charCodeAt(0) ?? 0;
        const isPrintable = event.sequence?.length === 1 && keyCharCode >= 32 && keyCharCode < 127;
        const keyToEncode = isPrintable ? event.sequence! : event.name;
        const sequence = inputHandler.encodeKey({
          key: keyToEncode,
          ctrl: event.ctrl,
          shift: event.shift,
          alt: event.option,
          meta: event.meta,
        });

        if (sequence) {
          writeToFocused(sequence);
        }
      }
    }
  );

  return (
    <box
      style={{
        width: width(),
        height: height(),
        flexDirection: 'column',
      }}
    >
      {/* Main pane area */}
      <PaneContainer />

      {/* Status bar at bottom */}
      <StatusBar width={width()} />

      {/* Keyboard hints overlay */}
      <KeyboardHints width={width()} height={height()} />

      {/* Session picker overlay */}
      <SessionPicker width={width()} height={height()} />

      {/* Search overlay */}
      <SearchOverlay width={width()} height={height()} />

      {/* Aggregate view overlay */}
      <AggregateView width={width()} height={height()} />

      {/* Confirmation dialog */}
      <ConfirmationDialog
        visible={confirmationState().visible}
        type={confirmationState().type}
        width={width()}
        height={height()}
        onConfirm={handleConfirmAction}
        onCancel={handleCancelConfirmation}
      />

      {/* Copy notification toast */}
      <CopyNotification
        visible={selection.copyNotification.visible}
        charCount={selection.copyNotification.charCount}
        paneRect={
          selection.copyNotification.ptyId
            ? layout.panes.find(p => p.ptyId === selection.copyNotification.ptyId)?.rectangle ?? null
            : null
        }
      />
    </box>
  );
}

function AppWithTerminal() {
  return (
    <TerminalProvider>
      <SelectionProvider>
        <SearchProvider>
          <SessionBridge>
            <AggregateViewProvider>
              <AppContent />
            </AggregateViewProvider>
          </SessionBridge>
        </SearchProvider>
      </SelectionProvider>
    </TerminalProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <KeyboardProvider>
          <AppWithTerminal />
        </KeyboardProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
