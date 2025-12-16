/**
 * Terminal multiplexer with master-stack layout
 */

import { render, useRenderer } from '@opentui/solid';
import { ConsolePosition } from '@opentui/core';
import { App } from './App';
import { detectHostCapabilities } from './terminal';
import { onMount } from 'solid-js';

// Wrapper component that handles kitty keyboard setup after render
function AppWithSetup() {
  const renderer = useRenderer();

  onMount(() => {
    // Enable kitty keyboard protocol AFTER renderer setup
    // Flag 1 = disambiguate escape codes (detect Alt+key without breaking regular input)
    // Flag 8 was too aggressive - it reports ALL keys as escape codes, breaking shift
    // Must be done after createCliRenderer since setupTerminal() resets modes
    // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
    renderer.enableKittyKeyboard(1);
    process.stdout.write('\x1b[>1u');
    // Force flush
    if (process.stdout.isTTY) {
      (process.stdout as any)._handle?.flush?.();
    }
  });

  return <App />;
}

async function main() {
  try {
    // Prime host capabilities (including color query) before the renderer takes over stdin
    await detectHostCapabilities();

    // Render the app with Solid - render creates the renderer internally
    await render(() => <AppWithSetup />, {
      exitOnCtrlC: false,
      exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT'], // No SIGINT - let Ctrl+C go to PTY
      useMouse: true, // Enable mouse tracking to properly consume mouse escape sequences
      enableMouseMovement: true, // Track mouse movement for drag and hover events
      useConsole: true, // Enable debug console (toggle with prefix + `)
      consoleOptions: {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      },
    });
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
