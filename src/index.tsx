/**
 * openmux - Terminal multiplexer with BSP layout
 *
 * Entry point for the application
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App';

async function main() {
  try {
    // Create OpenTUI renderer - exclude SIGINT so Ctrl+C goes to PTY
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT'], // No SIGINT
    });

    // Render the app
    createRoot(renderer).render(<App />);
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
