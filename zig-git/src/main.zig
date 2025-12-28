const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");
const async_diff = @import("async_diff.zig");

fn clearBuffer(buf: [*]u8, len: usize) void {
    if (len == 0) return;
    buf[0] = 0;
}

fn copyCString(dest: [*]u8, dest_len: usize, src: [*:0]const u8) void {
    if (dest_len == 0) return;
    var i: usize = 0;
    while (i + 1 < dest_len and src[i] != 0) : (i += 1) {
        dest[i] = src[i];
    }
    dest[i] = 0;
}

fn writeShortOid(dest: [*]u8, dest_len: usize, oid: *const c.git_oid) void {
    if (dest_len == 0) return;
    var tmp: [c.GIT_OID_HEXSZ + 1]u8 = undefined;
    _ = c.git_oid_tostr(&tmp, tmp.len, oid);
    const short_len: usize = if (dest_len > 7) 7 else dest_len - 1;
    std.mem.copyForwards(u8, dest[0..short_len], tmp[0..short_len]);
    dest[short_len] = 0;
}

fn getBranch(repo: *c.git_repository, dest: [*]u8, dest_len: usize) void {
    clearBuffer(dest, dest_len);

    var head_ref: ?*c.git_reference = null;
    const head_result = c.git_repository_head(&head_ref, repo);
    if (head_result == 0 and head_ref != null) {
        if (c.git_reference_is_branch(head_ref.?) == 1) {
            const name = c.git_reference_shorthand(head_ref.?);
            if (name != null) {
                copyCString(dest, dest_len, name);
            }
        } else {
            const oid = c.git_reference_target(head_ref.?);
            if (oid != null) {
                writeShortOid(dest, dest_len, oid);
            }
        }
        c.git_reference_free(head_ref.?);
        return;
    }

    if (head_ref) |ref| c.git_reference_free(ref);

    var oid: c.git_oid = undefined;
    if (c.git_reference_name_to_id(&oid, repo, "HEAD") == 0) {
        writeShortOid(dest, dest_len, &oid);
    }
}

fn isDirty(repo: *c.git_repository) bool {
    var status_opts: c.git_status_options = undefined;
    _ = c.git_status_options_init(&status_opts, c.GIT_STATUS_OPTIONS_VERSION);
    status_opts.show = c.GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
    status_opts.flags |= c.GIT_STATUS_OPT_INCLUDE_UNTRACKED;
    if (@hasDecl(c, "GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS")) {
        status_opts.flags |= c.GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;
    }
    status_opts.flags |= c.GIT_STATUS_OPT_DISABLE_PATHSPEC_MATCH;

    var status_list: ?*c.git_status_list = null;
    if (c.git_status_list_new(&status_list, repo, &status_opts) != 0 or status_list == null) {
        return false;
    }
    defer c.git_status_list_free(status_list.?);

    return c.git_status_list_entrycount(status_list.?) > 0;
}

pub export fn omx_git_init() c_int {
    return c.git_libgit2_init();
}

pub export fn omx_git_shutdown() c_int {
    async_diff.deinitDiffThread();
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
    var repo: ?*c.git_repository = null;
    if (c.git_repository_open_ext(&repo, cwd, c.GIT_REPOSITORY_OPEN_FROM_ENV, null) != 0) {
        if (branch_len > 0) clearBuffer(branch_buf, @intCast(branch_len));
        if (gitdir_len > 0) clearBuffer(gitdir_buf, @intCast(gitdir_len));
        if (workdir_len > 0) clearBuffer(workdir_buf, @intCast(workdir_len));
        dirty_out.* = 0;
        return constants.ERROR;
    }
    defer c.git_repository_free(repo.?);

    if (branch_len > 0) {
        getBranch(repo.?, branch_buf, @intCast(branch_len));
    }

    if (gitdir_len > 0) {
        const gitdir = c.git_repository_path(repo.?);
        if (gitdir != null) {
            copyCString(gitdir_buf, @intCast(gitdir_len), gitdir);
        } else {
            clearBuffer(gitdir_buf, @intCast(gitdir_len));
        }
    }

    if (workdir_len > 0) {
        const workdir = c.git_repository_workdir(repo.?);
        if (workdir != null) {
            copyCString(workdir_buf, @intCast(workdir_len), workdir);
        } else {
            clearBuffer(workdir_buf, @intCast(workdir_len));
        }
    }

    dirty_out.* = if (isDirty(repo.?)) 1 else 0;
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
