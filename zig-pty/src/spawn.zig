//! PTY Spawn - Creates new PTY sessions

const std = @import("std");
const posix = @import("posix.zig");
const c = posix.c;
const constants = @import("constants.zig");
const Pty = @import("pty.zig").Pty;
const handle_registry = @import("handle_registry.zig");

fn setNonBlocking(fd: c_int) bool {
    const flags = c.fcntl(fd, c.F_GETFL);
    if (flags == -1) return false;
    return c.fcntl(fd, c.F_SETFL, flags | c.O_NONBLOCK) != -1;
}

fn setCloseOnExec(fd: c_int) void {
    _ = c.fcntl(fd, c.F_SETFD, c.FD_CLOEXEC);
}

pub fn spawnPty(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env_str: [*:0]const u8,
    cols: u16,
    rows: u16,
) c_int {
    var master_fd: c_int = undefined;
    var slave_fd: c_int = undefined;

    // Set up window size
    var ws: c.winsize = .{
        .ws_col = cols,
        .ws_row = rows,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    // Open PTY pair
    if (c.openpty(&master_fd, &slave_fd, null, null, &ws) == -1) {
        return constants.ERROR;
    }

    // Set master to non-blocking
    if (!setNonBlocking(master_fd)) {
        _ = c.close(master_fd);
        _ = c.close(slave_fd);
        return constants.ERROR;
    }

    setCloseOnExec(master_fd);

    // Fork
    const pid = c.fork();

    if (pid == -1) {
        // Fork failed
        _ = c.close(master_fd);
        _ = c.close(slave_fd);
        return constants.ERROR;
    }

    if (pid == 0) {
        // Child process
        _ = c.close(master_fd);

        // Create new session
        _ = c.setsid();

        // Set controlling terminal
        _ = c.ioctl(slave_fd, c.TIOCSCTTY, @as(c_int, 0));

        // Dup slave to stdin/stdout/stderr
        _ = c.dup2(slave_fd, 0);
        _ = c.dup2(slave_fd, 1);
        _ = c.dup2(slave_fd, 2);

        if (slave_fd > 2) {
            _ = c.close(slave_fd);
        }

        // Change directory if specified
        if (cwd[0] != 0) {
            if (c.chdir(cwd) == -1) {
                c._exit(126); // Exit code 126: command cannot execute (permission/not found)
            }
        }

        // Parse environment variables
        var env_ptrs: [256]?[*:0]const u8 = [_]?[*:0]const u8{null} ** 256;
        var env_count: usize = 0;

        // Copy current environment first
        if (posix.getEnviron()) |environ| {
            var i: usize = 0;
            while (environ[i] != null and env_count < 250) : (i += 1) {
                env_ptrs[env_count] = @ptrCast(environ[i].?);
                env_count += 1;
            }
        }

        // Parse additional env vars from null-separated string
        if (env_str[0] != 0) {
            var ptr: [*:0]const u8 = env_str;
            while (ptr[0] != 0 and env_count < 255) {
                env_ptrs[env_count] = ptr;
                env_count += 1;
                // Skip to next null
                while (ptr[0] != 0) ptr += 1;
                ptr += 1;
            }
        }
        env_ptrs[env_count] = null;

        // Parse command line - simple shell-based approach
        // We'll let the shell handle the parsing
        const shell_env = c.getenv("SHELL");
        const shell: [*:0]const u8 = if (shell_env != null)
            @ptrCast(shell_env)
        else
            "/bin/sh";

        const argv = [_:null]?[*:0]const u8{
            shell,
            "-c",
            cmd,
            null,
        };

        _ = c.execve(
            shell,
            @ptrCast(&argv),
            @ptrCast(&env_ptrs),
        );

        // If execve fails, exit
        c._exit(127);
    }

    // Parent process
    _ = c.close(slave_fd);

    // Allocate handle
    const h = handle_registry.allocHandle() orelse {
        _ = c.close(master_fd);
        _ = c.kill(pid, c.SIGKILL);
        _ = c.waitpid(pid, null, 0); // Reap zombie
        return constants.ERROR;
    };

    const pty = Pty.init(master_fd, pid);
    handle_registry.setHandle(h, pty);

    // Start the background reader thread
    const p = handle_registry.acquireHandle(h) orelse {
        handle_registry.removeHandle(h);
        _ = c.kill(pid, c.SIGKILL);
        _ = c.waitpid(pid, null, 0);
        return constants.ERROR;
    };
    const started = p.startReader();
    handle_registry.releaseHandle(h);
    if (!started) {
        // Thread spawn failed - clean up
        handle_registry.removeHandle(h);
        _ = c.kill(pid, c.SIGKILL);
        _ = c.waitpid(pid, null, 0);
        return constants.ERROR;
    }

    return @intCast(h);
}
