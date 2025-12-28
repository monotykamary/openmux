const std = @import("std");

const constants = @import("constants.zig");
const repo_status = @import("repo_status.zig");

pub const StatusState = enum(u8) {
    pending,
    complete,
    failed,
    cancelled,
};

pub const StatusRequest = struct {
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    state: std.atomic.Value(StatusState),
    status: repo_status.RepoStatus,

    pub fn init() StatusRequest {
        var status = repo_status.RepoStatus{};
        repo_status.clearRepoStatus(&status);
        return .{
            .cwd = undefined,
            .cwd_len = 0,
            .state = std.atomic.Value(StatusState).init(.failed),
            .status = status,
        };
    }
};

var status_requests: [constants.MAX_STATUS_REQUESTS]StatusRequest =
    [_]StatusRequest{StatusRequest.init()} ** constants.MAX_STATUS_REQUESTS;
var status_request_used: [constants.MAX_STATUS_REQUESTS]std.atomic.Value(bool) =
    [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_STATUS_REQUESTS;

var status_thread: ?std.Thread = null;
var status_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var status_thread_mutex: std.Thread.Mutex = .{};
var status_queue_mutex: std.Thread.Mutex = .{};
var status_queue_cond: std.Thread.Condition = .{};
var status_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initStatusThread() bool {
    if (status_thread_running.load(.acquire)) return true;

    status_thread_mutex.lock();
    defer status_thread_mutex.unlock();

    if (status_thread_running.load(.acquire)) return true;

    status_thread_running.store(true, .release);

    status_thread = std.Thread.spawn(.{}, statusThreadLoop, .{}) catch {
        status_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitStatusThread() void {
    status_thread_mutex.lock();
    defer status_thread_mutex.unlock();

    if (!status_thread_running.load(.acquire)) return;

    status_thread_running.store(false, .release);

    status_queue_mutex.lock();
    status_queue_cond.signal();
    status_queue_mutex.unlock();

    if (status_thread) |thread| {
        thread.join();
        status_thread = null;
    }
}

fn statusThreadLoop() void {
    while (status_thread_running.load(.acquire)) {
        status_queue_mutex.lock();
        while (status_queue_count.load(.acquire) == 0 and status_thread_running.load(.acquire)) {
            status_queue_cond.timedWait(&status_queue_mutex, 100 * std.time.ns_per_ms) catch {};
        }
        status_queue_mutex.unlock();

        if (!status_thread_running.load(.acquire)) break;

        for (&status_requests, 0..) |*req, i| {
            if (!status_request_used[i].load(.acquire)) continue;

            const state = req.state.load(.acquire);
            if (state == .cancelled) {
                freeStatusRequest(@intCast(i));
                _ = status_queue_count.fetchSub(1, .release);
                continue;
            }
            if (state != .pending) continue;

            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);
            const ok = repo_status.computeRepoStatus(cwd_ptr, &req.status);

            const new_state: StatusState = if (ok) .complete else .failed;

            if (req.state.cmpxchgStrong(.pending, new_state, .acq_rel, .acquire)) |_| {
                freeStatusRequest(@intCast(i));
            }

            _ = status_queue_count.fetchSub(1, .release);
        }
    }
}

pub fn allocStatusRequest() ?u32 {
    for (&status_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                return @intCast(i);
            }
        }
    }
    return null;
}

pub fn freeStatusRequest(id: u32) void {
    if (id >= constants.MAX_STATUS_REQUESTS) return;
    status_request_used[id].store(false, .release);
    status_requests[id].state.store(.failed, .release);
    repo_status.clearRepoStatus(&status_requests[id].status);
}

pub fn getStatusRequest(id: u32) ?*StatusRequest {
    if (id >= constants.MAX_STATUS_REQUESTS) return null;
    if (!status_request_used[id].load(.acquire)) return null;
    return &status_requests[id];
}

pub fn signalStatusQueue() void {
    _ = status_queue_count.fetchAdd(1, .release);
    status_queue_cond.signal();
}
