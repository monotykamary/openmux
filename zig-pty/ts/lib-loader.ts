/**
 * Library loader for zig-pty
 */

import { dlopen, FFIType } from "bun:ffi";
import { join, dirname, basename } from "path";
import { existsSync } from "fs";

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
  // Handle ts/, src/, or dist/ directory
  const here = dirName === "ts" || dirName === "src" || dirName === "dist" ? dirname(fileDir) : fileDir;

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

export const lib = dlopen(libPath, {
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
  // Async spawn functions
  bun_pty_spawn_async: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  bun_pty_spawn_poll: { args: [FFIType.i32], returns: FFIType.i32 },
  bun_pty_spawn_cancel: { args: [FFIType.i32], returns: FFIType.void },
  // Process inspection (native APIs - no subprocess spawning)
  bun_pty_get_foreground_pid: { args: [FFIType.i32], returns: FFIType.i32 },
  bun_pty_get_cwd: { args: [FFIType.i32, FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
  bun_pty_get_process_name: { args: [FFIType.i32, FFIType.pointer, FFIType.i32], returns: FFIType.i32 },
});
