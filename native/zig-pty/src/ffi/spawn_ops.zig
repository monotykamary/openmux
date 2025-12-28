//! PTY Spawn Operations Module
//! Synchronous and asynchronous PTY spawning.

const std = @import("std");
const constants = @import("../util/constants.zig");
const spawn_module = @import("../core/spawn.zig");
const async_spawn = @import("../core/async_spawn.zig");
const handle_registry = @import("../core/handle_registry.zig");

// ============================================================================
// Synchronous Spawn
// ============================================================================

/// Spawn a new PTY with the given command synchronously.
/// Returns: handle (> 0) on success, or ERROR (-1) on failure.
pub fn spawn(
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
// Asynchronous Spawn
// ============================================================================

/// Queue an async spawn request.
/// Returns: request ID (>= 0) on success, or ERROR (-1) on failure.
/// Use spawnPoll to check status and get the handle when ready.
pub fn spawnAsync(
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

    // Copy command string safely
    var cmd_len: usize = 0;
    while (cmd[cmd_len] != 0 and cmd_len < constants.MAX_CMD_LEN - 1) : (cmd_len += 1) {
        req.cmd[cmd_len] = cmd[cmd_len];
    }
    req.cmd[cmd_len] = 0;
    req.cmd_len = cmd_len + 1;

    // Copy cwd string safely
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

/// Poll an async spawn request for completion.
/// Returns:
/// - SPAWN_PENDING (-3) if still in progress
/// - handle (>= 0) if complete (request slot is freed)
/// - SPAWN_ERROR (-4) if failed (request slot is freed)
pub fn spawnPoll(request_id: c_int) c_int {
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
        .cancelled => {
            // Request was cancelled - treat as error
            return constants.SPAWN_ERROR;
        },
    }
}

/// Cancel a pending async spawn request.
/// If spawn already completed, the PTY handle is closed.
/// Safe to call multiple times.
pub fn spawnCancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_spawn.getSpawnRequest(@intCast(request_id)) orelse return;

    // Try to atomically transition from pending to cancelled.
    // This prevents the race where we free the slot while spawn thread is still using it.
    if (req.state.cmpxchgStrong(.pending, .cancelled, .acq_rel, .acquire)) |old_state| {
        // CAS failed - request already transitioned to complete/failed/cancelled.
        // Handle based on what state it's in.
        switch (old_state) {
            .complete => {
                // Spawn completed - close the handle to avoid leaking
                const handle = req.result_handle.load(.acquire);
                if (handle > 0) {
                    handle_registry.removeHandle(@intCast(handle));
                }
                async_spawn.freeSpawnRequest(@intCast(request_id));
            },
            .failed => {
                // Spawn failed - just free the slot
                async_spawn.freeSpawnRequest(@intCast(request_id));
            },
            .cancelled => {
                // Already cancelled - nothing to do
            },
            .pending => unreachable, // CAS would have succeeded
        }
    }
    // If CAS succeeded (pending -> cancelled), DON'T free the slot here.
    // The spawn thread will free it after noticing the cancelled state.
}
