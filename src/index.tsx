/**
 * Terminal multiplexer with master-stack layout
 */

import * as errore from 'errore';
import { getCliVersion } from './cli/version';

/** Error during application startup */
export class StartupError extends errore.createTaggedError({
  name: 'StartupError',
  message: 'Failed to start openmux: $reason',
}) {}

/** Error writing startup error log */
export class StartupLogError extends errore.createTaggedError({
  name: 'StartupLogError',
  message: 'Failed to write startup error log: $reason',
}) {}

async function handleCliFlags(): Promise<boolean> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    const version = await getCliVersion();
    console.log(version);
    return true;
  }
  return false;
}

async function runShimIfRequested(): Promise<boolean> {
  if (!process.argv.includes('--shim')) {
    return false;
  }

  const { runShim } = await import('./shim/main');
  await runShim();
  return true;
}

async function initializeAndRender(): Promise<StartupError | void> {
  const { initializeServices } = await import('./effect/services');
  const { setServices } = await import('./effect/bridge/services-instance');
  const services = await initializeServices();
  if (services instanceof Error) {
    return new StartupError({ reason: `Failed to initialize services: ${services.message}` });
  }
  setServices(services);

  const { render, useRenderer } = await import('@opentui/solid');
  const { ConsolePosition } = await import('@opentui/core');
  const { App } = await import('./App');
  const { detectHostCapabilities } = await import('./terminal');
  const { onMount, onCleanup } = await import('solid-js');
  const { createPasteInterceptingStdin } = await import('./terminal/paste-intercepting-stdin');
  const { triggerClipboardPaste } = await import('./terminal/focused-pty-registry');
  const { setHostSequenceWriter, writeHostSequence } = await import('./terminal/host-output');
  const { copyToClipboard } = await import('./effect/bridge');

  function AppWithSetup() {
    const renderer = useRenderer() as unknown as {
      enableKittyKeyboard(flags: number): void;
      stdout?: NodeJS.WriteStream & { _handle?: { flush?(): void } | null };
      realStdoutWrite?: (data: string, cb?: (err?: Error | null) => void) => void;
    };

    onMount(() => {
      setHostSequenceWriter((sequence: string) => {
        // realStdoutWrite is an unbound reference to stdout.write stored by
        // OpenTUI's constructor (this.realStdoutWrite = stdout.write). It MUST
        // be called with .call(stdout, ...) so that `this._write` resolves.
        const stdout = renderer.stdout ?? process.stdout;
        const writeOut = renderer.realStdoutWrite ?? stdout.write.bind(stdout);
        writeOut.call(stdout, sequence);
        if (stdout.isTTY) {
          (stdout as { _handle?: { flush?(): void } | null })._handle?.flush?.();
        }
      });
      renderer.enableKittyKeyboard(3);
      writeHostSequence('\x1b[=3;1u');
      writeHostSequence('\x1b[?1004h');
      writeHostSequence('\x1b[?2031h');
    });

    onCleanup(() => {
      writeHostSequence('\x1b[?1004l');
      writeHostSequence('\x1b[?2031l');
      setHostSequenceWriter(null);
    });

    return <App />;
  }

  const hostCaps = await detectHostCapabilities();
  const useThreadEnv = (process.env.OPENMUX_RENDER_USE_THREAD ?? '').toLowerCase();
  const useThread =
    useThreadEnv === '1' || useThreadEnv === 'true'
      ? true
      : useThreadEnv === '0' || useThreadEnv === 'false'
        ? false
        : !hostCaps.kittyGraphics;

  const interceptingStdin = createPasteInterceptingStdin(process.stdin, {
    onPasteTriggered: () => {
      triggerClipboardPaste();
    },
  });

  const renderResult = await errore.tryAsync<void, StartupError>({
    try: async () => {
      await render(() => <AppWithSetup />, {
        // @ts-expect-error PassThrough with TTY properties is compatible with OpenTUI's stdin
        stdin: interceptingStdin,
        exitOnCtrlC: false,
        exitSignals: ['SIGTERM', 'SIGQUIT', 'SIGABRT'],
        useMouse: true,
        enableMouseMovement: true,
        consoleMode: 'console-overlay',
        useKittyKeyboard: { events: true },
        useThread,
        consoleOptions: {
          position: ConsolePosition.BOTTOM,
          sizePercent: 30,
          // Enable copying from console using our clipboard service
          onCopySelection: async (text: string) => {
            await copyToClipboard(text);
          },
        },
      });
    },
    catch: (e) =>
      new StartupError({ reason: e instanceof Error ? e.message : String(e), cause: e }),
  });

  return renderResult instanceof StartupError ? renderResult : undefined;
}

async function writeStartupErrorLog(error: unknown): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const base = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  const dir = path.join(base, 'openmux');
  const logPath = path.join(dir, 'startup-error.log');
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  const mkdirResult = errore.try<void, StartupLogError>({
    try: () => fs.mkdirSync(dir, { recursive: true }),
    catch: (e: unknown) => new StartupLogError({ reason: String(e), cause: e }),
  });
  if (mkdirResult instanceof StartupLogError) return;

  errore.try<void, StartupLogError>({
    try: () => fs.writeFileSync(logPath, `${message}\n`, 'utf8'),
    catch: (e: unknown) => new StartupLogError({ reason: 'Write failed', cause: e }),
  });
}

async function main() {
  if (await handleCliFlags()) {
    return;
  }
  if (await runShimIfRequested()) {
    return;
  }

  const { runCli } = await import('./cli');
  const cliOutcome = await runCli(process.argv.slice(2));
  if (cliOutcome.kind === 'handled') {
    process.exitCode = cliOutcome.exitCode;
    return;
  }
  if (cliOutcome.kind === 'attach' && cliOutcome.session) {
    process.env.OPENMUX_START_SESSION = cliOutcome.session;
  }

  const result = await initializeAndRender();
  if (result instanceof StartupError) {
    console.error('Failed to start openmux:', result);
    await writeStartupErrorLog(result);
    process.exit(1);
  }
}

main();
