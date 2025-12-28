const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");

pub const DiffState = enum(u8) {
    pending,
    complete,
    failed,
    cancelled,
};

pub const DiffRequest = struct {
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    state: std.atomic.Value(DiffState),
    added: std.atomic.Value(c_int),
    removed: std.atomic.Value(c_int),

    pub fn init() DiffRequest {
        return .{
            .cwd = undefined,
            .cwd_len = 0,
            .state = std.atomic.Value(DiffState).init(.failed),
            .added = std.atomic.Value(c_int).init(0),
            .removed = std.atomic.Value(c_int).init(0),
        };
    }
};

var diff_requests: [constants.MAX_DIFF_REQUESTS]DiffRequest =
    [_]DiffRequest{DiffRequest.init()} ** constants.MAX_DIFF_REQUESTS;
var diff_request_used: [constants.MAX_DIFF_REQUESTS]std.atomic.Value(bool) =
    [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_DIFF_REQUESTS;

var diff_thread: ?std.Thread = null;
var diff_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var diff_thread_mutex: std.Thread.Mutex = .{};
var diff_queue_mutex: std.Thread.Mutex = .{};
var diff_queue_cond: std.Thread.Condition = .{};
var diff_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initDiffThread() bool {
    if (diff_thread_running.load(.acquire)) return true;

    diff_thread_mutex.lock();
    defer diff_thread_mutex.unlock();

    if (diff_thread_running.load(.acquire)) return true;

    diff_thread_running.store(true, .release);

    diff_thread = std.Thread.spawn(.{}, diffThreadLoop, .{}) catch {
        diff_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitDiffThread() void {
    diff_thread_mutex.lock();
    defer diff_thread_mutex.unlock();

    if (!diff_thread_running.load(.acquire)) return;

    diff_thread_running.store(false, .release);

    diff_queue_mutex.lock();
    diff_queue_cond.signal();
    diff_queue_mutex.unlock();

    if (diff_thread) |thread| {
        thread.join();
        diff_thread = null;
    }
}

fn diffThreadLoop() void {
    while (diff_thread_running.load(.acquire)) {
        diff_queue_mutex.lock();
        while (diff_queue_count.load(.acquire) == 0 and diff_thread_running.load(.acquire)) {
            diff_queue_cond.timedWait(&diff_queue_mutex, 100 * std.time.ns_per_ms) catch {};
        }
        diff_queue_mutex.unlock();

        if (!diff_thread_running.load(.acquire)) break;

        for (&diff_requests, 0..) |*req, i| {
            if (!diff_request_used[i].load(.acquire)) continue;

            const state = req.state.load(.acquire);
            if (state == .cancelled) {
                freeDiffRequest(@intCast(i));
                _ = diff_queue_count.fetchSub(1, .release);
                continue;
            }
            if (state != .pending) continue;

            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);

            var added: c_int = 0;
            var removed: c_int = 0;
            const ok = computeDiffStats(cwd_ptr, &added, &removed);

            const new_state: DiffState = if (ok) .complete else .failed;

            if (req.state.cmpxchgStrong(.pending, new_state, .acq_rel, .acquire)) |_| {
                freeDiffRequest(@intCast(i));
            } else {
                req.added.store(added, .release);
                req.removed.store(removed, .release);
            }

            _ = diff_queue_count.fetchSub(1, .release);
        }
    }
}

fn setDiffOptions(options: *c.git_diff_options) void {
    _ = c.git_diff_options_init(options, c.GIT_DIFF_OPTIONS_VERSION);
    options.flags |= c.GIT_DIFF_INCLUDE_UNTRACKED;
    if (@hasDecl(c, "GIT_DIFF_SHOW_UNTRACKED_CONTENT")) {
        options.flags |= c.GIT_DIFF_SHOW_UNTRACKED_CONTENT;
    }
    if (@hasDecl(c, "GIT_DIFF_RECURSE_UNTRACKED_DIRS")) {
        options.flags |= c.GIT_DIFF_RECURSE_UNTRACKED_DIRS;
    }
}

fn computeDiffStats(
    cwd: [*:0]const u8,
    out_added: *c_int,
    out_removed: *c_int,
) bool {
    var repo: ?*c.git_repository = null;
    if (c.git_repository_open_ext(&repo, cwd, c.GIT_REPOSITORY_OPEN_FROM_ENV, null) != 0) {
        return false;
    }
    defer c.git_repository_free(repo.?);

    var diff_opts: c.git_diff_options = undefined;
    setDiffOptions(&diff_opts);

    var diff: ?*c.git_diff = null;
    var head_ref: ?*c.git_reference = null;
    var head_commit: ?*c.git_commit = null;
    var head_tree: ?*c.git_tree = null;

    const unborn = if (@hasDecl(c, "git_repository_head_unborn"))
        c.git_repository_head_unborn(repo.?)
    else
        0;

    if (unborn == 1) {
        if (c.git_diff_index_to_workdir(&diff, repo.?, null, &diff_opts) != 0) {
            return false;
        }
    } else {
        if (c.git_repository_head(&head_ref, repo.?) == 0 and head_ref != null) {
            const oid = c.git_reference_target(head_ref.?);
            if (oid != null) {
                if (c.git_commit_lookup(&head_commit, repo.?, oid) == 0 and head_commit != null) {
                    if (c.git_commit_tree(&head_tree, head_commit.?) == 0 and head_tree != null) {
                        if (c.git_diff_tree_to_workdir_with_index(&diff, repo.?, head_tree.?, &diff_opts) != 0) {
                            diff = null;
                        }
                    }
                }
            }
        }

        if (diff == null) {
            if (c.git_diff_index_to_workdir(&diff, repo.?, null, &diff_opts) != 0) {
                if (head_ref) |ref| c.git_reference_free(ref);
                if (head_commit) |commit| c.git_commit_free(commit);
                if (head_tree) |tree| c.git_tree_free(tree);
                return false;
            }
        }
    }

    if (head_ref) |ref| c.git_reference_free(ref);
    if (head_commit) |commit| c.git_commit_free(commit);
    if (head_tree) |tree| c.git_tree_free(tree);

    if (diff == null) return false;
    defer c.git_diff_free(diff.?);

    var stats: ?*c.git_diff_stats = null;
    if (c.git_diff_get_stats(&stats, diff.?) != 0 or stats == null) {
        return false;
    }
    defer c.git_diff_stats_free(stats.?);

    const added = c.git_diff_stats_insertions(stats.?);
    const removed = c.git_diff_stats_deletions(stats.?);

    out_added.* = @intCast(added);
    out_removed.* = @intCast(removed);
    return true;
}

pub fn allocDiffRequest() ?u32 {
    for (&diff_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                return @intCast(i);
            }
        }
    }
    return null;
}

pub fn freeDiffRequest(id: u32) void {
    if (id >= constants.MAX_DIFF_REQUESTS) return;
    diff_request_used[id].store(false, .release);
    diff_requests[id].state.store(.failed, .release);
    diff_requests[id].added.store(0, .release);
    diff_requests[id].removed.store(0, .release);
}

pub fn getDiffRequest(id: u32) ?*DiffRequest {
    if (id >= constants.MAX_DIFF_REQUESTS) return null;
    if (!diff_request_used[id].load(.acquire)) return null;
    return &diff_requests[id];
}

pub fn signalDiffQueue() void {
    _ = diff_queue_count.fetchAdd(1, .release);
    diff_queue_cond.signal();
}
