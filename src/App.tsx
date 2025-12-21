/**
 * Main App component for openmux
 */

import { createSignal, createEffect, onCleanup, onMount, on } from 'solid-js';
import { useTerminalDimensions, useRenderer } from '@opentui/solid';
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
import { TitleProvider } from './contexts/TitleContext';
import { PaneContainer, StatusBar, KeyboardHints, CopyNotification, ConfirmationDialog } from './components';
import type { ConfirmationType } from './core/types';
import { SessionPicker } from './components/SessionPicker';
import { SearchOverlay } from './components/SearchOverlay';
import { AggregateView } from './components/AggregateView';
import { SessionBridge } from './components/SessionBridge';
import { getFocusedPtyId } from './core/workspace-utils';
import {
  routeKeyboardEventSync,
  markPtyCreated,
  isPtyCreated,
  getSessionCwd as getSessionCwdFromCoordinator,
} from './effect/bridge';
import { disposeRuntime } from './effect/runtime';
import type { PasteEvent } from '@opentui/core';
import {
  createConfirmationHandlers,
  createPaneResizeHandlers,
  createPasteHandler,
  handleSearchKeyboard,
  processNormalModeKey,
} from './components/app';
import { usePtyLifecycle } from './components/app/pty-lifecycle';
import { getCopyNotificationRect } from './components/app/copy-notification';
import { setFocusedPty, setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';
import { useAppKeyboardInput } from './components/app/keyboard-input';

function AppContent() {
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const { setViewport, newPane, closePane } = layout;
  // Don't destructure isInitialized - it's a reactive getter that loses reactivity when destructured
  const terminal = useTerminal();
  const { createPTY, destroyPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedCwd, getFocusedCursorKeyMode, destroyAllPTYs, getSessionCwd, getEmulatorSync } = terminal;
  const { togglePicker, state: sessionState, saveSession } = useSession();
  // Keep selection/search contexts to access reactive getters
  const selection = useSelection();
  const { clearAllSelections } = selection;
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const { state: aggregateState, openAggregateView } = useAggregateView();
  const { enterConfirmMode, exitConfirmMode, exitSearchMode: keyboardExitSearchMode } = useKeyboardState();
  const renderer = useRenderer();


  // Confirmation dialog state
  const [confirmationState, setConfirmationState] = createSignal<{
    visible: boolean;
    type: ConfirmationType;
  }>({ visible: false, type: 'close_pane' });

  // Track pending kill PTY ID for aggregate view kill confirmation
  const [pendingKillPtyId, setPendingKillPtyId] = createSignal<string | null>(null);

  // Create confirmation handlers
  const confirmationHandlers = createConfirmationHandlers({
    confirmationState,
    setConfirmationState,
    pendingKillPtyId,
    setPendingKillPtyId,
    closePane,
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    destroyPTY,
    enterConfirmMode,
    exitConfirmMode,
    saveSession,
    destroyRenderer: () => renderer.destroy(),
  });

  // Create paste handler for bracketed paste from host terminal
  const pasteHandler = createPasteHandler({
    getFocusedPtyId: () => getFocusedPtyId(layout.activeWorkspace),
    writeToPTY,
  });

  // Create pane resize handlers
  const paneResizeHandlers = createPaneResizeHandlers({
    getPanes: () => layout.panes,
    resizePTY,
    setPanePosition,
  });

  // Connect focused PTY registry for clipboard passthrough
  // This bridges the stdin-level paste trigger with the SolidJS context
  // Key insight: We read from clipboard (always complete) instead of unreliable stdin data
  onMount(() => {
    // Bracketed paste mode sequences
    const PASTE_START = '\x1b[200~';
    const PASTE_END = '\x1b[201~';

    // Register clipboard paste handler
    // This is called when paste start marker is detected in stdin
    // We read from clipboard (always complete, no chunking issues) instead of stdin data
    setClipboardPasteHandler(async (ptyId) => {
      try {
        // Read directly from system clipboard - always complete, no chunking issues
        const clipboardText = await readFromClipboard();
        if (!clipboardText) return;

        // Send complete paste atomically with brackets
        // Apps with bracketed paste mode expect the entire paste between markers
        const fullPaste = PASTE_START + clipboardText + PASTE_END;
        await writeToPTY(ptyId, fullPaste);
      } catch (err) {
        console.error('Clipboard paste error:', err);
      }
    });
  });

  // Keep the focused PTY registry in sync with the current workspace focus
  createEffect(() => {
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    setFocusedPty(focusedPtyId ?? null);
  });

  // Create new pane handler - instant feedback, CWD retrieval in background
  const handleNewPane = () => {
    // Fire off CWD retrieval in background (don't await)
    getFocusedCwd().then(cwd => {
      if (cwd) pendingCwdRef.current = cwd;
    });

    // Create pane immediately (shows border instantly)
    // PTY will be created by the effect with CWD when available
    newPane();
  };

  // Ref for passing CWD to effect (avoids closure issues)
  const pendingCwdRef = { current: null as string | null };

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = () => {
    pasteToFocused();
  };

  // Quit handler - save session and cleanup terminal before exiting
  const handleQuit = async () => {
    // Save the current session before quitting
    await saveSession();
    // Dispose Effect runtime to cleanup services
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  // Session picker toggle handler
  const handleToggleSessionPicker = () => {
    togglePicker();
  };

  // Toggle console
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


  // Handle bracketed paste from host terminal (Cmd+V sends this)
  createEffect(() => {
    renderer.keyInput.on('paste', pasteHandler.handleBracketedPaste);

    onCleanup(() => {
      renderer.keyInput.off('paste', pasteHandler.handleBracketedPaste);
    });
  });

  const keyboardHandler = useKeyboardHandler({
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onQuit: handleQuit,
    onRequestQuit: confirmationHandlers.handleRequestQuit,
    onRequestClosePane: confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: handleToggleSessionPicker,
    onEnterSearch: handleEnterSearch,
    onToggleConsole: handleToggleConsole,
    onToggleAggregateView: handleToggleAggregateView,
  });
  const { handleKeyDown } = keyboardHandler;

  // Retry counter to trigger effect re-run when PTY creation fails
  const [ptyRetryCounter, setPtyRetryCounter] = createSignal(0);

  // Guard against concurrent PTY creation handled in usePtyLifecycle

  // Update viewport when terminal resizes
  createEffect(() => {
    const w = width();
    const h = height();
    if (w > 0 && h > 0) {
      // Reserve 1 row for status bar
      setViewport({ x: 0, y: 0, width: w, height: h - 1 });
    }
  });

  // Create first pane only if session loaded with no panes
  // Using on() for explicit dependency - only runs when sessionState.initialized changes
  createEffect(
    on(
      () => sessionState.initialized,
      (initialized) => {
        // Wait for session initialization
        if (!initialized) return;

        // Only create a pane if no panes exist after session load
        if (layout.panes.length === 0) {
          newPane('shell');
        }
      },
      { defer: true } // Skip initial run, wait for initialized to become true
    )
  );

  usePtyLifecycle({
    layout,
    terminal,
    sessionState,
    ptyRetryCounter,
    setPtyRetryCounter,
    pendingCwdRef,
    getSessionCwd: getSessionCwdFromCoordinator,
    markPtyCreated,
    isPtyCreated,
  });

  // Resize PTYs and update positions when layout structure or viewport changes
  // Use layoutVersion (structural changes) and viewport instead of panes
  // This avoids re-running on non-structural changes like ptyId/title updates
  createEffect(() => {
    if (!terminal.isInitialized) return;
    // Track structural changes (pane add/remove, layout mode) and viewport resize
    const _version = layout.layoutVersion;
    const _viewport = layout.state.viewport;
    // Defer to macrotask (setTimeout) to allow animations to complete first
    // queueMicrotask runs before render, setTimeout runs after
    setTimeout(() => paneResizeHandlers.resizeAllPanes(), 0);
  });

  // Restore PTY sizes when aggregate view closes
  // The preview resizes PTYs to preview dimensions, so we need to restore pane dimensions
  // Using on() for explicit dependency - only runs when showAggregateView changes
  createEffect(
    on(
      () => aggregateState.showAggregateView,
      (isOpen, wasOpen) => {
        // Only trigger resize when closing (was open, now closed)
        if (wasOpen && !isOpen && terminal.isInitialized) {
          paneResizeHandlers.restorePaneSizes();
        }
      },
      { defer: true } // Skip initial run - we only care about transitions
    )
  );

  useAppKeyboardInput({
    keyboardHandler: { mode: keyboardHandler.mode, handleKeyDown },
    sessionPickerVisible: () => sessionState.showSessionPicker,
    clearAllSelections,
    getFocusedCursorKeyMode,
    writeToFocused,
    handleSearchKeyboard,
    routeKeyboardEventSync,
    exitSearchMode,
    keyboardExitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState: () => search.searchState,
    processNormalModeKey,
  });

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
      <AggregateView width={width()} height={height()} onRequestQuit={confirmationHandlers.handleRequestQuit} onRequestKillPty={confirmationHandlers.handleRequestKillPty} />

      {/* Confirmation dialog */}
      <ConfirmationDialog
        visible={confirmationState().visible}
        type={confirmationState().type}
        width={width()}
        height={height()}
        onConfirm={confirmationHandlers.handleConfirmAction}
        onCancel={confirmationHandlers.handleCancelConfirmation}
      />

      {/* Copy notification toast */}
      <CopyNotification
        visible={selection.copyNotification.visible}
        charCount={selection.copyNotification.charCount}
        paneRect={getCopyNotificationRect({
          ptyId: selection.copyNotification.ptyId,
          showAggregateView: aggregateState.showAggregateView,
          selectedPtyId: aggregateState.selectedPtyId,
          width: width(),
          height: height(),
          panes: layout.panes,
        })}
      />
    </box>
  );
}

function AppWithTerminal() {
  return (
    <TitleProvider>
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
    </TitleProvider>
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
