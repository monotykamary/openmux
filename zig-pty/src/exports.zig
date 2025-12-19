//! FFI Export implementations for zig-pty
//! These functions are called from main.zig which handles the actual FFI export

const constants = @import("constants.zig");
const spawn_module = @import("spawn.zig");
const async_spawn = @import("async_spawn.zig");
const handle_registry = @import("handle_registry.zig");

// ============================================================================
// Synchronous Spawn
// ============================================================================

pub fn bun_pty_spawn(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    if (cols <= 0 or rows <= 0) {
        return constants.ERROR;
    }
    // Bounds check: winsize uses u16 for dimensions
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }
    return spawn_module.spawnPty(cmd, cwd, env, @intCast(cols), @intCast(rows));
}

// ============================================================================
// Async Spawn
// ============================================================================

/// Queue an async spawn request. Returns a request ID (>= 0) or ERROR.
/// Use bun_pty_spawn_poll to check status and get the handle when ready.
pub fn bun_pty_spawn_async(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    if (cols <= 0 or rows <= 0) {
        return constants.ERROR;
    }
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }

    // Ensure spawn thread is running
    if (!async_spawn.initSpawnThread()) {
        return constants.ERROR;
    }

    // Allocate a request slot
    const req_id = async_spawn.allocSpawnRequest() orelse return constants.ERROR;
    const req = async_spawn.getSpawnRequest(req_id) orelse return constants.ERROR;

    // Copy command string
    var cmd_len: usize = 0;
    while (cmd[cmd_len] != 0 and cmd_len < constants.MAX_CMD_LEN - 1) : (cmd_len += 1) {
        req.cmd[cmd_len] = cmd[cmd_len];
    }
    req.cmd[cmd_len] = 0;
    req.cmd_len = cmd_len + 1;

    // Copy cwd string
    var cwd_len: usize = 0;
    while (cwd[cwd_len] != 0 and cwd_len < constants.MAX_CWD_LEN - 1) : (cwd_len += 1) {
        req.cwd[cwd_len] = cwd[cwd_len];
    }
    req.cwd[cwd_len] = 0;
    req.cwd_len = cwd_len + 1;

    // Copy env string (null-separated, double-null terminated)
    var env_len: usize = 0;
    var consecutive_nulls: u8 = 0;
    while (env_len < constants.MAX_ENV_LEN - 1) {
        req.env[env_len] = env[env_len];
        if (env[env_len] == 0) {
            consecutive_nulls += 1;
            if (consecutive_nulls >= 2) {
                env_len += 1;
                break;
            }
        } else {
            consecutive_nulls = 0;
        }
        env_len += 1;
    }
    req.env[env_len] = 0;
    req.env_len = env_len + 1;

    req.cols = @intCast(cols);
    req.rows = @intCast(rows);
    req.state.store(.pending, .release);
    req.result_handle.store(0, .release);

    // Signal the spawn thread
    async_spawn.signalSpawnQueue();

    return @intCast(req_id);
}

/// Poll an async spawn request.
/// Returns: SPAWN_PENDING (-3) if still in progress,
///          handle (>= 0) if complete,
///          SPAWN_ERROR (-4) if failed.
/// After getting a non-pending result, the request slot is freed.
pub fn bun_pty_spawn_poll(request_id: c_int) c_int {
    if (request_id < 0) return constants.SPAWN_ERROR;

    const req = async_spawn.getSpawnRequest(@intCast(request_id)) orelse return constants.SPAWN_ERROR;
    const state = req.state.load(.acquire);

    switch (state) {
        .pending => return constants.SPAWN_PENDING,
        .complete => {
            const handle = req.result_handle.load(.acquire);
            async_spawn.freeSpawnRequest(@intCast(request_id));
            return handle;
        },
        .failed => {
            async_spawn.freeSpawnRequest(@intCast(request_id));
            return constants.SPAWN_ERROR;
        },
    }
}

/// Cancel a pending async spawn request.
/// If spawn already completed, the PTY handle is closed.
pub fn bun_pty_spawn_cancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_spawn.getSpawnRequest(@intCast(request_id)) orelse return;
    const state = req.state.load(.acquire);

    if (state == .complete) {
        // Spawn completed - close the handle
        const handle = req.result_handle.load(.acquire);
        if (handle > 0) {
            handle_registry.removeHandle(@intCast(handle));
        }
    }

    async_spawn.freeSpawnRequest(@intCast(request_id));
}

// ============================================================================
// PTY Operations
// ============================================================================

pub fn bun_pty_read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    return pty.readAvailable(buf, @intCast(len));
}

pub fn bun_pty_write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    return pty.writeData(data, @intCast(len));
}

pub fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    if (handle <= 0 or cols <= 0 or rows <= 0) {
        return constants.ERROR;
    }
    // Bounds check: winsize uses u16 for dimensions
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    return pty.resize(@intCast(cols), @intCast(rows));
}

pub fn bun_pty_kill(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    return pty.kill();
}

pub fn bun_pty_get_pid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    return pty.pid;
}

pub fn bun_pty_get_exit_code(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);
    pty.checkChild();
    return pty.exit_code.load(.acquire);
}

pub fn bun_pty_close(handle: c_int) void {
    if (handle <= 0) {
        return;
    }
    handle_registry.removeHandle(@intCast(handle));
}
