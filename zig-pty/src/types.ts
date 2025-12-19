/**
 * Types for zig-pty
 */

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
  // Process inspection (native APIs - no subprocess spawning)
  getForegroundPid(): number;
  getCwd(pid?: number): string | null;
  getProcessName(pid?: number): string | null;
  getForegroundProcessName(): string | null;
}

// Legacy aliases
export type TerminalOptions = IPtyForkOptions;
export type ExitEvent = IExitEvent;

// Constants
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const DEFAULT_FILE = "sh";

// Async spawn return codes
export const SPAWN_PENDING = -3;
export const SPAWN_ERROR = -4;
