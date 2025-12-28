const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");
const async_diff = @import("async_diff.zig");
const async_status = @import("async_status.zig");
const repo_status = @import("repo_status.zig");

pub export fn omx_git_init() c_int {
    return c.git_libgit2_init();
}

pub export fn omx_git_shutdown() c_int {
    async_diff.deinitDiffThread();
    async_status.deinitStatusThread();
    return c.git_libgit2_shutdown();
}

pub export fn omx_git_repo_info(
    cwd: [*:0]const u8,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
) c_int {
    var status = repo_status.RepoStatus{};
    repo_status.clearRepoStatus(&status);
    if (!repo_status.computeRepoStatus(cwd, &status)) {
        if (branch_len > 0) repo_status.clearBuffer(branch_buf, @intCast(branch_len));
        if (gitdir_len > 0) repo_status.clearBuffer(gitdir_buf, @intCast(gitdir_len));
        if (workdir_len > 0) repo_status.clearBuffer(workdir_buf, @intCast(workdir_len));
        dirty_out.* = 0;
        return constants.ERROR;
    }

    if (branch_len > 0) {
        repo_status.copyCString(branch_buf, @intCast(branch_len), status.branch[0..]);
    }
    if (gitdir_len > 0) {
        repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), status.gitdir[0..]);
    }
    if (workdir_len > 0) {
        repo_status.copyCString(workdir_buf, @intCast(workdir_len), status.workdir[0..]);
    }
    dirty_out.* = status.dirty;
    return 0;
}

pub export fn omx_git_repo_status(
    cwd: [*:0]const u8,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
    staged_out: *c_int,
    unstaged_out: *c_int,
    untracked_out: *c_int,
    conflicted_out: *c_int,
    ahead_out: *c_int,
    behind_out: *c_int,
    stash_out: *c_int,
    state_out: *c_int,
    detached_out: *u8,
) c_int {
    var status = repo_status.RepoStatus{};
    repo_status.clearRepoStatus(&status);
    if (!repo_status.computeRepoStatus(cwd, &status)) {
        if (branch_len > 0) repo_status.clearBuffer(branch_buf, @intCast(branch_len));
        if (gitdir_len > 0) repo_status.clearBuffer(gitdir_buf, @intCast(gitdir_len));
        if (workdir_len > 0) repo_status.clearBuffer(workdir_buf, @intCast(workdir_len));
        dirty_out.* = 0;
        staged_out.* = 0;
        unstaged_out.* = 0;
        untracked_out.* = 0;
        conflicted_out.* = 0;
        ahead_out.* = constants.STATUS_UNKNOWN;
        behind_out.* = constants.STATUS_UNKNOWN;
        stash_out.* = constants.STATUS_UNKNOWN;
        state_out.* = 0;
        detached_out.* = 0;
        return constants.ERROR;
    }

    if (branch_len > 0) {
        repo_status.copyCString(branch_buf, @intCast(branch_len), status.branch[0..]);
    }
    if (gitdir_len > 0) {
        repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), status.gitdir[0..]);
    }
    if (workdir_len > 0) {
        repo_status.copyCString(workdir_buf, @intCast(workdir_len), status.workdir[0..]);
    }

    dirty_out.* = status.dirty;
    staged_out.* = status.staged;
    unstaged_out.* = status.unstaged;
    untracked_out.* = status.untracked;
    conflicted_out.* = status.conflicted;
    ahead_out.* = status.ahead;
    behind_out.* = status.behind;
    stash_out.* = status.stash_count;
    state_out.* = status.state;
    detached_out.* = status.detached;
    return 0;
}

pub export fn omx_git_diff_stats_async(cwd: [*:0]const u8) c_int {
    if (!async_diff.initDiffThread()) {
        return constants.ERROR;
    }

    const req_id = async_diff.allocDiffRequest() orelse return constants.ERROR;
    const req = async_diff.getDiffRequest(req_id) orelse return constants.ERROR;

    var cwd_len: usize = 0;
    while (cwd[cwd_len] != 0 and cwd_len < constants.MAX_CWD_LEN - 1) : (cwd_len += 1) {
        req.cwd[cwd_len] = cwd[cwd_len];
    }
    req.cwd[cwd_len] = 0;
    req.cwd_len = cwd_len + 1;
    req.state.store(.pending, .release);
    req.added.store(0, .release);
    req.removed.store(0, .release);

    async_diff.signalDiffQueue();

    return @intCast(req_id);
}

