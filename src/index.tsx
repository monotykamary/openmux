/**
 * Terminal multiplexer with master-stack layout
 */

async function runShimIfRequested(): Promise<boolean> {
  if (!process.argv.includes('--shim')) {
    return false;
  }

  const { runShim } = await import('./shim/main');
  await runShim();
  return true;
}

async function main() {
  if (await runShimIfRequested()) {
    return;
  }

  const { render, useRenderer } = await import('@opentui/solid');
  const { ConsolePosition } = await import('@opentui/core');
  const { App } = await import('./App');
  const { detectHostCapabilities } = await import('./terminal');
  const { onMount } = await import('solid-js');
  const { createPasteInterceptingStdin } = await import('./terminal/paste-intercepting-stdin');
  const { triggerClipboardPaste } = await import('./terminal/focused-pty-registry');

  // Wrapper component that handles kitty keyboard setup after render
  function AppWithSetup() {
    const renderer = useRenderer();

    onMount(() => {
      // Enable kitty keyboard protocol AFTER renderer setup
      // Flag 1 = disambiguate escape codes (detect Alt+key without breaking regular input)
      // Flag 2 = report key releases/repeats
      // Flag 8 was too aggressive - it reports ALL keys as escape codes, breaking shift
      // Must be done after createCliRenderer since setupTerminal() resets modes
      // See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
      renderer.enableKittyKeyboard(3);
      // Use set mode to ensure report_events is enabled in Ghostty.
      const stdout = (renderer as any).stdout ?? process.stdout;
      const writeOut = (renderer as any).realStdoutWrite ?? stdout.write.bind(stdout);
      writeOut.call(stdout, '\x1b[=3;1u');
      // Force flush
      if (stdout.isTTY) {
        (stdout as any)._handle?.flush?.();
      }
    });

    return <App />;
  }

  try {
    // Prime host capabilities (including color query) before the renderer takes over stdin
    const hostCaps = await detectHostCapabilities();
    const useThreadEnv = (process.env.OPENMUX_RENDER_USE_THREAD ?? '').toLowerCase();
    const useThread =
      useThreadEnv === '1' || useThreadEnv === 'true'
        ? true
        : useThreadEnv === '0' || useThreadEnv === 'false'
          ? false
          : !hostCaps.kittyGraphics;

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
      useKittyKeyboard: { events: true },
      useThread,
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
