const std = @import("std");
const constants = @import("constants.zig");
const helpers = @import("test_helpers.zig");
const c = helpers.c;
const api = @import("api.zig");

test "repo info marks dirty with untracked files" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "one\ntwo\n" });

    var branch_buf: [256]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = api.omx_git_repo_info(
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
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

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

    const rc = api.omx_git_repo_status(
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
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_status_async(repo_path_z);
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
        status = api.omx_git_status_poll(
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

test "diff stats include tracked changes" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "a\nb\n");
    try tmp.dir.writeFile(.{ .sub_path = "tracked.txt", .data = "a\nb\nc\n" });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    try std.testing.expectEqual(@as(c_int, 1), added);
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 0), binary);
}

test "diff stats include untracked changes" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");
    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "one\ntwo\nthree\n" });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    if (@hasDecl(c, "GIT_DIFF_SHOW_UNTRACKED_CONTENT")) {
        try std.testing.expectEqual(@as(c_int, 3), added);
    } else {
        try std.testing.expectEqual(@as(c_int, 0), added);
    }
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 0), binary);
}

test "diff stats count binary changes separately" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "a\n");

    const binary_size: usize = 1024 * 1024 + 1;
    const binary_data = try allocator.alloc(u8, binary_size);
    defer allocator.free(binary_data);
    @memset(binary_data, 0);

    try tmp.dir.writeFile(.{ .sub_path = "tracked.txt", .data = binary_data });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            std.Thread.sleep(1 * std.time.ns_per_ms);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    try std.testing.expectEqual(@as(c_int, 0), added);
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 1), binary);
}

test "repo info returns branch after commit" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    var branch_buf: [256]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = api.omx_git_repo_info(
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
