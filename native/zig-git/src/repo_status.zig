const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");

pub const RepoStatus = struct {
    branch: [constants.MAX_BRANCH_LEN]u8 = undefined,
    gitdir: [constants.MAX_CWD_LEN]u8 = undefined,
    workdir: [constants.MAX_CWD_LEN]u8 = undefined,
    dirty: u8 = 0,
    staged: c_int = 0,
    unstaged: c_int = 0,
    untracked: c_int = 0,
    conflicted: c_int = 0,
    ahead: c_int = constants.STATUS_UNKNOWN,
    behind: c_int = constants.STATUS_UNKNOWN,
    stash_count: c_int = constants.STATUS_UNKNOWN,
    state: c_int = 0,
    detached: u8 = 0,
};

pub fn clearBuffer(buf: [*]u8, len: usize) void {
    if (len == 0) return;
    buf[0] = 0;
}

pub fn copyCString(dest: [*]u8, dest_len: usize, src: []const u8) void {
    if (dest_len == 0) return;
    var i: usize = 0;
    while (i + 1 < dest_len and i < src.len and src[i] != 0) : (i += 1) {
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
        var resolved: ?*c.git_reference = null;
        const resolved_ok = c.git_reference_resolve(&resolved, head_ref.?) == 0 and resolved != null;
        const ref = if (resolved_ok) resolved.? else head_ref.?;

        if (c.git_reference_is_branch(ref) == 1) {
            const name = c.git_reference_shorthand(ref);
            if (name != null) {
                copyCString(dest, dest_len, std.mem.span(name));
            }
        } else {
            const oid = c.git_reference_target(ref);
            if (oid != null) {
                writeShortOid(dest, dest_len, oid);
            }
        }

        if (resolved) |ref_resolved| c.git_reference_free(ref_resolved);
        c.git_reference_free(head_ref.?);
        return;
    }

    if (head_ref) |ref| c.git_reference_free(ref);

    var oid: c.git_oid = undefined;
    if (c.git_reference_name_to_id(&oid, repo, "HEAD") == 0) {
        writeShortOid(dest, dest_len, &oid);
    }
}

fn computeStatusCounts(repo: *c.git_repository, out: *RepoStatus) void {
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
        return;
    }
    defer c.git_status_list_free(status_list.?);

    const index_mask: c_uint = c.GIT_STATUS_INDEX_NEW |
        c.GIT_STATUS_INDEX_MODIFIED |
        c.GIT_STATUS_INDEX_DELETED |
        c.GIT_STATUS_INDEX_RENAMED |
        c.GIT_STATUS_INDEX_TYPECHANGE;

    var worktree_mask: c_uint = c.GIT_STATUS_WT_MODIFIED |
        c.GIT_STATUS_WT_DELETED |
        c.GIT_STATUS_WT_RENAMED |
        c.GIT_STATUS_WT_TYPECHANGE;
    if (@hasDecl(c, "GIT_STATUS_WT_UNREADABLE")) {
        worktree_mask |= c.GIT_STATUS_WT_UNREADABLE;
    }

    const entry_count = c.git_status_list_entrycount(status_list.?);
    var i: usize = 0;
    while (i < entry_count) : (i += 1) {
        const entry = c.git_status_byindex(status_list.?, i);
        if (entry == null) continue;
        const status: c_uint = entry.*.status;

        if (@hasDecl(c, "GIT_STATUS_IGNORED") and status == c.GIT_STATUS_IGNORED) {
            continue;
        }

        if ((status & c.GIT_STATUS_WT_NEW) != 0) {
            out.untracked += 1;
        }

        if ((status & c.GIT_STATUS_CONFLICTED) != 0) {
            out.conflicted += 1;
        }

        if ((status & index_mask) != 0) {
            out.staged += 1;
        }

        if ((status & worktree_mask) != 0) {
            out.unstaged += 1;
        }
    }

    if (out.staged > 0 or out.unstaged > 0 or out.untracked > 0 or out.conflicted > 0) {
        out.dirty = 1;
    }
}

