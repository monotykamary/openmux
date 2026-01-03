const std = @import("std");
const builtin = @import("builtin");
const testing = std.testing;

pub const ZigVTable = std.mem.Allocator.VTable;

/// C: GhosttyAllocatorVtable
pub const VTable = extern struct {
    alloc: *const fn (*anyopaque, len: usize, alignment: u8, ret_addr: usize) callconv(.c) ?[*]u8,
    resize: *const fn (*anyopaque, memory: [*]u8, memory_len: usize, alignment: u8, new_len: usize, ret_addr: usize) callconv(.c) bool,
    remap: *const fn (*anyopaque, memory: [*]u8, memory_len: usize, alignment: u8, new_len: usize, ret_addr: usize) callconv(.c) ?[*]u8,
    free: *const fn (*anyopaque, memory: [*]u8, memory_len: usize, alignment: u8, ret_addr: usize) callconv(.c) void,
};

/// C: GhosttyAllocator
pub const Allocator = extern struct {
    ctx: *anyopaque,
    vtable: *const VTable,

    pub const zig_vtable: ZigVTable = .{
        .alloc = alloc,
        .resize = resize,
        .remap = remap,
        .free = free,
    };

    pub fn fromZig(zig_alloc: *const std.mem.Allocator) Allocator {
        return .{
            .ctx = @ptrCast(@constCast(zig_alloc)),
            .vtable = &ZigAllocator.vtable,
        };
    }

    pub fn zig(self: *const Allocator) std.mem.Allocator {
        return .{
            .ptr = @ptrCast(@constCast(self)),
            .vtable = &zig_vtable,
        };
    }

    fn alloc(
        ctx: *anyopaque,
        len: usize,
        alignment: std.mem.Alignment,
        ra: usize,
    ) ?[*]u8 {
        const self: *Allocator = @ptrCast(@alignCast(ctx));
        return self.vtable.alloc(
            self.ctx,
            len,
            @intFromEnum(alignment),
            ra,
        );
    }

    fn resize(
        ctx: *anyopaque,
        old_mem: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        ra: usize,
    ) bool {
        const self: *Allocator = @ptrCast(@alignCast(ctx));
        return self.vtable.resize(
            self.ctx,
            old_mem.ptr,
            old_mem.len,
            @intFromEnum(alignment),
            new_len,
            ra,
        );
    }

    fn remap(
        ctx: *anyopaque,
        old_mem: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        ra: usize,
    ) ?[*]u8 {
        const self: *Allocator = @ptrCast(@alignCast(ctx));
        return self.vtable.remap(
            self.ctx,
            old_mem.ptr,
            old_mem.len,
            @intFromEnum(alignment),
            new_len,
            ra,
        );
    }

    fn free(
        ctx: *anyopaque,
        old_mem: []u8,
        alignment: std.mem.Alignment,
        ra: usize,
    ) void {
        const self: *Allocator = @ptrCast(@alignCast(ctx));
        self.vtable.free(
            self.ctx,
            old_mem.ptr,
            old_mem.len,
            @intFromEnum(alignment),
            ra,
        );
    }
};

const ZigAllocator = struct {
    const vtable: VTable = .{
        .alloc = alloc,
        .resize = resize,
        .remap = remap,
        .free = free,
    };

    fn alloc(
        ctx: *anyopaque,
        len: usize,
        alignment: u8,
        ra: usize,
    ) callconv(.c) ?[*]u8 {
        const zig_alloc: *const std.mem.Allocator = @ptrCast(@alignCast(ctx));
        return zig_alloc.vtable.alloc(
            zig_alloc.ptr,
            len,
            @enumFromInt(alignment),
            ra,
        );
    }

    fn resize(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        new_len: usize,
        ra: usize,
    ) callconv(.c) bool {
        const zig_alloc: *const std.mem.Allocator = @ptrCast(@alignCast(ctx));
        return zig_alloc.vtable.resize(
            zig_alloc.ptr,
            memory[0..memory_len],
            @enumFromInt(alignment),
            new_len,
            ra,
        );
    }

    fn remap(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        new_len: usize,
        ra: usize,
    ) callconv(.c) ?[*]u8 {
        const zig_alloc: *const std.mem.Allocator = @ptrCast(@alignCast(ctx));
        return zig_alloc.vtable.remap(
            zig_alloc.ptr,
            memory[0..memory_len],
            @enumFromInt(alignment),
            new_len,
            ra,
        );
    }

    fn free(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        ra: usize,
    ) callconv(.c) void {
        const zig_alloc: *const std.mem.Allocator = @ptrCast(@alignCast(ctx));
        return zig_alloc.vtable.free(
            zig_alloc.ptr,
            memory[0..memory_len],
            @enumFromInt(alignment),
            ra,
        );
    }
};

/// Returns an allocator to use for the given possibly-null C allocator.
pub fn default(c_alloc_: ?*const Allocator) std.mem.Allocator {
    if (c_alloc_) |c_alloc| return c_alloc.zig();

    if (comptime builtin.is_test) return testing.allocator;
    if (comptime builtin.link_libc) return std.heap.c_allocator;
    if (comptime builtin.target.cpu.arch.isWasm()) return std.heap.wasm_allocator;

    return std.heap.smp_allocator;
}

pub const c_allocator: Allocator = .fromZig(&std.heap.c_allocator);

pub const test_allocator: Allocator = b: {
    if (!builtin.is_test) @compileError("test_allocator can only be used in tests");
    break :b .fromZig(&testing.allocator);
};
