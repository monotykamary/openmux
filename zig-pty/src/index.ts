/**
 * zig-pty: Pure Zig PTY implementation for Bun
 *
 * A minimal, high-performance pseudoterminal library.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { join, dirname, basename } from "path";
import { existsSync } from "fs";

// ============================================================================
// Event Emitter
// ============================================================================

interface Disposable {
  dispose(): void;
}

type Listener<T> = (data: T) => void;

class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const i = this.listeners.indexOf(listener);
        if (i !== -1) {
          this.listeners.splice(i, 1);
        }
      },
    };
  };

  fire(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_FILE = "sh";

// ============================================================================
// Library Loading
// ============================================================================

function resolveLibPath(): string {
  const env = process.env.ZIG_PTY_LIB;
  if (env && existsSync(env)) return env;

  const platform = process.platform;
  const arch = process.arch;

  // Library filename based on platform/arch
  const ext = platform === "darwin" ? "dylib" : platform === "win32" ? "dll" : "so";
  const filenames =
    platform === "darwin"
      ? arch === "arm64"
        ? ["libzig_pty_arm64.dylib", "libzig_pty.dylib"]
        : ["libzig_pty.dylib"]
      : platform === "win32"
        ? ["zig_pty.dll"]
        : arch === "arm64"
          ? ["libzig_pty_arm64.so", "libzig_pty.so"]
          : ["libzig_pty.so"];

  // For compiled binaries, check next to the executable first
  // process.execPath points to the actual binary location
  const execDir = dirname(process.execPath);

  // For development, check relative to source
  const base = Bun.fileURLToPath(import.meta.url);
  const fileDir = dirname(base);
  const dirName = basename(fileDir);
  const here = dirName === "src" || dirName === "dist" ? dirname(fileDir) : fileDir;

  const basePaths = [
    // Compiled binary: library next to executable (set by wrapper or manual)
    execDir,
    // Development: zig-pty/zig-out/lib/
    join(here, "zig-out", "lib"),
    join(here, "..", "zig-pty", "zig-out", "lib"),
    join(process.cwd(), "zig-pty", "zig-out", "lib"),
  ];

  const fallbackPaths: string[] = [];
  for (const basePath of basePaths) {
    for (const filename of filenames) {
      fallbackPaths.push(join(basePath, filename));
    }
    // Also check for generic name (libzig_pty.ext)
    fallbackPaths.push(join(basePath, `libzig_pty.${ext}`));
  }

  for (const path of fallbackPaths) {
    if (existsSync(path)) return path;
  }

  throw new Error(
    `libzig_pty shared library not found.\nChecked:\n  - ZIG_PTY_LIB=${env ?? "<unset>"}\n  - ${fallbackPaths.join("\n  - ")}\n\nSet ZIG_PTY_LIB or ensure one of these paths contains the file.`
  );
}

const libPath = resolveLibPath();
const lib = dlopen(libPath, {
  bun_pty_spawn: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  bun_pty_write: {
    args: [FFIType.i32, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  bun_pty_read: {
    args: [FFIType.i32, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  bun_pty_resize: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  bun_pty_kill: { args: [FFIType.i32], returns: FFIType.i32 },
  bun_pty_get_pid: { args: [FFIType.i32], returns: FFIType.i32 },
  bun_pty_get_exit_code: { args: [FFIType.i32], returns: FFIType.i32 },
  bun_pty_close: { args: [FFIType.i32], returns: FFIType.void },
});

// ============================================================================
// Interfaces (compatible with bun-pty)
// ============================================================================

export interface IDisposable {
  dispose(): void;
}

export interface IPtyForkOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface IExitEvent {
  exitCode: number;
  signal?: number | string;
}

export interface IPty {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly process: string;
  readonly onData: (listener: (data: string) => void) => IDisposable;
  readonly onExit: (listener: (event: IExitEvent) => void) => IDisposable;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

// Legacy aliases
export type TerminalOptions = IPtyForkOptions;
export type ExitEvent = IExitEvent;

// ============================================================================
// Terminal Class
// ============================================================================

function shQuote(s: string): string {
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class Terminal implements IPty {
  private handle: number = -1;
  private _pid: number = -1;
  private _cols: number = DEFAULT_COLS;
  private _rows: number = DEFAULT_ROWS;
  private _readLoop: boolean = false;
  private _closing: boolean = false;
  private _exitFired: boolean = false;
  private _onData = new EventEmitter<string>();
  private _onExit = new EventEmitter<IExitEvent>();
  // Streaming TextDecoder handles incomplete UTF-8 sequences across reads
  private _decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(
    file: string = DEFAULT_FILE,
    args: string[] = [],
    opts: IPtyForkOptions = {}
  ) {
    this._cols = opts.cols ?? DEFAULT_COLS;
    this._rows = opts.rows ?? DEFAULT_ROWS;
    const cwd = opts.cwd ?? process.cwd();

    const cmdline = [file, ...args.map(shQuote)].join(" ");

    let envStr = "";
    if (opts.env) {
      const envPairs = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);
      envStr = envPairs.join("\0") + "\0";
    }

    this.handle = lib.symbols.bun_pty_spawn(
      Buffer.from(`${cmdline}\0`, "utf8"),
      Buffer.from(`${cwd}\0`, "utf8"),
      Buffer.from(`${envStr}\0`, "utf8"),
      this._cols,
      this._rows
    );

    if (this.handle < 0) {
      throw new Error("PTY spawn failed");
    }

    this._pid = lib.symbols.bun_pty_get_pid(this.handle);
    this._startReadLoop();
  }

  get pid(): number {
    return this._pid;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get process(): string {
    return "shell";
  }

  get onData() {
    return this._onData.event;
  }

  get onExit() {
    return this._onExit.event;
  }

  write(data: string): void {
    if (this._closing) return;
    const buf = Buffer.from(data, "utf8");
    lib.symbols.bun_pty_write(this.handle, ptr(buf), buf.length);
  }

  resize(cols: number, rows: number): void {
    if (this._closing) return;
    this._cols = cols;
    this._rows = rows;
    lib.symbols.bun_pty_resize(this.handle, cols, rows);
  }

  kill(signal: string = "SIGTERM"): void {
    if (this._closing) return;
    this._closing = true;
    lib.symbols.bun_pty_kill(this.handle);
    lib.symbols.bun_pty_close(this.handle);
    if (!this._exitFired) {
      this._exitFired = true;
      this._onExit.fire({ exitCode: 0, signal });
    }
  }

  private async _startReadLoop(): Promise<void> {
    if (this._readLoop) return;
    this._readLoop = true;
    const buf = Buffer.alloc(65536); // 64KB buffer

    // The Zig side has a background thread that reads from the PTY and fills
    // a ring buffer. This naturally coalesces data because blocking reads
    // wait for data to be available. We just need to drain the ring buffer.

    while (this._readLoop && !this._closing) {
      const n = lib.symbols.bun_pty_read(this.handle, ptr(buf), buf.length);

      if (n > 0) {
        // Got data from ring buffer - decode and emit
        const data = this._decoder.decode(buf.subarray(0, n), { stream: true });
        if (data.length > 0) {
          this._onData.fire(data);
        }
        // Yield briefly to let UI render
        await Bun.sleep(0);
      } else if (n === -2) {
        // Child exited - flush decoder, close handle, and fire exit
        const remaining = this._decoder.decode();
        if (remaining.length > 0) this._onData.fire(remaining);
        const exitCode = lib.symbols.bun_pty_get_exit_code(this.handle);
        lib.symbols.bun_pty_close(this.handle);
        if (!this._exitFired) {
          this._exitFired = true;
          this._onExit.fire({ exitCode });
        }
        return;
      } else if (n < 0) {
        // Error
        return;
      } else {
        // No data in ring buffer - sleep briefly before polling again
        await Bun.sleep(1);
      }
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export function spawn(
  file: string,
  args: string[],
  options: IPtyForkOptions
): IPty {
  return new Terminal(file, args, options);
}
