/**
 * PTY Manager - manages PTY sessions using bun-pty with ghostty-web VT parsing
 */

import { spawn, type IPty } from 'bun-pty';
import type { PTYSession, TerminalState } from '../core/types';
import { DEFAULT_CONFIG } from '../core/config';
import { GhosttyEmulator } from './ghostty-emulator';
import { GraphicsPassthrough } from './graphics-passthrough';
import { getCapabilityEnvironment } from './capabilities';
import { getHostColors } from './terminal-colors';

/**
 * Get the current working directory of a process by PID
 * Uses platform-specific methods (lsof on macOS, /proc on Linux)
 */
async function getProcessCwd(pid: number): Promise<string | null> {
  try {
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS: use lsof to get cwd
      const proc = Bun.spawn(['lsof', '-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      await proc.exited;

      // Parse lsof output - look for 'n' prefix lines (name field)
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('n') && !line.startsWith('n/')) {
          continue;
        }
        if (line.startsWith('n/')) {
          return line.slice(1); // Remove 'n' prefix
        }
      }
    } else if (platform === 'linux') {
      // Linux: read /proc/<pid>/cwd symlink
      const file = Bun.file(`/proc/${pid}/cwd`);
      if (await file.exists()) {
        // readlink equivalent using realpath
        const proc = Bun.spawn(['readlink', `-f`, `/proc/${pid}/cwd`], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        return output.trim() || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

interface PTYManagerConfig {
  defaultShell?: string;
  defaultCols?: number;
  defaultRows?: number;
  env?: Record<string, string>;
}

interface PTYSessionInternal extends PTYSession {
  pty: IPty;
  emulator: GhosttyEmulator;
  graphicsPassthrough: GraphicsPassthrough;
  subscribers: Set<(state: TerminalState) => void>;
  exitCallbacks: Set<(exitCode: number) => void>;
  pendingNotify: boolean; // For render batching
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

    // Get queried host colors (may be null if not yet queried)
    const colors = getHostColors() ?? undefined;

    // Create ghostty emulator for VT parsing with host colors
    const emulator = new GhosttyEmulator({ cols, rows, colors });

    // Create graphics passthrough for Kitty/Sixel support
    const graphicsPassthrough = new GraphicsPassthrough();

    // Get capability environment for graphics protocol support
    const capabilityEnv = getCapabilityEnvironment();

    // Spawn PTY
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        ...this.config.env,
        ...capabilityEnv, // Forward host terminal capabilities
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    });

    const session: PTYSessionInternal = {
      id,
      pid: pty.pid,
      cols,
      rows,
      cwd,
      shell,
      pty,
      emulator,
      graphicsPassthrough,
      subscribers: new Set(),
      exitCallbacks: new Set(),
      pendingNotify: false,
    };

    // Wire up PTY data handler to ghostty emulator
    pty.onData((data: string) => {
      this.handlePTYData(session, data);
    });

    // Wire up PTY exit handler
    pty.onExit(({ exitCode }) => {
      for (const callback of session.exitCallbacks) {
        callback(exitCode);
      }
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
   * Handle data from PTY - feed to ghostty emulator
   * Uses microtask batching to coalesce rapid updates
   * Graphics sequences (Kitty/Sixel) are passed through to host terminal
   */
  private handlePTYData(session: PTYSessionInternal, data: string): void {
    // Process through graphics passthrough - extracts Kitty/Sixel sequences
    // and writes them directly to stdout, returning non-graphics data
    const textData = session.graphicsPassthrough.process(data);

    // Feed non-graphics data to ghostty emulator for VT parsing
    if (textData.length > 0) {
      session.emulator.write(textData);
    }

    // Batch notifications using setImmediate for best performance
    // This coalesces rapid PTY data events within the same event loop tick
    if (!session.pendingNotify) {
      session.pendingNotify = true;
      setImmediate(() => {
        this.notifySubscribers(session);
        session.pendingNotify = false;
      });
    }
  }

  /**
   * Notify all subscribers of a session with current state
   */
  private notifySubscribers(session: PTYSessionInternal): void {
    const state = session.emulator.getTerminalState();
    for (const callback of session.subscribers) {
      callback(state);
    }
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

      // Resize ghostty emulator
      session.emulator.resize(cols, rows);

      // Notify subscribers immediately (resize is user-initiated, no batching)
      this.notifySubscribers(session);
    }
  }

  /**
   * Update pane position for graphics passthrough
   * Graphics sequences need to know where the pane is on screen
   */
  setPanePosition(sessionId: string, x: number, y: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.graphicsPassthrough.setPanePosition(x, y);
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
    callback(session.emulator.getTerminalState());

    // Return unsubscribe function
    return () => {
      session.subscribers.delete(callback);
    };
  }

  /**
   * Subscribe to PTY exit events
   */
  onExit(sessionId: string, callback: (exitCode: number) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.exitCallbacks.add(callback);

    return () => {
      session.exitCallbacks.delete(callback);
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
    return this.sessions.get(sessionId)?.emulator.getTerminalState();
  }

  /**
   * Get the current working directory of a session's shell process
   */
  async getSessionCwd(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.pid === undefined) return null;

    // Try to get the actual CWD from the process
    const cwd = await getProcessCwd(session.pid);
    return cwd ?? session.cwd;
  }

  /**
   * Destroy a PTY session
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      session.emulator.dispose();
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
}

export const ptyManager = new PTYManagerImpl();
export type { PTYManagerConfig };
