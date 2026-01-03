const std = @import("std");
const builtin = @import("builtin");
const state = @import("state.zig");
const types = @import("types.zig");

const TerminalWrapper = state.TerminalWrapper;
const GhosttyKittyImageInfo = types.GhosttyKittyImageInfo;
const GhosttyKittyPlacement = types.GhosttyKittyPlacement;

const is_posix_clock = switch (builtin.os.tag) {
    .windows, .uefi, .wasi => false,
    else => true,
};

fn instantToNanos(ts: std.time.Instant) u64 {
    if (comptime is_posix_clock) {
        const sec: u64 = if (ts.timestamp.sec < 0) 0 else @intCast(ts.timestamp.sec);
        const nsec: u64 = if (ts.timestamp.nsec < 0) 0 else @intCast(ts.timestamp.nsec);
        return sec * std.time.ns_per_s + nsec;
    }

    return ts.timestamp;
}

pub fn getKittyImagesDirty(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.terminal.screens.active.kitty_images.dirty;
}

pub fn clearKittyImagesDirty(ptr: ?*anyopaque) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    wrapper.terminal.screens.active.kitty_images.dirty = false;
}

pub fn getKittyImageCount(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    const count = wrapper.terminal.screens.active.kitty_images.images.count();
    return std.math.cast(c_int, count) orelse return 0;
}

pub fn getKittyImageIds(
    ptr: ?*anyopaque,
    out: [*]u32,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const storage = &wrapper.terminal.screens.active.kitty_images;
    const count = storage.images.count();
    if (buf_size < count) return -1;

    var idx: usize = 0;
    var it = storage.images.iterator();
    while (it.next()) |entry| {
        out[idx] = entry.key_ptr.*;
        idx += 1;
    }

    return std.math.cast(c_int, idx) orelse return -1;
}

pub fn getKittyImageInfo(
    ptr: ?*anyopaque,
    image_id: u32,
    out: *GhosttyKittyImageInfo,
) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    const storage = &wrapper.terminal.screens.active.kitty_images;
    const img = storage.imageById(image_id) orelse return false;
    const data_len = std.math.cast(u32, img.data.len) orelse return false;

    out.* = .{
        .id = img.id,
        .number = img.number,
        .width = img.width,
        .height = img.height,
        .data_len = data_len,
        .format = @intFromEnum(img.format),
        .compression = @intFromEnum(img.compression),
        .implicit_id = if (img.implicit_id) 1 else 0,
        .transmit_time = instantToNanos(img.transmit_time),
    };

    return true;
}

pub fn copyKittyImageData(
    ptr: ?*anyopaque,
    image_id: u32,
    out: [*]u8,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const storage = &wrapper.terminal.screens.active.kitty_images;
    const img = storage.imageById(image_id) orelse return -1;
    if (buf_size < img.data.len) return -1;

    @memcpy(out[0..img.data.len], img.data);
    return std.math.cast(c_int, img.data.len) orelse return -1;
}

pub fn getKittyPlacementCount(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    const storage = &wrapper.terminal.screens.active.kitty_images;
    var count: usize = 0;

    var it = storage.placements.iterator();
    while (it.next()) |entry| {
        switch (entry.value_ptr.location) {
            .pin => count += 1,
            .virtual => {},
        }
    }

    return std.math.cast(c_int, count) orelse return 0;
}

pub fn getKittyPlacements(
    ptr: ?*anyopaque,
    out: [*]GhosttyKittyPlacement,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const storage = &wrapper.terminal.screens.active.kitty_images;
    const pages = &wrapper.terminal.screens.active.pages;

    var idx: usize = 0;
    var it = storage.placements.iterator();
    while (it.next()) |entry| {
        const placement = entry.value_ptr.*;
        const pin = switch (placement.location) {
            .pin => |p| p,
            .virtual => continue,
        };

        if (idx >= buf_size) return -1;

        const pt = pages.pointFromPin(.screen, pin.*) orelse continue;
        const coord = pt.coord();

        out[idx] = .{
            .image_id = entry.key_ptr.image_id,
            .placement_id = entry.key_ptr.placement_id.id,
            .placement_tag = switch (entry.key_ptr.placement_id.tag) {
                .internal => 0,
                .external => 1,
            },
            .screen_x = @intCast(coord.x),
            .screen_y = coord.y,
            .x_offset = placement.x_offset,
            .y_offset = placement.y_offset,
            .source_x = placement.source_x,
            .source_y = placement.source_y,
            .source_width = placement.source_width,
            .source_height = placement.source_height,
            .columns = placement.columns,
            .rows = placement.rows,
            .z = placement.z,
        };
        idx += 1;
    }

    return std.math.cast(c_int, idx) orelse return -1;
}
