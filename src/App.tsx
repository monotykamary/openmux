/**
 * Main App component for openmux
 */

import { createSignal, createEffect, onCleanup, onMount, on } from 'solid-js';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/solid';
import {
  ConfigProvider,
  useConfig,
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
import { PaneContainer } from './components';
import type { ConfirmationType } from './core/types';
import { SessionBridge } from './components/SessionBridge';
import { getFocusedPtyId } from './core/workspace-utils';
import type { CommandPaletteCommand } from './core/command-palette';
import {
  routeKeyboardEventSync,
  onShimDetached,
  shutdownShim,
} from './effect/bridge';
import { disposeRuntime } from './effect/runtime';
import {
  createConfirmationHandlers,
  createPaneResizeHandlers,
  createPasteHandler,
  handleSearchKeyboard,
  processNormalModeKey,
} from './components/app';
import { setFocusedPty, setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';
import { handleNormalModeAction } from './contexts/keyboard/handlers';
import { createCommandPaletteState } from './components/app/command-palette-state';
import { normalizeKeyEvent, type OpenTuiKeyEvent } from './components/app/keyboard-utils';
import { usePtyCreation } from './components/app/pty-creation';
import { AppOverlays } from './components/app/AppOverlays';
import { createTemplatePendingActions } from './components/app/template-pending-actions';

function AppContent() {
  const config = useConfig();
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const { setViewport, newPane, closePane } = layout;
  // Don't destructure isInitialized - it's a reactive getter that loses reactivity when destructured
  const terminal = useTerminal();
  const { destroyPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedEmulator } = terminal;
  const session = useSession();
  const { togglePicker, toggleTemplateOverlay, state: sessionState, saveSession } = session;
  // Keep selection/search contexts to access reactive getters
  const selection = useSelection();
  const { clearAllSelections } = selection;
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const { state: aggregateState, openAggregateView } = useAggregateView();
  const keyboardState = useKeyboardState();
  const { enterConfirmMode, exitConfirmMode, exitSearchMode: keyboardExitSearchMode } = keyboardState;
  const renderer = useRenderer();
  let detaching = false;

  const { commandPaletteState, setCommandPaletteState, toggleCommandPalette } = createCommandPaletteState();

  // Quit handler - save session, shutdown shim, and cleanup terminal before exiting
  const handleQuit = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    await shutdownShim();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  // Detach handler - save session and exit without shutting down the shim
  const handleDetach = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };


  // Confirmation dialog state
  const [confirmationState, setConfirmationState] = createSignal<{
    visible: boolean;
    type: ConfirmationType;
  }>({ visible: false, type: 'close_pane' });

  // Track pending kill PTY ID for aggregate view kill confirmation
  const [pendingKillPtyId, setPendingKillPtyId] = createSignal<string | null>(null);

  const templatePending = createTemplatePendingActions();

  const handleConfirmTemplateApply = templatePending.confirmApply;
  const handleCancelTemplateApply = templatePending.cancelApply;
  const handleConfirmTemplateOverwrite = templatePending.confirmOverwrite;
  const handleCancelTemplateOverwrite = templatePending.cancelOverwrite;
  const handleConfirmTemplateDelete = templatePending.confirmDelete;
  const handleCancelTemplateDelete = templatePending.cancelDelete;

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
    onQuit: handleQuit,
    onConfirmApplyTemplate: handleConfirmTemplateApply,
    onCancelApplyTemplate: handleCancelTemplateApply,
    onConfirmOverwriteTemplate: handleConfirmTemplateOverwrite,
    onCancelOverwriteTemplate: handleCancelTemplateOverwrite,
    onConfirmDeleteTemplate: handleConfirmTemplateDelete,
    onCancelDeleteTemplate: handleCancelTemplateDelete,
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

    const unsubscribeDetached = onShimDetached(() => {
      if (detaching) return;
      detaching = true;
      renderer.destroy();
      process.exit(0);
    });

    onCleanup(() => {
      unsubscribeDetached();
    });
  });

  // Keep the focused PTY registry in sync with the current workspace focus
  createEffect(() => {
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    setFocusedPty(focusedPtyId ?? null);
  });

  const { handleNewPane } = usePtyCreation({
    layout,
    terminal,
    sessionState,
    newPane,
  });

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = () => {
    pasteToFocused();
  };

  // Session picker toggle handler
  const handleToggleSessionPicker = () => {
    togglePicker();
  };

  const handleToggleTemplateOverlay = () => {
    toggleTemplateOverlay();
  };

  const requestTemplateApplyConfirm = (applyTemplate: () => Promise<void>) => {
    templatePending.setPendingApply(() => applyTemplate);
    confirmationHandlers.handleRequestApplyTemplate();
  };

  const requestTemplateOverwriteConfirm = (overwriteTemplate: () => Promise<void>) => {
    templatePending.setPendingOverwrite(() => overwriteTemplate);
    confirmationHandlers.handleRequestOverwriteTemplate();
  };

  const requestTemplateDeleteConfirm = (deleteTemplate: () => Promise<void>) => {
    templatePending.setPendingDelete(() => deleteTemplate);
    confirmationHandlers.handleRequestDeleteTemplate();
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

  const executeCommandAction = (action: string) => {
    handleNormalModeAction(
      action,
      keyboardState,
      layout,
      layout.activeWorkspace.layoutMode,
      {
        onPaste: handlePaste,
        onNewPane: handleNewPane,
        onQuit: handleQuit,
        onDetach: handleDetach,
        onRequestQuit: confirmationHandlers.handleRequestQuit,
        onRequestClosePane: confirmationHandlers.handleRequestClosePane,
        onToggleSessionPicker: handleToggleSessionPicker,
        onToggleTemplateOverlay: handleToggleTemplateOverlay,
        onEnterSearch: handleEnterSearch,
        onToggleConsole: handleToggleConsole,
        onToggleAggregateView: handleToggleAggregateView,
        onToggleCommandPalette: toggleCommandPalette,
      }
    );
  };

  const handleCommandPaletteExecute = (command: CommandPaletteCommand) => {
    executeCommandAction(command.action);
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
    onDetach: handleDetach,
    onRequestQuit: confirmationHandlers.handleRequestQuit,
    onRequestClosePane: confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: handleToggleSessionPicker,
    onToggleTemplateOverlay: handleToggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onToggleConsole: handleToggleConsole,
    onToggleAggregateView: handleToggleAggregateView,
    onToggleCommandPalette: toggleCommandPalette,
  });
  const { handleKeyDown } = keyboardHandler;

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

  // Resize PTYs and update positions when layout structure or terminal size changes
  // Use layoutVersion (structural changes) and terminal dimensions instead of panes
  // This avoids re-running on non-structural changes like ptyId/title updates
  createEffect(() => {
    if (!terminal.isInitialized) return;
    // Track structural changes (pane add/remove, layout mode) and viewport resize
    layout.layoutVersion;
    const _width = width();
    const _height = height();
    if (_width <= 0 || _height <= 0) return;
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

  // Handle keyboard input
  useKeyboard(
    (event: OpenTuiKeyEvent) => {
      const normalizedEvent = normalizeKeyEvent(event);
      // Route to overlays via KeyboardRouter (handles confirmation, session picker, aggregate view)
      // Use event.sequence for printable chars (handles shift for uppercase/symbols)
      // Fall back to event.name for special keys
      const charCode = normalizedEvent.sequence?.charCodeAt(0) ?? 0;
      const isPrintableChar = normalizedEvent.sequence?.length === 1 && charCode >= 32 && charCode < 127;
      const keyToPass = isPrintableChar ? normalizedEvent.sequence! : normalizedEvent.key;

      const routeResult = routeKeyboardEventSync({
        key: keyToPass,
        ctrl: normalizedEvent.ctrl,
        alt: normalizedEvent.alt,
        shift: normalizedEvent.shift,
        sequence: normalizedEvent.sequence,
        baseCode: normalizedEvent.baseCode,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If an overlay handled the key, don't process further
      if (routeResult.handled) {
        return;
      }

      // If in search mode, handle search-specific keys
      if (keyboardHandler.mode === 'search') {
        handleSearchKeyboard(normalizedEvent, {
          exitSearchMode,
          keyboardExitSearchMode,
          setSearchQuery,
          nextMatch,
          prevMatch,
          getSearchState: () => search.searchState,
          keybindings: config.keybindings().search,
        });
        return;
      }

      // First, check if this is a multiplexer command
      const handled = handleKeyDown({
        key: normalizedEvent.key,
        ctrl: normalizedEvent.ctrl,
        shift: normalizedEvent.shift,
        alt: normalizedEvent.alt,
        meta: normalizedEvent.meta,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If not handled by multiplexer and in normal mode, forward to PTY
      if (!handled && keyboardHandler.mode === 'normal' && !sessionState.showSessionPicker && !session.showTemplateOverlay) {
        processNormalModeKey(normalizedEvent, {
          clearAllSelections,
          getFocusedEmulator,
          writeToFocused,
          closePane,
        });
      }
    },
    { release: true }
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

      <AppOverlays
        width={width()}
        height={height()}
        commandPaletteState={commandPaletteState}
        setCommandPaletteState={setCommandPaletteState}
        onCommandPaletteExecute={handleCommandPaletteExecute}
        confirmationState={confirmationState}
        onConfirm={confirmationHandlers.handleConfirmAction}
        onCancel={confirmationHandlers.handleCancelConfirmation}
        onRequestApplyConfirm={requestTemplateApplyConfirm}
        onRequestOverwriteConfirm={requestTemplateOverwriteConfirm}
        onRequestDeleteConfirm={requestTemplateDeleteConfirm}
        onRequestQuit={confirmationHandlers.handleRequestQuit}
        onDetach={handleDetach}
        onRequestKillPty={confirmationHandlers.handleRequestKillPty}
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
    <ConfigProvider>
      <ConfiguredApp />
    </ConfigProvider>
  );
}

function ConfiguredApp() {
  const config = useConfig();
  const currentConfig = () => config.config();

  return (
    <ThemeProvider theme={currentConfig().theme}>
      <LayoutProvider config={currentConfig().layout}>
        <KeyboardProvider>
          <AppWithTerminal />
        </KeyboardProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
