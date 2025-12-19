//! PTY Operations Module
//! Core operations for managing PTY sessions.
//!
//! All operations use the handle registry for safe concurrent access:
//! - acquireHandle: Gets a reference to the PTY, increments refcount
//! - releaseHandle: Decrements refcount (via defer)
//! - This prevents use-after-free when close races with other operations

const std = @import("std");
const constants = @import("../util/constants.zig");
const handle_registry = @import("../core/handle_registry.zig");
const posix = @import("../util/posix.zig");
const process_info = @import("process_info.zig");
const c = posix.c;

// ============================================================================
// PTY I/O Operations
// ============================================================================

/// Read available data from PTY ring buffer.
/// Returns: bytes read (>= 0), or ERROR (-1) on failure.
pub fn read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.readAvailable(buf, @intCast(len));
}

/// Write data to PTY.
/// Returns: bytes written (>= 0), or ERROR (-1) on failure.
pub fn write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.writeData(data, @intCast(len));
}

// ============================================================================
// PTY Control Operations
// ============================================================================

/// Resize PTY terminal dimensions.
/// Returns: SUCCESS (0) or ERROR (-1).
pub fn resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    if (handle <= 0 or cols <= 0 or rows <= 0) {
        return constants.ERROR;
    }
    // Bounds check: winsize uses u16 for dimensions
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.resize(@intCast(cols), @intCast(rows));
}

/// Send SIGTERM to PTY child process.
/// Returns: SUCCESS (0) or ERROR (-1).
pub fn kill(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.kill();
}

/// Close PTY handle and release resources.
/// Safe to call multiple times (idempotent).
pub fn close(handle: c_int) void {
    if (handle <= 0) {
        return;
    }
    handle_registry.removeHandle(@intCast(handle));
}

// ============================================================================
// PTY Status Operations
// ============================================================================

/// Get PTY child process PID.
/// Returns: PID (> 0) or ERROR (-1).
pub fn getPid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.pid;
}

/// Get PTY child exit code (after process exits).
/// Returns: exit code (>= 0) or ERROR (-1).
pub fn getExitCode(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    pty.checkChild();
    return pty.exit_code.load(.acquire);
}

// ============================================================================
// Foreground Process Detection
// ============================================================================

/// Get the foreground process ID for a PTY.
/// First tries tcgetpgrp(), falls back to child process finding.
/// Returns: foreground PID (> 0) or ERROR (-1).
pub fn getForegroundPid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    // First try tcgetpgrp - returns foreground process group ID
    const pgid = c.tcgetpgrp(pty.master_fd);

    // If tcgetpgrp returns a different PID than shell, use it
    if (pgid > 0 and pgid != pty.pid) {
        return pgid;
    }

    // tcgetpgrp returned shell's PID (job control not active) - find children
    return process_info.findChildProcess(pty.pid);
}
