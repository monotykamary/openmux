/**
 * zig-pty: Pure Zig PTY implementation for Bun
 *
 * A minimal, high-performance pseudoterminal library.
 *
 * Module structure:
 * - types.ts: Type definitions and constants
 * - event-emitter.ts: Simple event emitter
 * - lib-loader.ts: FFI library loading
 * - terminal.ts: Terminal class
 */

import { lib } from "./lib-loader";
import { Terminal } from "./terminal";
import type { IPty, IPtyForkOptions } from "./types";
import { DEFAULT_COLS, DEFAULT_ROWS, SPAWN_PENDING, SPAWN_ERROR } from "./types";

// Re-export types
export type {
  IDisposable,
  IPtyForkOptions,
  IExitEvent,
  IPty,
  TerminalOptions,
  ExitEvent,
} from "./types";

// Re-export Terminal class
export { Terminal };

/**
 * Spawn a PTY synchronously
 */
export function spawn(
  file: string,
  args: string[],
  options: IPtyForkOptions
): IPty {
  return new Terminal(file, args, options);
}

function shQuote(s: string): string {
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Spawn a PTY asynchronously - the fork() happens off the main thread.
 * This prevents animation stutter when creating new panes.
 */
export function spawnAsync(
  file: string,
  args: string[],
  options: IPtyForkOptions
): Promise<IPty> {
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const cwd = options.cwd ?? process.cwd();

  const cmdline = [file, ...args.map(shQuote)].join(" ");

  let envStr = "";
  if (options.env) {
    const envPairs = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);
    envStr = envPairs.join("\0") + "\0";
  }

  const requestId = lib.symbols.bun_pty_spawn_async(
    Buffer.from(`${cmdline}\0`, "utf8"),
    Buffer.from(`${cwd}\0`, "utf8"),
    Buffer.from(`${envStr}\0`, "utf8"),
    cols,
    rows
  );

  if (requestId < 0) {
    return Promise.reject(new Error("PTY async spawn request failed"));
  }

  return new Promise((resolve, reject) => {
    const poll = () => {
      const result = lib.symbols.bun_pty_spawn_poll(requestId);

      if (result === SPAWN_PENDING) {
        // Still pending - poll again after a short delay
        // Use 5ms interval to reduce polling overhead while staying responsive
        setTimeout(poll, 5);
        return;
      }

      if (result === SPAWN_ERROR || result < 0) {
        reject(new Error("PTY spawn failed"));
        return;
      }

      // Success - result is the handle
      // Defer Terminal creation to next tick to avoid synchronous work burst
      setImmediate(() => {
        resolve(Terminal.fromHandle(result, cols, rows));
      });
    };

    // Start polling on next tick to avoid synchronous FFI call
    setImmediate(poll);
  });
}
