/**
 * Terminal multiplexer with master-stack layout
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';
import { detectHostCapabilities } from './terminal';

async function main() {
  try {
    // Prime host capabilities (including color query) before the renderer takes over stdin
    await detectHostCapabilities();

    // Create OpenTUI renderer - exclude SIGINT so Ctrl+C goes to PTY
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT'], // No SIGINT
      useMouse: true, // Enable mouse tracking to properly consume mouse escape sequences
      enableMouseMovement: true, // Track mouse movement for drag and hover events
    });

    // Enable kitty keyboard protocol AFTER renderer setup
    // Flag 8 = report all keys as escape codes (required for Shift+Enter)
    // Must be done after createCliRenderer since setupTerminal() resets modes
    // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
    // Note: We need BOTH the renderer call (to tell OpenTUI to parse kitty format)
    // AND the raw escape sequence (to tell Ghostty to send kitty format)
    renderer.enableKittyKeyboard(8);
    process.stdout.write('\x1b[>8u');
    // Force flush
    if (process.stdout.isTTY) {
      (process.stdout as any)._handle?.flush?.();
    }

    // Render the app
    createRoot(renderer).render(<App />);
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
