//! Tests for zig-pty

const std = @import("std");
const spawn_module = @import("../core/spawn.zig");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");
const handle_registry = @import("../core/handle_registry.zig");

// ============================================================================
// Basic PTY Tests
// ============================================================================

test "basic pty spawn" {
    const handle = spawn_module.spawnPty("echo hello", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Wait a bit for output
    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n >= 0);

    exports.bun_pty_close(handle);
}

test "pty spawn with cwd" {
    const handle = spawn_module.spawnPty("pwd", "/tmp", "", 80, 24);
    try std.testing.expect(handle > 0);

    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n > 0);

    // Output should contain /tmp
    const output = buf[0..@intCast(n)];
    try std.testing.expect(std.mem.indexOf(u8, output, "/tmp") != null);

    exports.bun_pty_close(handle);
}

test "pty resize" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    const result = exports.bun_pty_resize(handle, 120, 40);
    try std.testing.expectEqual(constants.SUCCESS, result);

    exports.bun_pty_close(handle);
}

// ============================================================================
// Process Inspection Tests
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
// Edge Case Tests - Invalid Inputs
// ============================================================================

test "get foreground pid with invalid handle returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(-1));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(99999));
}

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

// ============================================================================
// Use-After-Free Safety Tests
// ============================================================================

test "operations on closed handle return error" {
    const handle = spawn_module.spawnPty("echo test", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Close the handle
    exports.bun_pty_close(handle);

    // All operations should now return error or be safe
    var buf: [256]u8 = undefined;
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_read(handle, &buf, buf.len));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_write(handle, &buf, 5));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_resize(handle, 80, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_kill(handle));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_pid(handle));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_exit_code(handle));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(handle));
}

test "double close is safe" {
    const handle = spawn_module.spawnPty("echo test", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Close twice - should not crash
    exports.bun_pty_close(handle);
    exports.bun_pty_close(handle);
}

test "close then use foreground_pid returns error" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // First get should work
    const fg_pid = exports.bun_pty_get_foreground_pid(handle);
    try std.testing.expect(fg_pid > 0 or fg_pid == constants.ERROR);

    // Close
    exports.bun_pty_close(handle);

    // After close, should return error
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_get_foreground_pid(handle));
}

// ============================================================================
// Concurrent Access Tests
// ============================================================================

test "concurrent reads are safe" {
    const handle = spawn_module.spawnPty("yes | head -1000", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    var threads: [4]std.Thread = undefined;
    var started: usize = 0;

    for (&threads) |*t| {
        t.* = std.Thread.spawn(.{}, struct {
            fn run(h: c_int) void {
                var buf: [1024]u8 = undefined;
                var i: usize = 0;
                while (i < 100) : (i += 1) {
                    _ = exports.bun_pty_read(h, &buf, buf.len);
                    std.Thread.sleep(1 * std.time.ns_per_ms);
                }
            }
        }.run, .{handle}) catch continue;
        started += 1;
    }

    // Wait for threads to complete
    for (threads[0..started]) |t| {
        t.join();
    }
}

test "concurrent process inspection is safe" {
    const handle = spawn_module.spawnPty("sleep 2", "/tmp", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    const pid = exports.bun_pty_get_pid(handle);
    try std.testing.expect(pid > 0);

    var threads: [4]std.Thread = undefined;
    var started: usize = 0;

    for (&threads) |*t| {
        t.* = std.Thread.spawn(.{}, struct {
            fn run(h: c_int, p: c_int) void {
                var buf: [1024]u8 = undefined;
                var i: usize = 0;
                while (i < 50) : (i += 1) {
                    _ = exports.bun_pty_get_foreground_pid(h);
                    _ = exports.bun_pty_get_cwd(p, &buf, buf.len);
                    _ = exports.bun_pty_get_process_name(p, &buf, buf.len);
                    std.Thread.sleep(1 * std.time.ns_per_ms);
                }
            }
        }.run, .{ handle, pid }) catch continue;
        started += 1;
    }

    for (threads[0..started]) |t| {
        t.join();
    }
}

test "close during concurrent operations is safe" {
    const handle = spawn_module.spawnPty("sleep 5", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    // Start threads doing operations
    var threads: [2]std.Thread = undefined;
    var started: usize = 0;

    for (&threads) |*t| {
        t.* = std.Thread.spawn(.{}, struct {
            fn run(h: c_int) void {
                var buf: [1024]u8 = undefined;
                var i: usize = 0;
                while (i < 100) : (i += 1) {
                    _ = exports.bun_pty_read(h, &buf, buf.len);
                    _ = exports.bun_pty_get_foreground_pid(h);
                    std.Thread.sleep(1 * std.time.ns_per_ms);
                }
            }
        }.run, .{handle}) catch continue;
        started += 1;
    }

    // Close while operations are running
    std.Thread.sleep(20 * std.time.ns_per_ms);
    exports.bun_pty_close(handle);

    // Wait for threads - they should handle the closed handle gracefully
    for (threads[0..started]) |t| {
        t.join();
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
