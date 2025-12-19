//! zig-pty: Pure Zig PTY implementation for Bun FFI
//!
//! A minimal, high-performance pseudoterminal library.
//! Uses direct POSIX calls - no external dependencies.
//!
//! Architecture:
//! - Background reader thread does blocking reads for natural data coalescing
//! - Ring buffer allows lock-free producer/consumer pattern
//! - JS polls the ring buffer, getting complete chunks
//!
//! Module structure:
//! - constants.zig: Shared constants
//! - posix.zig: POSIX bindings
//! - ring_buffer.zig: Lock-free SPSC ring buffer
//! - pty.zig: PTY handle with background reader
//! - handle_registry.zig: PTY handle management
//! - spawn.zig: PTY creation
//! - async_spawn.zig: Background thread spawn infrastructure
//! - exports.zig: FFI export implementations

const std = @import("std");
const exports = @import("exports.zig");

// ============================================================================
// FFI Exports - These must be `export fn` to create symbols in the shared lib
// ============================================================================

export fn bun_pty_spawn(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return exports.bun_pty_spawn(cmd, cwd, env, cols, rows);
}

export fn bun_pty_spawn_async(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return exports.bun_pty_spawn_async(cmd, cwd, env, cols, rows);
}

export fn bun_pty_spawn_poll(request_id: c_int) c_int {
    return exports.bun_pty_spawn_poll(request_id);
}

export fn bun_pty_spawn_cancel(request_id: c_int) void {
    exports.bun_pty_spawn_cancel(request_id);
}

export fn bun_pty_read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_read(handle, buf, len);
}

export fn bun_pty_write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    return exports.bun_pty_write(handle, data, len);
}

export fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    return exports.bun_pty_resize(handle, cols, rows);
}

export fn bun_pty_kill(handle: c_int) c_int {
    return exports.bun_pty_kill(handle);
}

export fn bun_pty_get_pid(handle: c_int) c_int {
    return exports.bun_pty_get_pid(handle);
}

export fn bun_pty_get_exit_code(handle: c_int) c_int {
    return exports.bun_pty_get_exit_code(handle);
}

export fn bun_pty_close(handle: c_int) void {
    exports.bun_pty_close(handle);
}

// ============================================================================
// Process Inspection
// ============================================================================

export fn bun_pty_get_foreground_pid(handle: c_int) c_int {
    return exports.bun_pty_get_foreground_pid(handle);
}

export fn bun_pty_get_cwd(pid: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_get_cwd(pid, buf, len);
}

export fn bun_pty_get_process_name(pid: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_get_process_name(pid, buf, len);
}

// ============================================================================
// Tests
// ============================================================================

test {
    _ = @import("tests.zig");
}
