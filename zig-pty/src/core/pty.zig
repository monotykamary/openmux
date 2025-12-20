//! PTY Handle with Background Reader

const std = @import("std");
const RingBuffer = @import("ring_buffer.zig").RingBuffer;
const posix = @import("../util/posix.zig");
const c = posix.c;
const constants = @import("../util/constants.zig");

pub const Pty = struct {
    master_fd: c_int,
    pid: c_int,
    exited: std.atomic.Value(bool),
    exit_code: std.atomic.Value(c_int),
    stopping: std.atomic.Value(bool),
    ring: RingBuffer,
    reader_thread: ?std.Thread,

    pub fn init(master_fd: c_int, pid: c_int) Pty {
        return .{
            .master_fd = master_fd,
            .pid = pid,
            .exited = std.atomic.Value(bool).init(false),
            .exit_code = std.atomic.Value(c_int).init(-1),
            .stopping = std.atomic.Value(bool).init(false),
            .ring = RingBuffer.init(),
            .reader_thread = null,
        };
    }

    pub fn startReader(self: *Pty) bool {
        self.reader_thread = std.Thread.spawn(.{}, readerLoop, .{self}) catch return false;
        return true;
    }

    fn readerLoop(self: *Pty) void {
        var buf: [32768]u8 = undefined; // 32KB read buffer

        while (!self.stopping.load(.acquire)) {
            // Use poll to wait for data with timeout (allows checking stopping flag)
            var pfd = [_]c.pollfd{.{
                .fd = self.master_fd,
                .events = c.POLLIN,
                .revents = 0,
            }};

            const poll_result = c.poll(&pfd, 1, 100); // 100ms timeout

            if (poll_result < 0) {
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                break; // Error
            }

            if (poll_result == 0) {
                // Timeout - check if child exited
                self.checkChild();
                if (self.exited.load(.acquire)) break;
                continue;
            }

            // Data available - read it (blocking read, will get all available)
            const n = c.read(self.master_fd, &buf, buf.len);

            if (n > 0) {
                // Write to ring buffer
                var written: usize = 0;
                while (written < @as(usize, @intCast(n))) {
                    const w = self.ring.write(buf[written..@intCast(n)]);
                    if (w == 0) {
                        // Buffer full - wait for consumer to signal space available
                        self.ring.mutex.lock();
                        while (self.ring.availableSpace() == 0 and !self.stopping.load(.acquire)) {
                            // Wait with timeout so we can check stopping flag
                            self.ring.not_full.timedWait(&self.ring.mutex, 100 * std.time.ns_per_ms) catch {};
                        }
                        self.ring.mutex.unlock();
                        if (self.stopping.load(.acquire)) break;
                    } else {
                        written += w;
                    }
                }
            } else if (n == 0) {
                // EOF
                self.checkChild();
                break;
            } else {
                // Error
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                if (err == c.EAGAIN or err == c.EWOULDBLOCK) continue;
                break;
            }
        }

        // Final child check
        self.checkChild();
    }

    pub fn checkChild(self: *Pty) void {
        if (self.exited.load(.acquire)) return;

        var status: c_int = 0;
        const result = c.waitpid(self.pid, &status, c.WNOHANG);

        if (result == self.pid) {
            if (c.WIFEXITED(status)) {
                self.exit_code.store(c.WEXITSTATUS(status), .release);
            } else if (c.WIFSIGNALED(status)) {
                self.exit_code.store(128 + c.WTERMSIG(status), .release);
            }
            self.exited.store(true, .release);
        } else if (result == -1) {
            self.exit_code.store(-1, .release);
            self.exited.store(true, .release);
        }
    }

    pub fn readAvailable(self: *Pty, buf: [*]u8, len: usize) c_int {
        // Read from ring buffer (filled by background thread)
        const n = self.ring.read(buf[0..len]);

        if (n > 0) {
            // Signal producer that space is available
            self.ring.not_full.signal();
            return @intCast(n);
        } else if (n == 0) {
            // Ensure we observe child exit even if reader loop stops producing
            self.checkChild();
        }

        if (self.exited.load(.acquire) and self.ring.available() == 0) {
            return constants.CHILD_EXITED;
        } else {
            return 0;
        }
    }

    pub fn writeData(self: *Pty, data: [*]const u8, len: usize) c_int {
        if (self.exited.load(.acquire)) {
            return constants.CHILD_EXITED;
        }

        var written: usize = 0;
        while (written < len) {
            const n = c.write(self.master_fd, data + written, len - written);
            if (n > 0) {
                written += @intCast(n);
            } else if (n == -1) {
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                // Handle buffer full - sleep briefly and retry
                if (err == c.EAGAIN or err == c.EWOULDBLOCK) {
                    std.Thread.sleep(1 * std.time.ns_per_ms); // 1ms
                    continue;
                }
                return constants.ERROR;
            } else {
                break;
            }
        }

        return if (written == len) constants.SUCCESS else constants.ERROR;
    }

    pub fn resize(self: *Pty, cols: u16, rows: u16) c_int {
        var ws: c.winsize = .{
            .ws_col = cols,
            .ws_row = rows,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };

        if (c.ioctl(self.master_fd, c.TIOCSWINSZ, &ws) == -1) {
            return constants.ERROR;
        }

        return constants.SUCCESS;
    }

    pub fn kill(self: *Pty) c_int {
        if (self.pid > 0) {
            _ = c.kill(self.pid, c.SIGTERM);
        }
        return constants.SUCCESS;
    }

    pub fn deinit(self: *Pty) void {
        // Signal thread to stop
        self.stopping.store(true, .release);
        // Wake up producer if waiting on condition
        self.ring.not_full.signal();

        // Join the reader thread to avoid use-after-free if the handle slot is reused.
        if (self.reader_thread) |thread| {
            thread.join();
            self.reader_thread = null;
        }

        if (self.master_fd >= 0) {
            _ = c.close(self.master_fd);
            self.master_fd = -1;
        }

        // Try non-blocking reap first (WNOHANG)
        // If process hasn't exited yet, spawn a reaper thread to prevent zombies
        if (self.pid > 0 and !self.exited.load(.acquire)) {
            const result = c.waitpid(self.pid, null, c.WNOHANG);
            if (result == 0) {
                // Process still running - spawn detached reaper thread
                const pid = self.pid;
                const reaper = std.Thread.spawn(.{}, reapZombie, .{pid}) catch null;
                if (reaper) |t| t.detach();
            }
        }
    }
};

/// Reaper thread function - waits for zombie process in background
fn reapZombie(pid: c.pid_t) void {
    // Wait for process to exit (blocking, but in separate detached thread)
    _ = c.waitpid(pid, null, 0);
    // Thread exits automatically after reaping
}
