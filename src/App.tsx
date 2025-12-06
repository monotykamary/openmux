/**
 * Main App component for openmux
 */

import { useEffect, useCallback } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { ThemeProvider, LayoutProvider, KeyboardProvider, useLayout, useKeyboardHandler } from './contexts';
import { PaneContainer, StatusBar, KeyboardHints } from './components';

function AppContent() {
  const { width, height } = useTerminalDimensions();
  const { dispatch } = useLayout();
  const { handleKeyDown, mode } = useKeyboardHandler();

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
      type: 'CREATE_FIRST_PANE',
      title: 'shell',
    });
  }, [dispatch]);

  // Handle keyboard input
  useKeyboard(
    useCallback(
      (event: { name: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => {
        handleKeyDown({
          key: event.name,
          ctrl: event.ctrl,
          shift: event.shift,
          alt: event.alt,
          meta: event.meta,
        });
      },
      [handleKeyDown]
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

export function App() {
  return (
    <ThemeProvider>
      <LayoutProvider>
        <KeyboardProvider>
          <AppContent />
        </KeyboardProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
