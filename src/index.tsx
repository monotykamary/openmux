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
    // Create OpenTUI renderer
    const renderer = await createCliRenderer();

    // Render the app
    createRoot(renderer).render(<App />);

    // Handle clean shutdown
    process.on('SIGINT', () => {
      renderer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      renderer.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start openmux:', error);
    process.exit(1);
  }
}

main();
