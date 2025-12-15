/**
 * Main App component for openmux
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
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
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AggregateViewProvider, useAggregateView } from './contexts/AggregateViewContext';
import { PaneContainer, StatusBar, KeyboardHints, CopyNotification, ConfirmationDialog } from './components';
import type { ConfirmationType } from './core/types';
import { SessionPicker } from './components/SessionPicker';
import { SearchOverlay } from './components/SearchOverlay';
import { AggregateView } from './components/AggregateView';
import { inputHandler } from './terminal';
import type { Workspace, WorkspaceId } from './core/types';
import { getFocusedPtyId } from './core/workspace-utils';
import {
  routeKeyboardEventSync,
  clearPtyTracking,
  markPtyCreated,
  isPtyCreated,
  setSessionCwdMap,
  getSessionCwd as getSessionCwdFromCoordinator,
} from './effect/bridge';

function AppContent() {
  const { width, height } = useTerminalDimensions();
  const { dispatch, activeWorkspace, panes, state: layoutState } = useLayout();
  const { createPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedCwd, getFocusedCursorKeyMode, isInitialized, destroyAllPTYs, getSessionCwd } = useTerminal();
  const { togglePicker, state: sessionState } = useSession();
  const { clearAllSelections, copyNotification } = useSelection();
  const { searchState, enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = useSearch();
  const { state: aggregateState, openAggregateView } = useAggregateView();
  const { dispatch: kbDispatch } = useKeyboardState();
  const renderer = useRenderer();

  // Track pending CWD for new panes (captured before NEW_PANE dispatch)
  const pendingCwdRef = useRef<string | null>(null);

  // Session management (for quit handler)
  const { saveSession } = useSession();

  // Confirmation dialog state
  const [confirmationState, setConfirmationState] = useState<{
    visible: boolean;
    type: ConfirmationType;
  }>({ visible: false, type: 'close_pane' });

  // Create new pane handler that captures CWD first
  const handleNewPane = useCallback(async () => {
    // Capture the focused pane's CWD before creating the new pane
    const cwd = await getFocusedCwd();
    pendingCwdRef.current = cwd;
    dispatch({ type: 'NEW_PANE' });
    // Session save is triggered automatically via layoutVersion change
  }, [dispatch, getFocusedCwd]);

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = useCallback(() => {
    pasteToFocused();
  }, [pasteToFocused]);

  // Quit handler - save session and cleanup terminal before exiting
  const handleQuit = useCallback(async () => {
    // Save the current session before quitting
    await saveSession();
    renderer.destroy();
    process.exit(0);
  }, [renderer, saveSession]);

  // Session picker toggle handler
  const handleToggleSessionPicker = useCallback(() => {
    togglePicker();
  }, [togglePicker]);

  // Toggle debug console
  const handleToggleConsole = useCallback(() => {
    renderer.console.toggle();
  }, [renderer]);

  // Search mode enter handler
  const handleEnterSearch = useCallback(async () => {
    // Clear any existing selection so it doesn't hide search highlights
    clearAllSelections();

    // Get the focused pane's PTY ID using centralized utility
    const focusedPtyId = getFocusedPtyId(activeWorkspace);
    if (focusedPtyId) {
      await enterSearchMode(focusedPtyId);
    }
  }, [activeWorkspace, enterSearchMode, clearAllSelections]);

  // Aggregate view toggle handler
  const handleToggleAggregateView = useCallback(() => {
    openAggregateView();
  }, [openAggregateView]);

  // Request close pane (show confirmation)
  const handleRequestClosePane = useCallback(() => {
    kbDispatch({ type: 'ENTER_CONFIRM_MODE', confirmationType: 'close_pane' });
    setConfirmationState({ visible: true, type: 'close_pane' });
  }, [kbDispatch]);

  // Request quit (show confirmation)
  const handleRequestQuit = useCallback(() => {
    kbDispatch({ type: 'ENTER_CONFIRM_MODE', confirmationType: 'exit' });
    setConfirmationState({ visible: true, type: 'exit' });
  }, [kbDispatch]);

  // Confirmation dialog handlers
  const handleConfirmAction = useCallback(async () => {
    const { type } = confirmationState;
    kbDispatch({ type: 'EXIT_CONFIRM_MODE' });
    setConfirmationState({ visible: false, type: 'close_pane' });

    if (type === 'close_pane') {
      dispatch({ type: 'CLOSE_PANE' });
    } else if (type === 'exit') {
      await saveSession();
      renderer.destroy();
      process.exit(0);
    }
  }, [confirmationState, kbDispatch, dispatch, saveSession, renderer]);

  const handleCancelConfirmation = useCallback(() => {
    kbDispatch({ type: 'EXIT_CONFIRM_MODE' });
    setConfirmationState({ visible: false, type: 'close_pane' });
  }, [kbDispatch]);

  // Handle bracketed paste from host terminal (Cmd+V sends this)
  useEffect(() => {
    const handleBracketedPaste = (event: PasteEvent) => {
      // Write the pasted text directly to the focused pane's PTY
      const focusedPtyId = getFocusedPtyId(activeWorkspace);
      if (focusedPtyId) {
        writeToPTY(focusedPtyId, event.text);
      }
    };

    renderer.keyInput.on('paste', handleBracketedPaste);
    return () => {
      renderer.keyInput.off('paste', handleBracketedPaste);
    };
  }, [renderer, activeWorkspace, writeToPTY]);

  const { handleKeyDown, mode } = useKeyboardHandler({
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

  // Retry counter to trigger effect re-run when PTY creation fails
  const [ptyRetryCounter, setPtyRetryCounter] = useState(0);

  // Update viewport when terminal resizes
  useEffect(() => {
    if (width > 0 && height > 0) {
      // Reserve 1 row for status bar
      dispatch({
        type: 'SET_VIEWPORT',
        viewport: { x: 0, y: 0, width, height: height - 1 },
      });
    }
  }, [width, height, dispatch]);

  // Create first pane on mount
  useEffect(() => {
    dispatch({
      type: 'NEW_PANE',
      title: 'shell',
    });
  }, [dispatch]);

  // Create PTYs for panes that don't have one
  useEffect(() => {
    if (!isInitialized) return;

    let hadFailure = false;

    const createPtysForPanes = async () => {
      for (const pane of panes) {
        const alreadyCreated = await isPtyCreated(pane.id);
        if (!pane.ptyId && !alreadyCreated) {
          // Calculate pane dimensions (account for border)
          const rect = pane.rectangle ?? { width: 80, height: 24 };
          const cols = Math.max(1, rect.width - 2);
          const rows = Math.max(1, rect.height - 2);

          // Check for session-restored CWD first, then pending CWD from new pane
          const sessionCwd = await getSessionCwdFromCoordinator(pane.id);
          let cwd = sessionCwd ?? pendingCwdRef.current ?? undefined;
          pendingCwdRef.current = null; // Clear after use

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
  }, [isInitialized, panes, createPTY, ptyRetryCounter]);

  // Resize PTYs and update positions when pane dimensions change
  useEffect(() => {
    if (!isInitialized) return;

    for (const pane of panes) {
      if (pane.ptyId && pane.rectangle) {
        const cols = Math.max(1, pane.rectangle.width - 2);
        const rows = Math.max(1, pane.rectangle.height - 2);
        resizePTY(pane.ptyId, cols, rows);
        // Update pane position for graphics passthrough (+1 for border)
        setPanePosition(pane.ptyId, pane.rectangle.x + 1, pane.rectangle.y + 1);
      }
    }
  }, [isInitialized, panes, resizePTY, setPanePosition]);

  // Track previous aggregate view state to detect close
  const prevShowAggregateView = useRef(aggregateState.showAggregateView);

  // Restore PTY sizes when aggregate view closes
  // The preview resizes PTYs to preview dimensions, so we need to restore pane dimensions
  useEffect(() => {
    const wasOpen = prevShowAggregateView.current;
    const isOpen = aggregateState.showAggregateView;
    prevShowAggregateView.current = isOpen;

    // Only trigger resize when closing (was open, now closed)
    if (wasOpen && !isOpen && isInitialized) {
      for (const pane of panes) {
        if (pane.ptyId && pane.rectangle) {
          const cols = Math.max(1, pane.rectangle.width - 2);
          const rows = Math.max(1, pane.rectangle.height - 2);
          resizePTY(pane.ptyId, cols, rows);
        }
      }
    }
  }, [aggregateState.showAggregateView, isInitialized, panes, resizePTY]);

  // Handle keyboard input
  useKeyboard(
    useCallback(
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
        if (mode === 'search') {
          const key = event.name.toLowerCase();

          if (key === 'escape') {
            // Cancel search, restore original scroll position
            exitSearchMode(true);
            kbDispatch({ type: 'EXIT_SEARCH_MODE' });
            return;
          }

          if (key === 'return' || key === 'enter') {
            // Confirm search, stay at current position
            exitSearchMode(false);
            kbDispatch({ type: 'EXIT_SEARCH_MODE' });
            return;
          }

          // Wait for searchState to be initialized before handling navigation/input
          if (!searchState) {
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
            setSearchQuery(searchState.query.slice(0, -1));
            return;
          }

          // Single printable character - add to search query
          const charCode = event.sequence?.charCodeAt(0) ?? 0;
          const isPrintable = event.sequence?.length === 1 && charCode >= 32 && charCode < 127;
          if (isPrintable && !event.ctrl && !event.option && !event.meta) {
            setSearchQuery(searchState.query + event.sequence);
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
        if (!handled && mode === 'normal' && !sessionState.showSessionPicker) {

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
          const charCode = event.sequence?.charCodeAt(0) ?? 0;
          const isPrintable = event.sequence?.length === 1 && charCode >= 32 && charCode < 127;
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
      },
      [handleKeyDown, mode, writeToFocused, getFocusedCursorKeyMode, clearAllSelections, searchState, exitSearchMode, nextMatch, prevMatch, setSearchQuery, kbDispatch]
    )
  );

  return (
    <box
      style={{
        width,
        height,
        flexDirection: 'column',
      }}
    >
      {/* Main pane area */}
      <PaneContainer />

      {/* Status bar at bottom */}
      <StatusBar width={width} />

      {/* Keyboard hints overlay */}
      <KeyboardHints width={width} height={height} />

      {/* Session picker overlay */}
      <SessionPicker width={width} height={height} />

      {/* Search overlay */}
      <SearchOverlay width={width} height={height} />

      {/* Aggregate view overlay */}
      <AggregateView width={width} height={height} />

      {/* Confirmation dialog */}
      <ConfirmationDialog
        visible={confirmationState.visible}
        type={confirmationState.type}
        width={width}
        height={height}
        onConfirm={handleConfirmAction}
        onCancel={handleCancelConfirmation}
      />

      {/* Copy notification toast */}
      <CopyNotification
        visible={copyNotification.visible}
        charCount={copyNotification.charCount}
        paneRect={
          copyNotification.ptyId
            ? panes.find(p => p.ptyId === copyNotification.ptyId)?.rectangle ?? null
            : null
        }
      />
    </box>
  );
}

