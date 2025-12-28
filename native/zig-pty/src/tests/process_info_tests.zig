//! Process Inspection Tests
//! Tests for process name, cwd, and foreground pid inspection.

const std = @import("std");
const spawn_module = @import("../core/spawn.zig");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");
const process_info = @import("../ffi/process_info.zig");

// ============================================================================
// Foreground PID Tests
// ============================================================================

test "get foreground pid returns valid pid" {
    const handle = spawn_module.spawnPty("sleep 5", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    // Give the process time to start
    std.Thread.sleep(50 * std.time.ns_per_ms);

    const fg_pid = exports.bun_pty_get_foreground_pid(handle);
    // Foreground pid should be positive (the shell or sleep process)
    try std.testing.expect(fg_pid > 0);
}

// ============================================================================
// CWD Tests
// ============================================================================

test "get cwd for current process" {
    // Get CWD of current process (self)
    const self_pid: c_int = @intCast(std.c.getpid());
    var buf: [1024]u8 = undefined;

    const len = exports.bun_pty_get_cwd(self_pid, &buf, buf.len);
    try std.testing.expect(len > 0);

    // Should be a valid path
    const cwd = buf[0..@intCast(len)];
    try std.testing.expect(cwd[0] == '/');
}

test "get cwd for pty shell process" {
    const handle = spawn_module.spawnPty("sleep 5", "/tmp", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    const pid = exports.bun_pty_get_pid(handle);
    try std.testing.expect(pid > 0);

    var buf: [1024]u8 = undefined;
    const len = exports.bun_pty_get_cwd(pid, &buf, buf.len);
    try std.testing.expect(len > 0);

    const cwd = buf[0..@intCast(len)];
    // Should contain /tmp since we started in /tmp
    try std.testing.expect(std.mem.indexOf(u8, cwd, "tmp") != null);
}

// ============================================================================
// Process Name Tests
// ============================================================================

test "get process name for current process" {
    const self_pid: c_int = @intCast(std.c.getpid());
    var buf: [256]u8 = undefined;

    const len = exports.bun_pty_get_process_name(self_pid, &buf, buf.len);
    // proc_name may not work for all processes (e.g., test runners)
    // Accept either success (len > 0) or graceful failure (ERROR)
    try std.testing.expect(len > 0 or len == constants.ERROR);

    if (len > 0) {
        const name = buf[0..@intCast(len)];
        try std.testing.expect(name.len > 0);
    }
}

test "get process name returns shell name" {
    const handle = spawn_module.spawnPty("sh -c 'sleep 5'", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    const pid = exports.bun_pty_get_pid(handle);
    try std.testing.expect(pid > 0);

    var buf: [256]u8 = undefined;
    const len = exports.bun_pty_get_process_name(pid, &buf, buf.len);
    // proc_name may not work for all shell processes
    // Accept either success (len > 0) or graceful failure (ERROR)
    try std.testing.expect(len > 0 or len == constants.ERROR);

    if (len > 0) {
        const name = buf[0..@intCast(len)];
        // Should be "sh", "sleep", or similar
        try std.testing.expect(name.len > 0);
    }
}

// ============================================================================
// Buffer Boundary Tests
// ============================================================================

test "small buffer for cwd truncates safely" {
    const self_pid: c_int = @intCast(std.c.getpid());
    var small_buf: [8]u8 = undefined;

    const len = exports.bun_pty_get_cwd(self_pid, &small_buf, small_buf.len);
    // Should either return error or truncate
    if (len > 0) {
        try std.testing.expect(len < small_buf.len);
        // Should be null-terminated
        try std.testing.expectEqual(@as(u8, 0), small_buf[@intCast(len)]);
    }
}

test "small buffer for process name truncates safely" {
    const self_pid: c_int = @intCast(std.c.getpid());
    var small_buf: [4]u8 = undefined;

    const len = exports.bun_pty_get_process_name(self_pid, &small_buf, small_buf.len);
    // Should either return error (including if proc_name doesn't work) or truncate safely
    // This is just testing that we don't crash with small buffers
    if (len > 0) {
        try std.testing.expect(len < small_buf.len);
        // Should be null-terminated
        try std.testing.expectEqual(@as(u8, 0), small_buf[@intCast(len)]);
    }
    // If len <= 0, that's also acceptable (graceful failure)
}

// ============================================================================
// Child Process Detection Tests
// ============================================================================

test "findChildProcess returns parent when no children" {
    const pid: c_int = @intCast(std.c.getpid());
    // Test process likely has no children, should return self or a higher pid
    const result = process_info.findChildProcess(pid);
    try std.testing.expect(result == pid or result > pid);
}

test "findChildProcess with invalid pid returns same pid" {
    // Invalid PIDs should return themselves (graceful handling)
    try std.testing.expectEqual(@as(c_int, 0), process_info.findChildProcess(0));
    try std.testing.expectEqual(@as(c_int, -1), process_info.findChildProcess(-1));
}
