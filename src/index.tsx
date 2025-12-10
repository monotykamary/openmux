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

    // Render the app
    createRoot(renderer).render(<App />);
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
