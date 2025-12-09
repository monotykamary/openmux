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

    // Render the app
    createRoot(renderer).render(<App />);
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
