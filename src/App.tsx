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
import type { PasteEvent } from '@opentui/core';
import {
  createConfirmationHandlers,
  createPaneResizeHandlers,
  createPasteHandler,
  handleSearchKeyboard,
  processNormalModeKey,
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
      if (cwd) pendingCwdRef = cwd;
    });

    // Create pane immediately (shows border instantly)
    // PTY will be created by the effect with CWD when available
    newPane();
  };

  // Ref for passing CWD to effect (avoids closure issues)
  let pendingCwdRef: string | null = null;

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

        const createPtyForPane = (pane: typeof panes[number]) => {
          try {
            // SYNC check: verify PTY wasn't created in a previous session/effect run
            const alreadyCreated = isPtyCreated(pane.id);
            if (alreadyCreated) {
              return true; // Already has a PTY
            }

            // Calculate pane dimensions (account for border)
            const rect = pane.rectangle ?? { width: 80, height: 24 };
            const cols = Math.max(1, rect.width - 2);
            const rows = Math.max(1, rect.height - 2);

            // Check for session-restored CWD first, then pending CWD from new pane handler,
            // then OPENMUX_ORIGINAL_CWD (set by wrapper to preserve user's cwd)
            const sessionCwd = getSessionCwdFromCoordinator(pane.id);
            let cwd = sessionCwd ?? pendingCwdRef ?? process.env.OPENMUX_ORIGINAL_CWD ?? undefined;
            pendingCwdRef = null; // Clear after use

            // Mark as created BEFORE calling createPTY (persistent marker)
            markPtyCreated(pane.id);

            // Fire-and-forget PTY creation - don't await to avoid blocking
            createPTY(pane.id, cols, rows, cwd).catch(err => {
              console.error(`PTY creation failed for ${pane.id}:`, err);
            });

            return true;
          } catch (err) {
            console.error(`Failed to create PTY for pane ${pane.id}:`, err);
            return false;
          } finally {
            pendingPtyCreation.delete(pane.id);
          }
        };

        // Collect panes that need PTY creation (synchronous guard)
        const panesToProcess: typeof panes[number][] = [];
        for (const pane of panes) {
          // SYNCHRONOUS guard: check and add to pendingPtyCreation Set IMMEDIATELY
          if (pendingPtyCreation.has(pane.id)) {
            continue;
          }
          pendingPtyCreation.add(pane.id);
          panesToProcess.push(pane);
        }

        // Single macrotask to process ALL panes - reduces scheduling overhead
        if (panesToProcess.length > 0) {
          setTimeout(() => {
            let anyFailed = false;
            for (const pane of panesToProcess) {
              const success = createPtyForPane(pane);
              if (!success) {
                anyFailed = true;
              }
            }
            // Single retry trigger if any failed
            if (anyFailed) {
              setTimeout(() => setPtyRetryCounter(c => c + 1), 100);
            }
          }, 0);
        }
      }
    )
  );

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
        handleSearchKeyboard(event, {
          exitSearchMode,
          keyboardExitSearchMode,
          setSearchQuery,
          nextMatch,
          prevMatch,
          getSearchState: () => search.searchState,
        });
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
        processNormalModeKey(event, {
          clearAllSelections,
          getFocusedCursorKeyMode,
          writeToFocused,
        });
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
