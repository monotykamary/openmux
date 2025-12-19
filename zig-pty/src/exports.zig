//! FFI Export implementations for zig-pty
//!
//! This module provides the FFI-compatible wrapper functions that are
//! exported via main.zig. Each function delegates to the appropriate
//! specialized module:
//!
//! - spawn_ops: PTY spawning (sync and async)
//! - pty_ops: PTY I/O and control operations
//! - process_info: Process inspection (name, cwd, children)

const spawn_ops = @import("spawn_ops.zig");
const pty_ops = @import("pty_ops.zig");
const process_info = @import("process_info.zig");

// ============================================================================
// Synchronous Spawn
// ============================================================================

pub fn bun_pty_spawn(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return spawn_ops.spawn(cmd, cwd, env, cols, rows);
}

// ============================================================================
// Async Spawn
// ============================================================================

pub fn bun_pty_spawn_async(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return spawn_ops.spawnAsync(cmd, cwd, env, cols, rows);
}

pub fn bun_pty_spawn_poll(request_id: c_int) c_int {
    return spawn_ops.spawnPoll(request_id);
}

pub fn bun_pty_spawn_cancel(request_id: c_int) void {
    spawn_ops.spawnCancel(request_id);
}

// ============================================================================
// PTY Operations
// ============================================================================

pub fn bun_pty_read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    return pty_ops.read(handle, buf, len);
}

pub fn bun_pty_write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    return pty_ops.write(handle, data, len);
}

pub fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    return pty_ops.resize(handle, cols, rows);
}

pub fn bun_pty_kill(handle: c_int) c_int {
    return pty_ops.kill(handle);
}

pub fn bun_pty_get_pid(handle: c_int) c_int {
    return pty_ops.getPid(handle);
}

pub fn bun_pty_get_exit_code(handle: c_int) c_int {
    return pty_ops.getExitCode(handle);
}

pub fn bun_pty_close(handle: c_int) void {
    pty_ops.close(handle);
}

// ============================================================================
// Process Inspection
// ============================================================================

pub fn bun_pty_get_foreground_pid(handle: c_int) c_int {
    return pty_ops.getForegroundPid(handle);
}

pub fn bun_pty_get_cwd(pid: c_int, buf: [*]u8, len: c_int) c_int {
    if (len <= 0) return -1;
    return process_info.getProcessCwd(pid, buf, @intCast(len));
}

pub fn bun_pty_get_process_name(pid: c_int, buf: [*]u8, len: c_int) c_int {
    if (len <= 0) return -1;
    return process_info.getProcessName(pid, buf, @intCast(len));
}
