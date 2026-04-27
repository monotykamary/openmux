/**
 * PTY Session Factory - creates new PTY sessions with all required components (errore version)
 */
import path from 'node:path';
import * as errore from 'errore';
import { spawnAsync } from '../../../../native/zig-pty/ts/index';
import { createGhosttyVTEmulator } from '../../../terminal/ghostty-vt/emulator';
import { TerminalQueryPassthrough } from '../../../terminal/terminal-query-passthrough';
import { createSyncModeParser } from '../../../terminal/sync-mode-parser';
import { getCapabilityEnvironment } from '../../../terminal/capabilities';
import { createCommandParser } from '../../../terminal/command-parser';
import { PtySpawnError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import { makePtyId } from '../../types';
import type { InternalPtySession } from './types';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import { tracePtyEvent } from '../../../terminal/pty-trace';
import { sendMacOsNotification } from '../../../terminal/desktop-notifications';
import { forwardNotification } from '../../../shim/notification-forwarder';
import { notifySubscribers } from './notification';
import { createDataHandler } from './data-handler';
import { setupQueryPassthrough } from './query-setup';
import { prepareShellIntegration } from './shell-integration';
import { ScrollbackArchive } from '../../../terminal/scrollback-archive';
import type { ScrollbackArchiveManager } from '../../../terminal/scrollback-archive';
import { ScrollbackArchiver } from './scrollback-archiver';
import { getConfigDir } from '../../../core/user-config';

function defaultCellWidth(): number {
  return 8;
}

function defaultCellHeight(): number {
  return 16;
}

export interface SessionFactoryDeps {
  colors: TerminalColors;
  defaultShell: string;
  scrollbackArchiveManager: ScrollbackArchiveManager;
  scrollbackArchiveRoot?: string;
  onLifecycleEvent: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void;
  onTitleChange: (ptyId: PtyId, title: string) => void;
  onActivity: (ptyId: PtyId) => void;
  onForegroundProcessChange: (ptyId: PtyId, processName: string) => void;
  onCwdChange: (ptyId: PtyId, cwd: string) => void;
  onExit?: (ptyId: PtyId, exitCode: number) => void;
  /** Clipboard writer injected from bridge — avoids circular dep in data-handler */
  copyToClipboard: (text: string) => Promise<boolean>;
}

export interface CreateSessionOptions {
  cols: Cols;
  rows: Rows;
  cwd?: string;
  env?: Record<string, string>;
  pixelWidth?: number;
  pixelHeight?: number;
}

/**
 * Creates a new PTY session with emulator, graphics passthrough, and query handling
 */
export async function createSession(
  deps: SessionFactoryDeps,
  options: CreateSessionOptions
): Promise<{ id: PtyId; session: InternalPtySession } | PtySpawnError> {
  const id = makePtyId();
  const cols = options.cols;
  const rows = options.rows;
  const hasPixels =
    typeof options.pixelWidth === 'number' &&
    options.pixelWidth > 0 &&
    typeof options.pixelHeight === 'number' &&
    options.pixelHeight > 0;
  const pixelWidth = hasPixels ? options.pixelWidth : undefined;
  const pixelHeight = hasPixels ? options.pixelHeight : undefined;
  const cellWidth = hasPixels
    ? Math.max(1, Math.floor((pixelWidth ?? 0) / cols))
    : defaultCellWidth();
  const cellHeight = hasPixels
    ? Math.max(1, Math.floor((pixelHeight ?? 0) / rows))
    : defaultCellHeight();
  const cwd = options.cwd ?? process.cwd();
  const shell = deps.defaultShell;
  const shellName = shell.split('/').pop() ?? '';

  // Create native emulator (libghostty-vt) with errore error handling
  const emulatorResult = errore.try<ReturnType<typeof createGhosttyVTEmulator>, PtySpawnError>({
    try: () => createGhosttyVTEmulator(cols, rows, deps.colors),
    catch: (error) => new PtySpawnError({ shell, cwd, reason: String(error), cause: error }),
  });
  if (emulatorResult instanceof PtySpawnError) {
    return emulatorResult;
  }
  const liveEmulator = emulatorResult;
  liveEmulator.setUpdateEnabled?.(false);

  const scrollbackRoot =
    deps.scrollbackArchiveRoot ??
    process.env.OPENMUX_SCROLLBACK_ARCHIVE_DIR ??
    path.join(getConfigDir(), 'scrollback');
  const scrollbackArchive = new ScrollbackArchive({
    rootDir: path.join(scrollbackRoot, String(id)),
    manager: deps.scrollbackArchiveManager,
  });
  // Dynamic import keeps circular test imports from touching the class before initialization.
  const { ArchivedTerminalEmulator } = await import('../../../terminal/archived-emulator');
  const emulator = new ArchivedTerminalEmulator(liveEmulator, scrollbackArchive);

  // Create terminal query passthrough for handling terminal queries
  const queryPassthrough = new TerminalQueryPassthrough();

  // Get capability environment
  const capabilityEnv = getCapabilityEnvironment();

  // Spawn PTY asynchronously (fork happens off main thread)
  const baseEnv = {
    ...process.env,
    ...capabilityEnv,
    ...options.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  } as Record<string, string>;

  const shellLaunch = prepareShellIntegration(shell, baseEnv);

  // Spawn PTY with errore error handling
  const ptyResult = await errore.tryAsync<Awaited<ReturnType<typeof spawnAsync>>, PtySpawnError>({
    try: () =>
      spawnAsync(shell, shellLaunch.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: shellLaunch.env,
      }),
    catch: (error) => new PtySpawnError({ shell, cwd, reason: String(error), cause: error }),
  });
  if (ptyResult instanceof PtySpawnError) {
    return ptyResult;
  }
  const pty = ptyResult;

  if (hasPixels && 'resizeWithPixels' in pty) {
    // Ignore resize errors - not critical for session creation
    errore.try<void, Error>({
      try: () => pty.resizeWithPixels(cols, rows, pixelWidth!, pixelHeight!),
      catch: () => new Error('Resize failed'), // Swallowed below
    });
  }

  const session: InternalPtySession = {
    id,
    pty,
    emulator,
    liveEmulator,
    scrollbackArchive,
    scrollbackArchiver: undefined,
    queryPassthrough,
    kittyRelayDispose: undefined,
    cols,
    rows,
    cellWidth,
    cellHeight,
    pixelWidth: hasPixels ? pixelWidth! : cols * defaultCellWidth(),
    pixelHeight: hasPixels ? pixelHeight! : rows * defaultCellHeight(),
    cwd,
    cwdReported: false,
    shell,
    closing: false,
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    lastCommand: null,
    focusTrackingEnabled: false,
    focusState: false,
    focusTrackingOwnerProcess: null,
    pendingNotify: false,
    scrollState: { viewportOffset: 0, lastScrollbackLength: 0, lastIsAtBottom: true },
    lastResizeTime: 0,
  };

  session.scrollbackArchiver = new ScrollbackArchiver(session, liveEmulator);

  // Subscribe to emulator title changes and propagate to subscribers
  emulator.onTitleChange((title: string) => {
    // Notify per-PTY title subscribers
    for (const callback of session.titleSubscribers) {
      callback(title);
    }
    // Notify global title subscribers
    deps.onTitleChange(id, title);
  });

  // Subscribe to emulator updates (drives unified subscribers)
  emulator.onUpdate(() => {
    notifySubscribers(session);
  });

  emulator.setPixelSize?.(session.pixelWidth, session.pixelHeight);

  // Set up query passthrough
  const kittyRelayDispose = setupQueryPassthrough({
    queryPassthrough,
    emulator,
    pty,
    ptyId: id,
    getSessionDimensions: () => ({ cols: session.cols, rows: session.rows }),
    getPixelDimensions: () => ({
      pixelWidth: session.pixelWidth,
      pixelHeight: session.pixelHeight,
      cellWidth: session.cellWidth,
      cellHeight: session.cellHeight,
    }),
  });
  if (kittyRelayDispose) {
    session.kittyRelayDispose = kittyRelayDispose;
  }

  // Create sync mode parser for DEC Mode 2026 (synchronized output)
  const syncParser = createSyncModeParser();

  const commandParser = createCommandParser({
    shellName,
    onCommand: (command: string) => {
      session.lastCommand = command;
    },
    onCwd: (nextCwd: string) => {
      session.cwd = nextCwd;
      session.cwdReported = true;
      deps.onCwdChange(id, nextCwd);
    },
    onNotification: (notification) => {
      const subtitle = session.emulator.getTitle() || session.lastCommand || '';
      const forwarded = forwardNotification({
        ptyId: String(id),
        notification,
        subtitle,
      });
      if (!forwarded) {
        sendMacOsNotification({
          title: notification.title,
          subtitle,
          body: notification.body,
        });
      }
    },
  });

  // Set up data handler
  const { handleData } = createDataHandler({
    session,
    syncParser,
    commandParser,
    copyToClipboard: deps.copyToClipboard,
  });

  // Wire up PTY data handler
  pty.onData((data: string) => {
    if (data.length > 0) {
      deps.onActivity(id);
    }
    handleData(data);
  });

  // Wire up foreground process change handler
  pty.onForegroundProcessChange((processName: string) => {
    deps.onForegroundProcessChange(id, processName);
  });

  // Wire up mode change handler for DECSET 2048 (in-band resize notifications)
  emulator.onModeChange((modes, prevModes) => {
    if (modes.inBandResize && !prevModes?.inBandResize) {
      // Mode just got enabled - send initial size notification
      const resizeNotification = `\x1b[48;${session.rows};${session.cols};${session.pixelHeight};${session.pixelWidth}t`;
      pty.write(resizeNotification);
    }
  });

  // Wire up exit handler
  pty.onExit(({ exitCode }) => {
    if (session.closing) {
      return;
    }
    tracePtyEvent('pty-exit', { ptyId: id, exitCode });
    for (const callback of session.exitCallbacks) {
      callback(exitCode);
    }
    deps.onExit?.(id, exitCode);
  });

  return { id, session };
}
