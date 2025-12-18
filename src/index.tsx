/**
 * Terminal multiplexer with master-stack layout
 */

import { render, useRenderer } from '@opentui/solid';
import { ConsolePosition } from '@opentui/core';
import { App } from './App';
import { detectHostCapabilities } from './terminal';
import { onMount } from 'solid-js';
import { createPasteInterceptingStdin } from './terminal/paste-intercepting-stdin';
import { triggerClipboardPaste } from './terminal/focused-pty-registry';

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

    // Create paste-intercepting stdin wrapper
    // This intercepts bracketed paste sequences at the raw Buffer level (before UTF-8 encoding)
    // and triggers clipboard read instead of using unreliable stdin paste data
    const interceptingStdin = createPasteInterceptingStdin(
      process.stdin,
      {
        onPasteTriggered: () => {
          // Trigger clipboard read and PTY write
          // App.tsx registers the handler which:
          // - Reads from system clipboard (always complete, no chunking issues)
          // - Checks if child app has mode 2004 enabled
          // - Wraps with bracketed paste markers if needed
          // - Writes atomically to PTY
          triggerClipboardPaste();
        },
      }
    );

    // Render the app with Solid - render creates the renderer internally
    await render(() => <AppWithSetup />, {
      stdin: interceptingStdin,
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