/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */
function SessionBridge({ children }: { children: React.ReactNode }) {
  const { dispatch: layoutDispatch, state: layoutState, layoutVersion } = useLayout();
  const { createPTY, destroyAllPTYs, suspendSession, resumeSession, cleanupSessionPtys, getSessionCwd, isInitialized } = useTerminal();

  // Refs for stable callbacks
  const layoutStateRef = useRef(layoutState);
  const createPTYRef = useRef(createPTY);
  const destroyAllPTYsRef = useRef(destroyAllPTYs);
  const suspendSessionRef = useRef(suspendSession);
  const resumeSessionRef = useRef(resumeSession);
  const cleanupSessionPtysRef = useRef(cleanupSessionPtys);
  const getSessionCwdRef = useRef(getSessionCwd);
  const layoutDispatchRef = useRef(layoutDispatch);

  useEffect(() => {
    layoutStateRef.current = layoutState;
    createPTYRef.current = createPTY;
    destroyAllPTYsRef.current = destroyAllPTYs;
    suspendSessionRef.current = suspendSession;
    resumeSessionRef.current = resumeSession;
    cleanupSessionPtysRef.current = cleanupSessionPtys;
    getSessionCwdRef.current = getSessionCwd;
    layoutDispatchRef.current = layoutDispatch;
  }, [layoutState, createPTY, destroyAllPTYs, suspendSession, resumeSession, cleanupSessionPtys, getSessionCwd, layoutDispatch]);

  // Callbacks for SessionProvider
  const getCwd = useCallback(async (ptyId: string) => {
    return getSessionCwdRef.current(ptyId);
  }, []);

  const getWorkspaces = useCallback(() => {
    return layoutStateRef.current.workspaces;
  }, []);

  const getActiveWorkspaceId = useCallback(() => {
    return layoutStateRef.current.activeWorkspaceId;
  }, []);

  const onSessionLoad = useCallback(async (
    workspaces: Map<WorkspaceId, Workspace>,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    sessionId: string
  ) => {
    // Try to resume PTYs for this session (if we've visited it before)
    const restoredPtys = await resumeSessionRef.current(sessionId);

    // If we have restored PTYs, assign them to the panes
    if (restoredPtys && restoredPtys.size > 0) {
      for (const [, workspace] of workspaces) {
        if (workspace.mainPane) {
          const ptyId = restoredPtys.get(workspace.mainPane.id);
          if (ptyId) {
            workspace.mainPane.ptyId = ptyId;
          }
        }
        for (const pane of workspace.stackPanes) {
          const ptyId = restoredPtys.get(pane.id);
          if (ptyId) {
            pane.ptyId = ptyId;
          }
        }
      }
    }

    // Clear PTY tracking to allow new PTYs to be created for panes without restored PTYs
    await clearPtyTracking();

    // Load workspaces into layout
    layoutDispatchRef.current({ type: 'LOAD_SESSION', workspaces, activeWorkspaceId });

    // Store cwdMap in AppCoordinator for AppContent to use (for panes without restored PTYs)
    await setSessionCwdMap(cwdMap);
  }, []);

  const onBeforeSwitch = useCallback(async (currentSessionId: string) => {
    // Suspend PTYs for current session (save mapping, unsubscribe but don't destroy)
    suspendSessionRef.current(currentSessionId);
    layoutDispatchRef.current({ type: 'CLEAR_ALL' });
    // Clear PTY tracking
    await clearPtyTracking();
  }, []);

  const onDeleteSession = useCallback((sessionId: string) => {
    // Clean up PTYs for deleted session
    cleanupSessionPtysRef.current(sessionId);
  }, []);

  return (
    <SessionProvider
      getCwd={getCwd}
      getWorkspaces={getWorkspaces}
      getActiveWorkspaceId={getActiveWorkspaceId}
      onSessionLoad={onSessionLoad}
      onBeforeSwitch={onBeforeSwitch}
      onDeleteSession={onDeleteSession}
      layoutVersion={layoutVersion}
    >
      {children}
    </SessionProvider>
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