fn computeAheadBehind(repo: *c.git_repository, out: *RepoStatus) void {
    if (!@hasDecl(c, "git_graph_ahead_behind")) return;

    if (@hasDecl(c, "git_repository_head_unborn")) {
        if (c.git_repository_head_unborn(repo) == 1) return;
    }

    var head_ref: ?*c.git_reference = null;
    if (c.git_repository_head(&head_ref, repo) != 0 or head_ref == null) return;
    defer c.git_reference_free(head_ref.?);

    var resolved: ?*c.git_reference = null;
    const resolved_ok = c.git_reference_resolve(&resolved, head_ref.?) == 0 and resolved != null;
    const local_ref = if (resolved_ok) resolved.? else head_ref.?;
    defer if (resolved) |ref_resolved| c.git_reference_free(ref_resolved);

    if (c.git_reference_is_branch(local_ref) != 1) return;

    var upstream_ref: ?*c.git_reference = null;
    if (c.git_branch_upstream(&upstream_ref, local_ref) != 0 or upstream_ref == null) return;
    defer c.git_reference_free(upstream_ref.?);

    const local_oid = c.git_reference_target(local_ref);
    const upstream_oid = c.git_reference_target(upstream_ref.?);
    if (local_oid == null or upstream_oid == null) return;

    var ahead: usize = 0;
    var behind: usize = 0;
    if (c.git_graph_ahead_behind(&ahead, &behind, repo, local_oid, upstream_oid) != 0) return;

    out.ahead = @intCast(ahead);
    out.behind = @intCast(behind);
}

fn stashCallback(
    _: usize,
    _: [*c]const u8,
    _: [*c]const c.git_oid,
    payload: ?*anyopaque,
) callconv(.c) c_int {
    if (payload == null) return 0;
    const count_ptr: *usize = @ptrCast(@alignCast(payload.?));
    count_ptr.* += 1;
    return 0;
}

fn computeStashCount(repo: *c.git_repository, out: *RepoStatus) void {
    if (!@hasDecl(c, "git_stash_foreach")) return;

    var count: usize = 0;
    if (c.git_stash_foreach(repo, stashCallback, &count) != 0) return;

    out.stash_count = @intCast(count);
}

fn computeDetached(repo: *c.git_repository, out: *RepoStatus) void {
    if (@hasDecl(c, "git_repository_head_detached")) {
        out.detached = if (c.git_repository_head_detached(repo) == 1) 1 else 0;
        return;
    }

    var head_ref: ?*c.git_reference = null;
    if (c.git_repository_head(&head_ref, repo) != 0 or head_ref == null) return;
    defer c.git_reference_free(head_ref.?);

    var resolved: ?*c.git_reference = null;
    const resolved_ok = c.git_reference_resolve(&resolved, head_ref.?) == 0 and resolved != null;
    const ref = if (resolved_ok) resolved.? else head_ref.?;
    defer if (resolved) |ref_resolved| c.git_reference_free(ref_resolved);

    out.detached = if (c.git_reference_is_branch(ref) == 1) 0 else 1;
}

pub fn clearRepoStatus(out: *RepoStatus) void {
    clearBuffer(&out.branch, out.branch.len);
    clearBuffer(&out.gitdir, out.gitdir.len);
    clearBuffer(&out.workdir, out.workdir.len);
    out.dirty = 0;
    out.staged = 0;
    out.unstaged = 0;
    out.untracked = 0;
    out.conflicted = 0;
    out.ahead = constants.STATUS_UNKNOWN;
    out.behind = constants.STATUS_UNKNOWN;
    out.stash_count = constants.STATUS_UNKNOWN;
    out.state = 0;
    out.detached = 0;
}

pub fn fillRepoStatus(repo: *c.git_repository, out: *RepoStatus) void {
    clearRepoStatus(out);

    getBranch(repo, &out.branch, out.branch.len);

    const gitdir = c.git_repository_path(repo);
    if (gitdir != null) {
        copyCString(&out.gitdir, out.gitdir.len, std.mem.span(gitdir));
    }

    const workdir = c.git_repository_workdir(repo);
    if (workdir != null) {
        copyCString(&out.workdir, out.workdir.len, std.mem.span(workdir));
    }

    computeStatusCounts(repo, out);
    computeAheadBehind(repo, out);
    computeStashCount(repo, out);
    out.state = c.git_repository_state(repo);
    computeDetached(repo, out);
}

pub fn computeRepoStatus(cwd: [*:0]const u8, out: *RepoStatus) bool {
    clearRepoStatus(out);

    var repo: ?*c.git_repository = null;
    if (c.git_repository_open_ext(&repo, cwd, c.GIT_REPOSITORY_OPEN_FROM_ENV, null) != 0) {
        return false;
    }
    defer c.git_repository_free(repo.?);

    fillRepoStatus(repo.?, out);
    return true;
}
