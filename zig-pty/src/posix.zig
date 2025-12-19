//! POSIX bindings for zig-pty

const builtin = @import("builtin");

pub const c = @cImport({
    @cInclude("stdlib.h");
    @cInclude("unistd.h");
    @cInclude("fcntl.h");
    @cInclude("errno.h");
    @cInclude("string.h");
    @cInclude("signal.h");
    @cInclude("poll.h");
    @cInclude("sys/wait.h");
    @cInclude("sys/ioctl.h");
    if (builtin.os.tag == .macos) {
        @cInclude("util.h");
        @cInclude("crt_externs.h");
        @cInclude("libproc.h"); // For proc_pidinfo, proc_listpids
        @cInclude("sys/sysctl.h"); // For KERN_PROCARGS2 (argv[0] detection)
    } else {
        @cInclude("pty.h");
    }
    @cInclude("termios.h");
});

const std = @import("std");

/// Get environ - platform specific
pub fn getEnviron() ?[*:null]?[*:0]u8 {
    if (builtin.os.tag == .macos) {
        const environ_ptr = c._NSGetEnviron();
        if (environ_ptr) |ptr| {
            return @ptrCast(ptr.*);
        }
        return null;
    } else {
        // Linux - use std.c.environ
        return @ptrCast(std.c.environ);
    }
}
