//! Async Spawn Infrastructure
//! Allows PTY spawning on a background thread to avoid blocking the main thread

const std = @import("std");
const constants = @import("../util/constants.zig");
const spawn_module = @import("spawn.zig");

pub const SpawnState = enum(u8) {
    pending,
    complete,
    failed,
};

pub const SpawnRequest = struct {
    // Input parameters (copied to owned buffers)
    cmd: [constants.MAX_CMD_LEN]u8,
    cmd_len: usize,
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    env: [constants.MAX_ENV_LEN]u8,
    env_len: usize,
    cols: u16,
    rows: u16,
    // Output
    state: std.atomic.Value(SpawnState),
    result_handle: std.atomic.Value(c_int),
};

// Spawn request slots
var spawn_requests: [constants.MAX_SPAWN_REQUESTS]SpawnRequest = undefined;
var spawn_request_used: [constants.MAX_SPAWN_REQUESTS]std.atomic.Value(bool) = [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_SPAWN_REQUESTS;

// Spawn thread state
var spawn_thread: ?std.Thread = null;
var spawn_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var spawn_thread_mutex: std.Thread.Mutex = .{};
var spawn_queue_mutex: std.Thread.Mutex = .{};
var spawn_queue_cond: std.Thread.Condition = .{};
var spawn_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initSpawnThread() bool {
    // Fast path: already running
    if (spawn_thread_running.load(.acquire)) return true;

    spawn_thread_mutex.lock();
    defer spawn_thread_mutex.unlock();

    // Double-check under lock
    if (spawn_thread_running.load(.acquire)) return true;

    // Set running BEFORE spawning to avoid race where thread sees false and exits
    spawn_thread_running.store(true, .release);

    spawn_thread = std.Thread.spawn(.{}, spawnThreadLoop, .{}) catch {
        spawn_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitSpawnThread() void {
    spawn_thread_mutex.lock();
    defer spawn_thread_mutex.unlock();

    if (!spawn_thread_running.load(.acquire)) return;

    // Signal thread to stop
    spawn_thread_running.store(false, .release);

    // Wake the thread if waiting on condition
    spawn_queue_mutex.lock();
    spawn_queue_cond.signal();
    spawn_queue_mutex.unlock();

    // Join the thread
    if (spawn_thread) |thread| {
        thread.join();
        spawn_thread = null;
    }
}

fn spawnThreadLoop() void {
    while (spawn_thread_running.load(.acquire)) {
        // Wait for work
        spawn_queue_mutex.lock();
        while (spawn_queue_count.load(.acquire) == 0 and spawn_thread_running.load(.acquire)) {
            spawn_queue_cond.timedWait(&spawn_queue_mutex, 100 * std.time.ns_per_ms) catch {};
        }
        spawn_queue_mutex.unlock();

        if (!spawn_thread_running.load(.acquire)) break;

        // Process all pending requests
        for (&spawn_requests, 0..) |*req, i| {
            if (!spawn_request_used[i].load(.acquire)) continue;
            if (req.state.load(.acquire) != .pending) continue;

            // Do the actual spawn (this is the slow part we moved off main thread)
            const cmd_ptr: [*:0]const u8 = @ptrCast(req.cmd[0..req.cmd_len]);
            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);
            const env_ptr: [*:0]const u8 = @ptrCast(req.env[0..req.env_len]);

            const result = spawn_module.spawnPty(cmd_ptr, cwd_ptr, env_ptr, req.cols, req.rows);

            if (result >= 0) {
                req.result_handle.store(result, .release);
                req.state.store(.complete, .release);
            } else {
                req.result_handle.store(result, .release);
                req.state.store(.failed, .release);
            }

            _ = spawn_queue_count.fetchSub(1, .release);
        }
    }
}

pub fn allocSpawnRequest() ?u32 {
    for (&spawn_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                return @intCast(i);
            }
        }
    }
    return null;
}

pub fn freeSpawnRequest(id: u32) void {
    if (id >= constants.MAX_SPAWN_REQUESTS) return;
    spawn_request_used[id].store(false, .release);
}

pub fn getSpawnRequest(id: u32) ?*SpawnRequest {
    if (id >= constants.MAX_SPAWN_REQUESTS) return null;
    if (!spawn_request_used[id].load(.acquire)) return null;
    return &spawn_requests[id];
}

pub fn signalSpawnQueue() void {
    _ = spawn_queue_count.fetchAdd(1, .release);
    spawn_queue_cond.signal();
}