pub export fn omx_git_status_async(cwd: [*:0]const u8) c_int {
    if (!async_status.initStatusThread()) {
        return constants.ERROR;
    }

    const req_id = async_status.allocStatusRequest() orelse return constants.ERROR;
    const req = async_status.getStatusRequest(req_id) orelse return constants.ERROR;

    var cwd_len: usize = 0;
    while (cwd[cwd_len] != 0 and cwd_len < constants.MAX_CWD_LEN - 1) : (cwd_len += 1) {
        req.cwd[cwd_len] = cwd[cwd_len];
    }
    req.cwd[cwd_len] = 0;
    req.cwd_len = cwd_len + 1;
    req.state.store(.pending, .release);
    repo_status.clearRepoStatus(&req.status);

    async_status.signalStatusQueue();

    return @intCast(req_id);
}

pub export fn omx_git_diff_stats_poll(
    request_id: c_int,
    out_added: *c_int,
    out_removed: *c_int,
) c_int {
    if (request_id < 0) return constants.DIFF_ERROR;

    const req = async_diff.getDiffRequest(@intCast(request_id)) orelse return constants.DIFF_ERROR;
    const state = req.state.load(.acquire);

    switch (state) {
        .pending => return constants.DIFF_PENDING,
        .complete => {
            out_added.* = req.added.load(.acquire);
            out_removed.* = req.removed.load(.acquire);
            async_diff.freeDiffRequest(@intCast(request_id));
            return 0;
        },
        .failed => {
            async_diff.freeDiffRequest(@intCast(request_id));
            return constants.DIFF_ERROR;
        },
        .cancelled => {
            async_diff.freeDiffRequest(@intCast(request_id));
            return constants.DIFF_ERROR;
        },
    }
}

pub export fn omx_git_status_poll(
    request_id: c_int,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
    staged_out: *c_int,
    unstaged_out: *c_int,
    untracked_out: *c_int,
    conflicted_out: *c_int,
    ahead_out: *c_int,
    behind_out: *c_int,
    stash_out: *c_int,
    state_out: *c_int,
    detached_out: *u8,
) c_int {
    if (request_id < 0) return constants.STATUS_ERROR;

    const req = async_status.getStatusRequest(@intCast(request_id)) orelse return constants.STATUS_ERROR;
    const state = req.state.load(.acquire);

    switch (state) {
        .pending => return constants.STATUS_PENDING,
        .complete => {
            if (branch_len > 0) {
                repo_status.copyCString(branch_buf, @intCast(branch_len), req.status.branch[0..]);
            }
            if (gitdir_len > 0) {
                repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), req.status.gitdir[0..]);
            }
            if (workdir_len > 0) {
                repo_status.copyCString(workdir_buf, @intCast(workdir_len), req.status.workdir[0..]);
            }

            dirty_out.* = req.status.dirty;
            staged_out.* = req.status.staged;
            unstaged_out.* = req.status.unstaged;
            untracked_out.* = req.status.untracked;
            conflicted_out.* = req.status.conflicted;
            ahead_out.* = req.status.ahead;
            behind_out.* = req.status.behind;
            stash_out.* = req.status.stash_count;
            state_out.* = req.status.state;
            detached_out.* = req.status.detached;

            async_status.freeStatusRequest(@intCast(request_id));
            return 0;
        },
        .failed => {
            async_status.freeStatusRequest(@intCast(request_id));
            return constants.STATUS_ERROR;
        },
        .cancelled => {
            async_status.freeStatusRequest(@intCast(request_id));
            return constants.STATUS_ERROR;
        },
    }
}

pub export fn omx_git_diff_stats_cancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_diff.getDiffRequest(@intCast(request_id)) orelse return;

    if (req.state.cmpxchgStrong(.pending, .cancelled, .acq_rel, .acquire)) |old_state| {
        switch (old_state) {
            .complete, .failed => {
                async_diff.freeDiffRequest(@intCast(request_id));
            },
            .pending, .cancelled => {},
        }
    }
}

pub export fn omx_git_status_cancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_status.getStatusRequest(@intCast(request_id)) orelse return;

    if (req.state.cmpxchgStrong(.pending, .cancelled, .acq_rel, .acquire)) |old_state| {
        switch (old_state) {
            .complete, .failed => {
                async_status.freeStatusRequest(@intCast(request_id));
            },
            .pending, .cancelled => {},
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

fn initRepo(allocator: std.mem.Allocator, path: []const u8) !*c.git_repository {
    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);

    var opts: c.git_repository_init_options = undefined;
    _ = c.git_repository_init_options_init(&opts, c.GIT_REPOSITORY_INIT_OPTIONS_VERSION);
    opts.initial_head = "main";

    var repo: ?*c.git_repository = null;
    if (c.git_repository_init_ext(&repo, path_z, &opts) != 0) {
        return error.InitFailed;
    }

    return repo.?;
}

fn commitFile(
    allocator: std.mem.Allocator,
    repo: *c.git_repository,
    dir: std.fs.Dir,
    path: []const u8,
    contents: []const u8,
) !void {
    try dir.writeFile(.{ .sub_path = path, .data = contents });

    var index: ?*c.git_index = null;
    if (c.git_repository_index(&index, repo) != 0 or index == null) {
        return error.IndexFailed;
    }
    defer c.git_index_free(index.?);

    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);

    if (c.git_index_add_bypath(index.?, path_z) != 0) {
        return error.IndexAddFailed;
    }
    _ = c.git_index_write(index.?);

    var tree_id: c.git_oid = undefined;
    if (c.git_index_write_tree(&tree_id, index.?) != 0) {
        return error.TreeFailed;
    }

    var tree: ?*c.git_tree = null;
    if (c.git_tree_lookup(&tree, repo, &tree_id) != 0 or tree == null) {
        return error.TreeLookupFailed;
    }
    defer c.git_tree_free(tree.?);

    var sig: ?*c.git_signature = null;
    if (c.git_signature_now(&sig, "OpenMux", "openmux@example.com") != 0 or sig == null) {
        return error.SignatureFailed;
    }
    defer c.git_signature_free(sig.?);

    var commit_id: c.git_oid = undefined;
    if (c.git_commit_create_v(
        &commit_id,
        repo,
        "HEAD",
        sig.?,
        sig.?,
        null,
        "initial",
        tree.?,
        0,
    ) != 0) {
        return error.CommitFailed;
    }
}

