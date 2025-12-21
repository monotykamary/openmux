import { Ghostty } from 'ghostty-web';
import type { WorkerTerminalColors } from '../../emulator-interface';
import type { TerminalColors } from '../../terminal-colors';
import type { WorkerSession } from '../types';
import { createTitleParser } from '../../title-parser';
import { sendMessage, sendError, getModes } from '../helpers';
import { sendFullUpdate } from '../updates';

/**
 * Handle session initialization
 */
export async function handleInit(
  sessionId: string,
  cols: number,
  rows: number,
  colors: WorkerTerminalColors,
  ghostty: Ghostty | null,
  sessions: Map<string, WorkerSession>
): Promise<void> {
  if (!ghostty) {
    sendError('Ghostty not initialized', sessionId);
    return;
  }

  if (sessions.has(sessionId)) {
    sendError(`Session ${sessionId} already exists`, sessionId);
    return;
  }

  try {
    const fgColor = (colors.foreground.r << 16) | (colors.foreground.g << 8) | colors.foreground.b;
    const bgColor = (colors.background.r << 16) | (colors.background.g << 8) | colors.background.b;
    const palette = colors.palette.map(c => (c.r << 16) | (c.g << 8) | c.b);

    const terminalColors: TerminalColors = {
      foreground: fgColor,
      background: bgColor,
      palette,
      isDefault: false,
    };

    const terminal = ghostty.createTerminal(cols, rows, {
      scrollbackLimit: 2000,
      bgColor,
      fgColor,
      palette,
    });

    const titleParser = createTitleParser({
      onTitleChange: (title: string) => {
        const session = sessions.get(sessionId);
        if (session) {
          session.currentTitle = title;
          sendMessage({ type: 'titleChange', sessionId, title });
        }
      },
    });

    const session: WorkerSession = {
      terminal,
      cols,
      rows,
      workerColors: colors,
      terminalColors,
      titleParser,
      currentTitle: '',
      lastModes: getModes(terminal),
      scrollbackCache: new Map(),
      lastScrollbackLength: 0,
    };

    sessions.set(sessionId, session);

    terminal.write(new TextEncoder().encode('\x1b[2J\x1b[H'));
    terminal.clearDirty();

    sendMessage({ type: 'initialized', sessionId });
    sendFullUpdate(sessionId, session);
  } catch (error) {
    sendError(`Failed to create session: ${error}`, sessionId);
  }
}
