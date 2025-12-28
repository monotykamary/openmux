//! Validation Tests
//! Tests for input validation, invalid handles, invalid dimensions,
//! zero-length buffers, and other edge cases.

const std = @import("std");
const spawn_module = @import("../core/spawn.zig");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");

// ============================================================================
// Invalid Handle Tests
// ============================================================================

test "get foreground pid with invalid handle returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(-1));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(99999));
}

test "read with invalid handle returns error" {
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_read(0, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_read(-1, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_read(99999, &buf, buf.len));
}

test "write with invalid handle returns error" {
    const data = "test";
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_write(0, data.ptr, 4));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_write(-1, data.ptr, 4));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_write(99999, data.ptr, 4));
}

test "kill with invalid handle returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_kill(0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_kill(-1));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_kill(99999));
}

test "resize with invalid handle returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(0, 80, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(-1, 80, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(99999, 80, 24));
}

// ============================================================================
// Invalid PID Tests
// ============================================================================

test "get cwd with invalid pid returns error" {
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_cwd(0, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_cwd(-1, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_cwd(99999999, &buf, buf.len));
}

test "get process name with invalid pid returns error" {
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_process_name(0, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_process_name(-1, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_process_name(99999999, &buf, buf.len));
}

// ============================================================================
// Zero Buffer Length Tests
// ============================================================================

test "get cwd with zero buffer length returns error" {
    const self_pid: c_int = @intCast(std.c.getpid());
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_cwd(self_pid, &buf, 0));
}

test "get process name with zero buffer length returns error" {
    const self_pid: c_int = @intCast(std.c.getpid());
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_process_name(self_pid, &buf, 0));
}

test "write with zero length returns error" {
    const handle = spawn_module.spawnPty("cat", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    const data = "test";
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_write(handle, data.ptr, 0));
}

test "read with zero length returns error" {
    const handle = spawn_module.spawnPty("echo test", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_read(handle, &buf, 0));
}

// ============================================================================
// Invalid Dimension Tests
// ============================================================================

test "spawn with invalid dimensions returns error" {
    // Zero dimensions
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn("echo", "", "", 0, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn("echo", "", "", 80, 0));

    // Negative dimensions
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn("echo", "", "", -1, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn("echo", "", "", 80, -1));
}

test "resize with invalid dimensions returns error" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    // Zero dimensions
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(handle, 0, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(handle, 80, 0));

    // Negative dimensions
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(handle, -1, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(handle, 80, -1));
}

test "async spawn invalid dimensions returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 0, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, 0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", -1, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, -1));
}

// ============================================================================
// Invalid Request ID Tests
// ============================================================================

test "async spawn poll invalid request returns error" {
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(-1));
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(99999));
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
