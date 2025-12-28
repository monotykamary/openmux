//! Safety Tests
//! Tests for use-after-free prevention, double-close safety,
//! concurrent access, and handle reuse scenarios.

const std = @import("std");
const spawn_module = @import("../core/spawn.zig");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");

// ============================================================================
// Use-After-Free Prevention Tests
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
// Handle Reuse Safety Tests
// ============================================================================

test "handle reuse after close is safe" {
    // Spawn and close multiple times to trigger handle reuse
    var i: usize = 0;
    while (i < 10) : (i += 1) {
        const handle = spawn_module.spawnPty("echo test", "", "", 80, 24);
        try std.testing.expect(handle > 0);

        std.Thread.sleep(50 * std.time.ns_per_ms);
        exports.bun_pty_close(handle);

        // Brief pause to allow cleanup
        std.Thread.sleep(10 * std.time.ns_per_ms);
    }
}

test "rapid spawn close cycles" {
    // Stress test: rapid spawn/close without waiting
    var i: usize = 0;
    while (i < 20) : (i += 1) {
        const handle = spawn_module.spawnPty("true", "", "", 80, 24);
        if (handle > 0) {
            exports.bun_pty_close(handle);
        }
    }

    // Give time for all cleanup to complete
    std.Thread.sleep(500 * std.time.ns_per_ms);
}

test "concurrent spawn and close different handles" {
    const handle1 = spawn_module.spawnPty("sleep 2", "", "", 80, 24);
    try std.testing.expect(handle1 > 0);

    const handle2 = spawn_module.spawnPty("sleep 2", "", "", 80, 24);
    try std.testing.expect(handle2 > 0);

    // Close first handle while second is still running
    exports.bun_pty_close(handle1);

    // Operations on second handle should still work
    std.Thread.sleep(50 * std.time.ns_per_ms);
    const pid2 = exports.bun_pty_get_pid(handle2);
    try std.testing.expect(pid2 > 0);

    exports.bun_pty_close(handle2);
}

// ============================================================================
// Stress Tests
// ============================================================================

test "many sequential spawns" {
    var i: usize = 0;
    while (i < 30) : (i += 1) {
        const handle = spawn_module.spawnPty("true", "", "", 80, 24);
        try std.testing.expect(handle > 0);
        std.Thread.sleep(20 * std.time.ns_per_ms);
        exports.bun_pty_close(handle);
    }
}

test "concurrent operations on same handle" {
    const handle = spawn_module.spawnPty("yes | head -5000", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    var threads: [3]std.Thread = undefined;
    var started: usize = 0;

    // Thread 1: reads
    threads[0] = std.Thread.spawn(.{}, struct {
        fn run(h: c_int) void {
            var buf: [1024]u8 = undefined;
            var j: usize = 0;
            while (j < 50) : (j += 1) {
                _ = exports.bun_pty_read(h, &buf, buf.len);
                std.Thread.sleep(2 * std.time.ns_per_ms);
            }
        }
    }.run, .{handle}) catch unreachable;
    started += 1;

    // Thread 2: resizes
    threads[1] = std.Thread.spawn(.{}, struct {
        fn run(h: c_int) void {
            var j: usize = 0;
            while (j < 20) : (j += 1) {
                _ = exports.bun_pty_resize(h, 80 + @as(c_int, @intCast(j)), 24);
                std.Thread.sleep(5 * std.time.ns_per_ms);
            }
        }
    }.run, .{handle}) catch unreachable;
    started += 1;

    // Thread 3: gets pid/fg_pid
    threads[2] = std.Thread.spawn(.{}, struct {
        fn run(h: c_int) void {
            var j: usize = 0;
            while (j < 30) : (j += 1) {
                _ = exports.bun_pty_get_pid(h);
                _ = exports.bun_pty_get_foreground_pid(h);
                std.Thread.sleep(3 * std.time.ns_per_ms);
            }
        }
    }.run, .{handle}) catch unreachable;
    started += 1;

    for (threads[0..started]) |t| {
        t.join();
    }
}
