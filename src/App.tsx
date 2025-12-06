/**
 * Main App component for openmux
 */

import { useEffect, useCallback, useRef } from 'react';
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
import { PaneContainer, StatusBar, KeyboardHints } from './components';
import { inputHandler } from './terminal';

function AppContent() {
  const { width, height } = useTerminalDimensions();
  const { dispatch, activeWorkspace, panes } = useLayout();
  const { createPTY, resizePTY, setPanePosition, writeToFocused, writeToPTY, pasteToFocused, getFocusedCwd, isInitialized } = useTerminal();
  const renderer = useRenderer();

  // Track pending CWD for new panes (captured before NEW_PANE dispatch)
  const pendingCwdRef = useRef<string | null>(null);

  // Create new pane handler that captures CWD first
  const handleNewPane = useCallback(async () => {
    // Capture the focused pane's CWD before creating the new pane
    const cwd = await getFocusedCwd();
    pendingCwdRef.current = cwd;
    dispatch({ type: 'NEW_PANE' });
  }, [dispatch, getFocusedCwd]);

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = useCallback(() => {
    pasteToFocused();
  }, [pasteToFocused]);

  // Quit handler - properly cleanup terminal before exiting
  const handleQuit = useCallback(() => {
    renderer.destroy();
    process.exit(0);
  }, [renderer]);

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

  const { handleKeyDown, mode } = useKeyboardHandler({ onPaste: handlePaste, onNewPane: handleNewPane, onQuit: handleQuit });

  // Track which panes have PTYs created
  const panesPtyCreated = useRef<Set<string>>(new Set());

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

    for (const pane of panes) {
      if (!pane.ptyId && !panesPtyCreated.current.has(pane.id)) {
        panesPtyCreated.current.add(pane.id);

        // Calculate pane dimensions (account for border)
        const rect = pane.rectangle ?? { width: 80, height: 24 };
        const cols = Math.max(1, rect.width - 2);
        const rows = Math.max(1, rect.height - 2);

        // Use the pending CWD if available (from a previous pane)
        const cwd = pendingCwdRef.current ?? undefined;
        pendingCwdRef.current = null; // Clear after use

        try {
          createPTY(pane.id, cols, rows, cwd);
        } catch (err) {
          console.error(`Failed to create PTY for pane ${pane.id}:`, err);
        }
      }
    }
  }, [isInitialized, panes, createPTY]);

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
        // First, check if this is a multiplexer command
        const handled = handleKeyDown({
          key: event.name,
          ctrl: event.ctrl,
          shift: event.shift,
          alt: event.option, // OpenTUI uses 'option' for Alt key
          meta: event.meta,
        });

        // If not handled by multiplexer and in normal mode, forward to PTY
        if (!handled && mode === 'normal') {
          // Convert keyboard event to terminal escape sequence
          const sequence = inputHandler.encodeKey({
            key: event.name,
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
      [handleKeyDown, mode, writeToFocused]
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
    </box>
  );
}

function AppWithTerminal() {
  return (
    <TerminalProvider>
      <AppContent />
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
