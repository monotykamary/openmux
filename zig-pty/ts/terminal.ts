/**
 * Terminal class for zig-pty
 */

import { ptr } from "bun:ffi";
import { lib } from "./lib-loader";
import { EventEmitter } from "./event-emitter";
import type { IPty, IPtyForkOptions, IExitEvent } from "./types";
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_FILE } from "./types";
import { encodeEnvBuffer } from "./env-buffer";

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

  /**
   * Create a Terminal from an already-spawned handle (used by spawnAsync)
   */
  static fromHandle(handle: number, cols: number, rows: number): Terminal {
    const term = Object.create(Terminal.prototype) as Terminal;
    term.handle = handle;
    term._pid = lib.symbols.bun_pty_get_pid(handle);
    term._cols = cols;
    term._rows = rows;
    term._readLoop = false;
    term._closing = false;
    term._exitFired = false;
    term._onData = new EventEmitter<string>();
    term._onExit = new EventEmitter<IExitEvent>();
    term._decoder = new TextDecoder("utf-8", { fatal: false });
    term._startReadLoop();
    return term;
  }

  constructor(
    file: string = DEFAULT_FILE,
    args: string[] = [],
    opts: IPtyForkOptions = {}
  ) {
    this._cols = opts.cols ?? DEFAULT_COLS;
    this._rows = opts.rows ?? DEFAULT_ROWS;
    const cwd = opts.cwd ?? process.cwd();

    const cmdline = [file, ...args.map(shQuote)].join(" ");

    const envBuffer = opts.envBuffer
      ? Buffer.isBuffer(opts.envBuffer)
        ? opts.envBuffer
        : Buffer.from(opts.envBuffer)
      : encodeEnvBuffer(opts.env);

    this.handle = lib.symbols.bun_pty_spawn(
      Buffer.from(`${cmdline}\0`, "utf8"),
      Buffer.from(`${cwd}\0`, "utf8"),
      envBuffer,
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

  // ==========================================================================
  // Process Inspection (Native APIs - no subprocess spawning)
  // ==========================================================================

  /**
   * Get the foreground process group ID.
   * Uses tcgetpgrp() on the PTY master fd.
   * @returns The foreground process group PID, or -1 on error.
   */
  getForegroundPid(): number {
    if (this._closing || this.handle < 0) return -1;
    return lib.symbols.bun_pty_get_foreground_pid(this.handle);
  }

  /**
   * Get the current working directory of a process.
   * Uses native APIs: proc_pidinfo on macOS, /proc on Linux.
   * @param pid The process ID (defaults to shell PID)
   * @returns The CWD path, or null on error.
   */
  getCwd(pid?: number): string | null {
    const targetPid = pid ?? this._pid;
    if (targetPid <= 0) return null;

    const buf = Buffer.alloc(1024);
    const len = lib.symbols.bun_pty_get_cwd(targetPid, ptr(buf), buf.length);
    if (len <= 0) return null;

    return buf.toString("utf8", 0, len);
  }

  /**
   * Get the name of a process.
   * Uses native APIs: proc_name on macOS, /proc on Linux.
   * @param pid The process ID (defaults to foreground process)
   * @returns The process name, or null on error.
   */
  getProcessName(pid?: number): string | null {
    const targetPid = pid ?? this.getForegroundPid();
    if (targetPid <= 0) return null;

    const buf = Buffer.alloc(256);
    const len = lib.symbols.bun_pty_get_process_name(targetPid, ptr(buf), buf.length);
    if (len <= 0) return null;

    return buf.toString("utf8", 0, len);
  }

  /**
   * Get the foreground process name (convenience method).
   * Combines getForegroundPid() and getProcessName().
   * @returns The foreground process name, or null if no foreground process.
   */
  getForegroundProcessName(): string | null {
    const fgPid = this.getForegroundPid();
    if (fgPid <= 0 || fgPid === this._pid) {
      // No foreground process or it's the shell itself
      return this.getProcessName(this._pid);
    }
    return this.getProcessName(fgPid);
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
