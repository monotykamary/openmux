/**
 * PTY Manager - manages PTY sessions using bun-pty
 */

import { spawn, type IPty } from 'bun-pty';
import type { PTYSession, TerminalState, TerminalCell } from '../core/types';
import { DEFAULT_CONFIG } from '../core/config';

interface PTYManagerConfig {
  defaultShell?: string;
  defaultCols?: number;
  defaultRows?: number;
  env?: Record<string, string>;
}

interface PTYSessionInternal extends PTYSession {
  pty: IPty;
  subscribers: Set<(state: TerminalState) => void>;
  terminalState: TerminalState;
}

class PTYManagerImpl {
  private sessions: Map<string, PTYSessionInternal> = new Map();
  private config: PTYManagerConfig;

  constructor(config: PTYManagerConfig = {}) {
    this.config = {
      defaultShell: config.defaultShell ?? DEFAULT_CONFIG.defaultShell,
      defaultCols: config.defaultCols ?? 80,
      defaultRows: config.defaultRows ?? 24,
      env: config.env ?? {},
    };
  }

  /**
   * Create a new PTY session
   */
  createSession(
    id: string,
    options: {
      cols?: number;
      rows?: number;
      shell?: string;
      cwd?: string;
      env?: Record<string, string>;
    } = {}
  ): PTYSession {
    const cols = options.cols ?? this.config.defaultCols!;
    const rows = options.rows ?? this.config.defaultRows!;
    const shell = options.shell ?? this.config.defaultShell!;
    const cwd = options.cwd ?? process.cwd();

    // Spawn PTY
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        ...this.config.env,
        ...options.env,
        TERM: 'xterm-256color',
      } as Record<string, string>,
    });

    // Create initial terminal state
    const terminalState = this.createEmptyState(cols, rows);

    const session: PTYSessionInternal = {
      id,
      pid: pty.pid,
      cols,
      rows,
      cwd,
      shell,
      pty,
      subscribers: new Set(),
      terminalState,
    };

    // Wire up PTY data handler
    pty.onData((data: string) => {
      this.handlePTYData(session, data);
    });

    this.sessions.set(id, session);

    return {
      id: session.id,
      pid: session.pid,
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      shell: session.shell,
    };
  }

  /**
   * Handle data from PTY
   */
  private handlePTYData(session: PTYSessionInternal, data: string): void {
    // For now, just update a simple terminal state
    // This will be replaced with libghostty-vt parsing
    session.terminalState = this.basicParse(session.terminalState, data);

    // Notify subscribers
    for (const callback of session.subscribers) {
      callback(session.terminalState);
    }
  }

  /**
   * Basic ANSI parsing (fallback until libghostty-vt is integrated)
   */
  private basicParse(state: TerminalState, data: string): TerminalState {
    // Very basic parsing - just append characters
    // This is a placeholder for the full libghostty-vt integration
    const newState = { ...state, cells: state.cells.map(row => [...row]) };

    for (const char of data) {
      if (char === '\r') {
        newState.cursor.x = 0;
      } else if (char === '\n') {
        newState.cursor.y++;
        if (newState.cursor.y >= newState.rows) {
          // Scroll up
          newState.cells.shift();
          newState.cells.push(this.createEmptyRow(newState.cols));
          newState.cursor.y = newState.rows - 1;
        }
      } else if (char === '\b') {
        if (newState.cursor.x > 0) {
          newState.cursor.x--;
        }
      } else if (char === '\x1b') {
        // Skip escape sequences for now
        continue;
      } else if (char >= ' ') {
        // Regular character
        if (newState.cursor.x < newState.cols && newState.cursor.y < newState.rows) {
          newState.cells[newState.cursor.y][newState.cursor.x] = {
            ...newState.cells[newState.cursor.y][newState.cursor.x],
            char,
          };
          newState.cursor.x++;
          if (newState.cursor.x >= newState.cols) {
            newState.cursor.x = 0;
            newState.cursor.y++;
            if (newState.cursor.y >= newState.rows) {
              newState.cells.shift();
              newState.cells.push(this.createEmptyRow(newState.cols));
              newState.cursor.y = newState.rows - 1;
            }
          }
        }
      }
    }

    return newState;
  }

  /**
   * Write data to a PTY session
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.write(data);
    }
  }

  /**
   * Resize a PTY session
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;

      // Resize terminal state
      session.terminalState = this.resizeState(session.terminalState, cols, rows);

      // Notify subscribers
      for (const callback of session.subscribers) {
        callback(session.terminalState);
      }
    }
  }

  /**
   * Subscribe to terminal state updates
   */
  subscribe(
    sessionId: string,
    callback: (state: TerminalState) => void
  ): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.subscribers.add(callback);

    // Immediately call with current state
    callback(session.terminalState);

    // Return unsubscribe function
    return () => {
      session.subscribers.delete(callback);
    };
  }

  /**
   * Get a session
   */
  getSession(sessionId: string): PTYSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    return {
      id: session.id,
      pid: session.pid,
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      shell: session.shell,
    };
  }

  /**
   * Get terminal state for a session
   */
  getTerminalState(sessionId: string): TerminalState | undefined {
    return this.sessions.get(sessionId)?.terminalState;
  }

  /**
   * Destroy a PTY session
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      session.subscribers.clear();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Destroy all sessions
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }

  private createEmptyState(cols: number, rows: number): TerminalState {
    const cells: TerminalCell[][] = [];
    for (let y = 0; y < rows; y++) {
      cells.push(this.createEmptyRow(cols));
    }

    return {
      cols,
      rows,
      cells,
      cursor: { x: 0, y: 0, visible: true },
      alternateScreen: false,
      mouseTracking: false,
    };
  }

  private createEmptyRow(cols: number): TerminalCell[] {
    const row: TerminalCell[] = [];
    for (let x = 0; x < cols; x++) {
      row.push({
        char: ' ',
        fg: { r: 255, g: 255, b: 255 },
        bg: { r: 0, g: 0, b: 0 },
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      });
    }
    return row;
  }

  private resizeState(state: TerminalState, cols: number, rows: number): TerminalState {
    const newCells: TerminalCell[][] = [];

    for (let y = 0; y < rows; y++) {
      if (y < state.cells.length) {
        // Copy existing row, adjusting width
        const row: TerminalCell[] = [];
        for (let x = 0; x < cols; x++) {
          if (x < state.cells[y].length) {
            row.push(state.cells[y][x]);
          } else {
            row.push(this.createEmptyRow(1)[0]);
          }
        }
        newCells.push(row);
      } else {
        newCells.push(this.createEmptyRow(cols));
      }
    }

    return {
      ...state,
      cols,
      rows,
      cells: newCells,
      cursor: {
        ...state.cursor,
        x: Math.min(state.cursor.x, cols - 1),
        y: Math.min(state.cursor.y, rows - 1),
      },
    };
  }
}

export const ptyManager = new PTYManagerImpl();
export type { PTYManagerConfig };
