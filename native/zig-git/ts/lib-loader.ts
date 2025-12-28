/**
 * Library loader for zig-git
 */

import { dlopen, FFIType } from "bun:ffi";
import { join, dirname, basename } from "path";
import { existsSync } from "fs";

function resolveLibPath(): string {
  const env = process.env.ZIG_GIT_LIB;
  if (env && existsSync(env)) return env;

  const platform = process.platform;
  const arch = process.arch;

  const ext = platform === "darwin" ? "dylib" : platform === "win32" ? "dll" : "so";
  const filenames =
    platform === "darwin"
      ? arch === "arm64"
        ? ["libzig_git_arm64.dylib", "libzig_git.dylib"]
        : ["libzig_git.dylib"]
      : platform === "win32"
        ? ["zig_git.dll"]
        : arch === "arm64"
          ? ["libzig_git_arm64.so", "libzig_git.so"]
          : ["libzig_git.so"];

  const execDir = dirname(process.execPath);

  const base = Bun.fileURLToPath(import.meta.url);
  const fileDir = dirname(base);
  const dirName = basename(fileDir);
  const here = dirName === "ts" || dirName === "src" || dirName === "dist" ? dirname(fileDir) : fileDir;

  const basePaths = [
    execDir,
    join(here, "zig-out", "lib"),
    join(process.cwd(), "native", "zig-git", "zig-out", "lib"),
  ];

  const candidates: string[] = [];
  for (const basePath of basePaths) {
    for (const filename of filenames) {
      candidates.push(join(basePath, filename));
    }
    candidates.push(join(basePath, `libzig_git.${ext}`));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `libzig_git shared library not found.\nChecked:\n  - ZIG_GIT_LIB=${env ?? "<unset>"}\n  - ${candidates.join("\n  - ")}\n\nSet ZIG_GIT_LIB or ensure one of these paths contains the file.`
  );
}

const libPath = resolveLibPath();

export const lib = dlopen(libPath, {
  omx_git_init: { args: [], returns: FFIType.i32 },
  omx_git_shutdown: { args: [], returns: FFIType.i32 },
  omx_git_repo_info: {
    args: [
      FFIType.cstring,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
  omx_git_repo_status: {
    args: [
      FFIType.cstring,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
  omx_git_diff_stats_async: { args: [FFIType.cstring], returns: FFIType.i32 },
  omx_git_diff_stats_poll: {
    args: [FFIType.i32, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  omx_git_diff_stats_cancel: { args: [FFIType.i32], returns: FFIType.void },
  omx_git_status_async: { args: [FFIType.cstring], returns: FFIType.i32 },
  omx_git_status_poll: {
    args: [
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
  omx_git_status_cancel: { args: [FFIType.i32], returns: FFIType.void },
});
