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
  useTerminal,
} from './contexts';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { PaneContainer, StatusBar, KeyboardHints } from './components';
import { SessionPicker } from './components/SessionPicker';
import { inputHandler } from './terminal';
import type { Workspace, WorkspaceId } from './core/types';

function AppContent() {
  const { width, height } = useTerminalDimensions();
  const { dispatch, activeWorkspace, panes, state: layoutState } = useLayout();
  const { createPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedCwd, getFocusedCursorKeyMode, isInitialized, destroyAllPTYs, getSessionCwd } = useTerminal();
  const { togglePicker, state: sessionState } = useSession();
  const renderer = useRenderer();

  // Track pending CWD for new panes (captured before NEW_PANE dispatch)
  const pendingCwdRef = useRef<string | null>(null);

  // Session management
  const { saveSession } = useSession();

  // Create new pane handler that captures CWD first
  const handleNewPane = useCallback(async () => {
    // Capture the focused pane's CWD before creating the new pane
    const cwd = await getFocusedCwd();
    pendingCwdRef.current = cwd;
    dispatch({ type: 'NEW_PANE' });
    // Save session after pane creation (debounced by the save logic)
    setTimeout(() => saveSession(), 500);
  }, [dispatch, getFocusedCwd, saveSession]);

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

  // Handle bracketed paste from host terminal (Cmd+V sends this)
  useEffect(() => {
    const handleBracketedPaste = (event: PasteEvent) => {
      // Write the pasted text directly to the focused pane's PTY
      const focusedPaneId = activeWorkspace.focusedPaneId;
      if (!focusedPaneId) return;

      // Find the focused pane's PTY ID
      let focusedPtyId: string | undefined;
      if (activeWorkspace.mainPane?.id === focusedPaneId) {
        focusedPtyId = activeWorkspace.mainPane.ptyId;
      } else {
        const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
        focusedPtyId = stackPane?.ptyId;
      }

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
    onToggleSessionPicker: handleToggleSessionPicker,
  });

  // Track which panes have PTYs created
  const panesPtyCreated = useRef<Set<string>>(new Set());

  // Retry counter to trigger effect re-run when PTY creation fails
  const [ptyRetryCounter, setPtyRetryCounter] = useState(0);

  // Register a function to clear PTY tracking (called when switching sessions)
  useEffect(() => {
    (globalThis as unknown as { __clearPtyTracking?: () => void }).__clearPtyTracking = () => {
      panesPtyCreated.current.clear();
    };
    return () => {
      delete (globalThis as unknown as { __clearPtyTracking?: () => void }).__clearPtyTracking;
    };
  }, []);

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

    for (const pane of panes) {
      if (!pane.ptyId && !panesPtyCreated.current.has(pane.id)) {
        // Calculate pane dimensions (account for border)
        const rect = pane.rectangle ?? { width: 80, height: 24 };
        const cols = Math.max(1, rect.width - 2);
        const rows = Math.max(1, rect.height - 2);

        // Check for session-restored CWD first, then pending CWD from new pane
        const sessionCwdMap = (globalThis as unknown as { __sessionCwdMap?: Map<string, string> }).__sessionCwdMap;
        let cwd = sessionCwdMap?.get(pane.id) ?? pendingCwdRef.current ?? undefined;
        pendingCwdRef.current = null; // Clear after use

        // Clear the pane's entry from session map after use
        sessionCwdMap?.delete(pane.id);

        try {
          createPTY(pane.id, cols, rows, cwd);
          // Only mark as created AFTER successful PTY creation
          // This allows retry on subsequent renders if creation fails
          panesPtyCreated.current.add(pane.id);
        } catch (err) {
          console.error(`Failed to create PTY for pane ${pane.id}:`, err);
          hadFailure = true;
        }
      }
    }

    // Schedule a retry if any PTY creation failed
    if (hadFailure) {
      const timeoutId = setTimeout(() => {
        setPtyRetryCounter(c => c + 1);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
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

  // Handle keyboard input
  useKeyboard(
    useCallback(
      (event: { name: string; ctrl?: boolean; shift?: boolean; option?: boolean; meta?: boolean; sequence?: string }) => {
        // If session picker is open, route keys to it and block all other input
        // This prevents alt+ and prefix+ commands from working in the background
        if (sessionState.showSessionPicker) {
          const sessionPickerHandler = (globalThis as unknown as { __sessionPickerKeyHandler?: (e: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }) => boolean }).__sessionPickerKeyHandler;
          if (sessionPickerHandler) {
            sessionPickerHandler({
              key: event.name,
              ctrl: event.ctrl,
              alt: event.option,
              shift: event.shift,
            });
          }
          // Always return when picker is open - don't let keys fall through to multiplexer
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
      [handleKeyDown, mode, writeToFocused, getFocusedCursorKeyMode, sessionState.showSessionPicker]
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
    </box>
  );
}

/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */
function SessionBridge({ children }: { children: React.ReactNode }) {
  const { dispatch: layoutDispatch, state: layoutState } = useLayout();
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
    (globalThis as unknown as { __clearPtyTracking?: () => void }).__clearPtyTracking?.();

    // Load workspaces into layout
    layoutDispatchRef.current({ type: 'LOAD_SESSION', workspaces, activeWorkspaceId });

    // Store cwdMap in globalThis for AppContent to use (for panes without restored PTYs)
    (globalThis as unknown as { __sessionCwdMap?: Map<string, string> }).__sessionCwdMap = cwdMap;
  }, []);

  const onBeforeSwitch = useCallback((currentSessionId: string) => {
    // Suspend PTYs for current session (save mapping, unsubscribe but don't destroy)
    suspendSessionRef.current(currentSessionId);
    layoutDispatchRef.current({ type: 'CLEAR_ALL' });
    // Clear PTY tracking
    (globalThis as unknown as { __clearPtyTracking?: () => void }).__clearPtyTracking?.();
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
    >
      {children}
    </SessionProvider>
  );
}

function AppWithTerminal() {
  return (
    <TerminalProvider>
      <SessionBridge>
        <AppContent />
      </SessionBridge>
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
