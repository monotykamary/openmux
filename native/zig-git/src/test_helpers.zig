const std = @import("std");
pub const c = @cImport({
    @cInclude("git2.h");
});

pub fn initRepo(allocator: std.mem.Allocator, path: []const u8) !*c.git_repository {
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

pub fn commitFile(
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
