/**
 * Native libghostty-vt loader and symbols.
 */

import { dlopen, FFIType } from "bun:ffi";
import { basename, dirname, join } from "path";
import { existsSync } from "fs";

function resolveLibPath(): string {
  const envPath = process.env.GHOSTTY_VT_LIB;
  if (envPath && existsSync(envPath)) return envPath;

  const platform = process.platform;
  const arch = process.arch;

  const ext = platform === "darwin" ? "dylib" : platform === "win32" ? "dll" : "so";
  const filenames =
    platform === "win32"
      ? ["ghostty-vt.dll"]
      : [`libghostty-vt.${ext}`];

  // For compiled binaries, check next to the executable first.
  const execDir = dirname(process.execPath);

  const base = Bun.fileURLToPath(import.meta.url);
  const fileDir = dirname(base);
  const dirName = basename(fileDir);
  const here = dirName === "ghostty-vt" || dirName === "terminal" || dirName === "src" || dirName === "dist"
    ? dirname(fileDir)
    : fileDir;
  const repoRoot = join(here, "..", "..");

  const basePaths = [
    execDir,
    // Vendored ghostty source (preferred)
    join(repoRoot, "ghostty", "zig-out", "lib"),
    join(repoRoot, "vendor", "ghostty", "zig-out", "lib"),
    // Fallbacks for local dev
    join(process.cwd(), "ghostty", "zig-out", "lib"),
    join(process.cwd(), "vendor", "ghostty", "zig-out", "lib"),
  ];

  const candidates: string[] = [];
  for (const basePath of basePaths) {
    for (const filename of filenames) {
      candidates.push(join(basePath, filename));
    }
    candidates.push(join(basePath, `libghostty-vt.${ext}`));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `libghostty-vt shared library not found.\nChecked:\n  - GHOSTTY_VT_LIB=${envPath ?? "<unset>"}\n  - ${candidates.join("\n  - ")}\n\nSet GHOSTTY_VT_LIB or ensure one of these paths contains the file.`
  );
}

const libPath = resolveLibPath();

export const ghostty = dlopen(libPath, {
  ghostty_terminal_new: {
    args: [FFIType.i32, FFIType.i32],
    returns: FFIType.pointer,
  },
  ghostty_terminal_new_with_config: {
    args: [FFIType.i32, FFIType.i32, FFIType.pointer],
    returns: FFIType.pointer,
  },
  ghostty_terminal_free: { args: [FFIType.pointer], returns: FFIType.void },
  ghostty_terminal_resize: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32],
    returns: FFIType.void,
  },
  ghostty_terminal_write: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  ghostty_render_state_update: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_cols: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_rows: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_cursor_x: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_cursor_y: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_cursor_visible: {
    args: [FFIType.pointer],
    returns: FFIType.bool,
  },
  ghostty_render_state_get_bg_color: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  ghostty_render_state_get_fg_color: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  ghostty_render_state_is_row_dirty: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.bool,
  },
  ghostty_render_state_mark_clean: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  ghostty_render_state_get_viewport: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  ghostty_render_state_get_grapheme: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  ghostty_terminal_is_alternate_screen: {
    args: [FFIType.pointer],
    returns: FFIType.bool,
  },
  ghostty_terminal_has_mouse_tracking: {
    args: [FFIType.pointer],
    returns: FFIType.bool,
  },
  ghostty_terminal_get_mode: {
    args: [FFIType.pointer, FFIType.i32, FFIType.bool],
    returns: FFIType.bool,
  },
  ghostty_terminal_get_scrollback_length: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  ghostty_terminal_get_scrollback_line: {
    args: [FFIType.pointer, FFIType.i32, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  ghostty_terminal_get_scrollback_grapheme: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  ghostty_terminal_is_row_wrapped: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.bool,
  },
  ghostty_terminal_has_response: {
    args: [FFIType.pointer],
    returns: FFIType.bool,
  },
  ghostty_terminal_read_response: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
});
