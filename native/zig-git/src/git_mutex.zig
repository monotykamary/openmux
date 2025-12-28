const std = @import("std");

pub var mutex: std.Thread.Mutex = .{};

pub fn lock() void {
    mutex.lock();
}

pub fn unlock() void {
    mutex.unlock();
}