test "repo info marks dirty with untracked files" {
    _ = omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try initRepo(allocator, repo_path);
    defer c.git_repository_free(repo);

    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "one\ntwo\n" });

    var branch_buf: [256]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = omx_git_repo_info(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expect(dirty == 1);
}

test "repo status counts untracked changes" {
    _ = omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try initRepo(allocator, repo_path);
    defer c.git_repository_free(repo);

    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "one\ntwo\n" });

    var branch_buf: [constants.MAX_BRANCH_LEN]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;
    var staged: c_int = 0;
    var unstaged: c_int = 0;
    var untracked: c_int = 0;
    var conflicted: c_int = 0;
    var ahead: c_int = constants.STATUS_UNKNOWN;
    var behind: c_int = constants.STATUS_UNKNOWN;
    var stash: c_int = constants.STATUS_UNKNOWN;
    var state: c_int = 0;
    var detached: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = omx_git_repo_status(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
        &staged,
        &unstaged,
        &untracked,
        &conflicted,
        &ahead,
        &behind,
        &stash,
        &state,
        &detached,
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expectEqual(@as(c_int, 1), untracked);
    try std.testing.expectEqual(@as(c_int, 0), staged);
    try std.testing.expectEqual(@as(c_int, 0), unstaged);
    try std.testing.expectEqual(@as(u8, 1), dirty);
}

test "status async reports branch after commit" {
    _ = omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try initRepo(allocator, repo_path);
    defer c.git_repository_free(repo);

    try commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = omx_git_status_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var branch_buf: [constants.MAX_BRANCH_LEN]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;
    var staged: c_int = 0;
    var unstaged: c_int = 0;
    var untracked: c_int = 0;
    var conflicted: c_int = 0;
    var ahead: c_int = constants.STATUS_UNKNOWN;
    var behind: c_int = constants.STATUS_UNKNOWN;
    var stash: c_int = constants.STATUS_UNKNOWN;
    var state: c_int = 0;
    var detached: u8 = 0;

    var status: c_int = constants.STATUS_PENDING;
    while (status == constants.STATUS_PENDING) {
        status = omx_git_status_poll(
            req_id,
            &branch_buf,
            branch_buf.len,
            &gitdir_buf,
            gitdir_buf.len,
            &workdir_buf,
            workdir_buf.len,
            &dirty,
            &staged,
            &unstaged,
            &untracked,
            &conflicted,
            &ahead,
            &behind,
            &stash,
            &state,
            &detached,
        );
        if (status == constants.STATUS_PENDING) {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    const branch = std.mem.sliceTo(branch_buf[0..], 0);
    try std.testing.expect(std.mem.eql(u8, branch, "main"));
    try std.testing.expectEqual(@as(u8, 0), dirty);
    try std.testing.expectEqual(@as(u8, 0), detached);
}

test "diff stats include untracked changes" {
    _ = omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try initRepo(allocator, repo_path);
    defer c.git_repository_free(repo);

    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "a\nb\nc\n" });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = omx_git_diff_stats_poll(req_id, &added, &removed);
        if (status == constants.DIFF_PENDING) {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    try std.testing.expectEqual(@as(c_int, 3), added);
    try std.testing.expectEqual(@as(c_int, 0), removed);
}

test "repo info returns branch after commit" {
    _ = omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try initRepo(allocator, repo_path);
    defer c.git_repository_free(repo);

    try commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    var branch_buf: [256]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = omx_git_repo_info(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);

    const branch = std.mem.sliceTo(branch_buf[0..], 0);
    try std.testing.expect(std.mem.eql(u8, branch, "main"));
    try std.testing.expect(dirty == 0);
}
