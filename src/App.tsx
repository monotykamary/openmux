/**
 * Main App component for openmux
 */

import { createSignal, createEffect, createMemo, onCleanup, onMount, on } from 'solid-js';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/solid';
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
import { inputHandler } from './terminal';
import type { PasteEvent } from '@opentui/core';
import {
  createConfirmationHandlers,
  createPaneResizeHandlers,
  createPasteHandler,
} from './components/app';
import { calculateLayoutDimensions } from './components/aggregate';
import { setFocusedPty, setClipboardPasteHandler } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';

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

  // Track pending CWD for new panes (captured before NEW_PANE dispatch)
  let pendingCwd: string | null = null;

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
    // Dispose Effect runtime to cleanup services
    await disposeRuntime();
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

  // Guard against concurrent PTY creation (synchronous Set for O(1) check)
  const pendingPtyCreation = new Set<string>();

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

  // Memoize pane IDs that need PTYs - only changes when panes are added/removed
  // or when a pane's ptyId status changes. This prevents re-triggering PTY creation
  // when unrelated pane properties change (rectangle, cursor position, etc.)
  const panesNeedingPtys = createMemo(() =>
    layout.panes.filter(p => !p.ptyId).map(p => ({ id: p.id, rectangle: p.rectangle }))
  );

  // Create PTYs for panes that don't have one
  // IMPORTANT: Wait for BOTH terminal AND session to be initialized
  // This prevents creating PTYs before session has a chance to restore workspaces
  // Also skip while session is switching to avoid creating PTYs for stale panes
  // Using on() for explicit dependency tracking - only re-runs when these specific values change
  createEffect(
    on(
      [
        () => terminal.isInitialized,
        () => sessionState.initialized,
        () => sessionState.switching,
        ptyRetryCounter,
        panesNeedingPtys,
      ],
      ([isTerminalInit, isSessionInit, isSwitching, _retry, panes]) => {
        if (!isTerminalInit) return;
        if (!isSessionInit) return;
        if (isSwitching) return;

        let hadFailure = false;

        const createPtysForPanes = async () => {
          for (const pane of panes) {
            // SYNCHRONOUS guard: check and add to pendingPtyCreation Set IMMEDIATELY
            // This prevents race conditions where concurrent effect runs both pass the check
            if (pendingPtyCreation.has(pane.id)) {
              continue;
            }
            // Add to set synchronously BEFORE any async work
            pendingPtyCreation.add(pane.id);

            try {
              // ASYNC check: verify PTY wasn't created in a previous session/effect run
              const alreadyCreated = await isPtyCreated(pane.id);
              if (alreadyCreated) {
                // Already has a PTY, skip creation
                continue;
              }

              // Calculate pane dimensions (account for border)
              const rect = pane.rectangle ?? { width: 80, height: 24 };
              const cols = Math.max(1, rect.width - 2);
              const rows = Math.max(1, rect.height - 2);

              // Check for session-restored CWD first, then pending CWD from new pane,
              // then OPENMUX_ORIGINAL_CWD (set by wrapper to preserve user's cwd)
              const sessionCwd = await getSessionCwdFromCoordinator(pane.id);
              let cwd = sessionCwd ?? pendingCwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? undefined;
              pendingCwd = null; // Clear after use

              // Mark as created BEFORE calling createPTY (persistent marker)
              await markPtyCreated(pane.id);
              await createPTY(pane.id, cols, rows, cwd);
            } catch (err) {
              console.error(`Failed to create PTY for pane ${pane.id}:`, err);
              hadFailure = true;
            } finally {
              // Always remove from pending set when done (success or failure)
              pendingPtyCreation.delete(pane.id);
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
      }
    )
  );

  // Resize PTYs and update positions when pane dimensions change
  createEffect(() => {
    if (!terminal.isInitialized) return;
    // Access layout.panes to create reactive dependency
    const _panes = layout.panes;
    paneResizeHandlers.resizeAllPanes();
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
        paneRect={(() => {
          const ptyId = selection.copyNotification.ptyId;
          if (!ptyId) return null;

          // If aggregate view is open and showing this pty, use the preview rectangle
          if (aggregateState.showAggregateView && aggregateState.selectedPtyId === ptyId) {
            const aggLayout = calculateLayoutDimensions({ width: width(), height: height() });
            return {
              x: aggLayout.listPaneWidth,
              y: 0,
              width: aggLayout.previewPaneWidth,
              height: aggLayout.contentHeight,
            };
          }

          // Otherwise use the normal pane rectangle
          return layout.panes.find(p => p.ptyId === ptyId)?.rectangle ?? null;
        })()}
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
