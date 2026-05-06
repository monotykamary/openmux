const std = @import("std");
const builtin = @import("builtin");
const ghostty = @import("ghostty");
const state = @import("state.zig");
const types = @import("types.zig");

const Terminal = ghostty.Terminal;
const RenderState = ghostty.RenderState;
const color = ghostty.color;
const GhosttyTerminalConfig = types.GhosttyTerminalConfig;
const TerminalWrapper = state.TerminalWrapper;
const ResponseHandler = state.ResponseHandler;
const ResponseStream = state.ResponseStream;

fn resolveScrollbackMaxSize(limit_lines: usize) usize {
    // Use an unlimited byte budget and enforce scrollback in lines.
    if (limit_lines == 0) return std.math.maxInt(usize);
    return std.math.maxInt(usize);
}

fn pruneScrollbackLines(wrapper: *TerminalWrapper, extra: usize) void {
    if (extra == 0) return;
    if (wrapper.terminal.screens.active_key == .alternate) return;

    const pages = &wrapper.terminal.screens.active.pages;
    const rows: usize = @intCast(pages.rows);
    if (pages.total_rows <= rows) return;

    const scrollback_len = pages.total_rows - rows;
    if (scrollback_len == 0) return;

    const trim = if (extra > scrollback_len) scrollback_len else extra;
    if (trim == 0) return;

    if (comptime @hasField(@TypeOf(wrapper.terminal.screens.active.*), "kitty_images")) {
        const storage = &wrapper.terminal.screens.active.kitty_images;
        if (storage.placements.count() > 0) {
            var it = storage.placements.iterator();
            while (it.next()) |entry| {
                switch (entry.value_ptr.location) {
                    .pin => |pin_ptr| {
                        const pt = pages.pointFromPin(.history, pin_ptr.*) orelse continue;
                        const coord = pt.coord();
                        if (coord.y < trim) {
                            entry.value_ptr.deinit(wrapper.terminal.screens.active);
                            storage.placements.removeByPtr(entry.key_ptr);
                            storage.dirty = true;
                        }
                    },
                    .virtual => {},
                }
            }
        }
    }

    pages.eraseHistory(
        .{ .history = .{ .y = @intCast(trim - 1) } },
    );

    if (comptime @hasField(@TypeOf(wrapper.terminal.screens.active.*), "kitty_images")) {
        wrapper.terminal.screens.active.kitty_images.dirty = true;
    }
}

fn trimScrollbackLines(wrapper: *TerminalWrapper) void {
    const limit = wrapper.scrollback_limit_lines;
    if (limit == 0) return;

    const pages = &wrapper.terminal.screens.active.pages;
    const rows: usize = @intCast(pages.rows);
    if (pages.total_rows <= rows) return;

    const scrollback_len = pages.total_rows - rows;
    if (scrollback_len <= limit) return;

    const extra = scrollback_len - limit;
    pruneScrollbackLines(wrapper, extra);
}

pub fn new(cols: c_int, rows: c_int) callconv(.c) ?*anyopaque {
    return newWithConfig(cols, rows, null);
}

pub fn newWithConfig(
    cols: c_int,
    rows: c_int,
    config_: ?*const GhosttyTerminalConfig,
) callconv(.c) ?*anyopaque {
    const alloc = if (builtin.target.cpu.arch.isWasm())
        std.heap.wasm_allocator
    else
        std.heap.c_allocator;

    const wrapper = alloc.create(TerminalWrapper) catch return null;

    // Parse config or use defaults
    const scrollback_limit_lines: usize = if (config_) |cfg|
        cfg.scrollback_limit
    else
        10_000;
    const scrollback_limit = resolveScrollbackMaxSize(scrollback_limit_lines);

    // Setup terminal colors
    var colors = Terminal.Colors.default;
    if (config_) |cfg| {
        if (cfg.fg_color != 0) {
            const rgb = color.RGB{
                .r = @truncate((cfg.fg_color >> 16) & 0xFF),
                .g = @truncate((cfg.fg_color >> 8) & 0xFF),
                .b = @truncate(cfg.fg_color & 0xFF),
            };
            colors.foreground = color.DynamicRGB.init(rgb);
        }
        if (cfg.bg_color != 0) {
            const rgb = color.RGB{
                .r = @truncate((cfg.bg_color >> 16) & 0xFF),
                .g = @truncate((cfg.bg_color >> 8) & 0xFF),
                .b = @truncate(cfg.bg_color & 0xFF),
            };
            colors.background = color.DynamicRGB.init(rgb);
        }
        if (cfg.cursor_color != 0) {
            const rgb = color.RGB{
                .r = @truncate((cfg.cursor_color >> 16) & 0xFF),
                .g = @truncate((cfg.cursor_color >> 8) & 0xFF),
                .b = @truncate(cfg.cursor_color & 0xFF),
            };
            colors.cursor = color.DynamicRGB.init(rgb);
        }
        // Apply palette colors (0 = use default)
        for (cfg.palette, 0..) |palette_color, i| {
            if (palette_color != 0) {
                const rgb = color.RGB{
                    .r = @truncate((palette_color >> 16) & 0xFF),
                    .g = @truncate((palette_color >> 8) & 0xFF),
                    .b = @truncate(palette_color & 0xFF),
                };
                colors.palette.set(@intCast(i), rgb);
            }
        }
    }

    wrapper.alloc = alloc;
    wrapper.terminal = Terminal.init(alloc, .{
        .cols = @intCast(cols),
        .rows = @intCast(rows),
        .max_scrollback = scrollback_limit,
        .colors = colors,
    }) catch {
        alloc.destroy(wrapper);
        return null;
    };

    // Initialize response buffer
    wrapper.response_buffer = std.ArrayList(u8).empty;

    // Initialize stream with a handler that references wrapper-owned state.
    // ResponseStream takes ownership of this handler and deinitializes it in stream.deinit().
    wrapper.stream = ResponseStream.init(
        ResponseHandler.init(alloc, &wrapper.terminal, &wrapper.response_buffer),
    );
    wrapper.render_state = RenderState.empty;
    wrapper.last_screen_is_alternate = false;
    wrapper.scrollback_limit_lines = scrollback_limit_lines;

    // NOTE: linefeed mode must be FALSE to match native terminal behavior
    // When true, LF does automatic CR which breaks apps like nvim
    wrapper.terminal.modes.set(.linefeed, false);

    // Enable grapheme clustering (mode 2027) by default for proper Unicode support.
    // This makes Hindi, Arabic, emoji sequences, etc. render correctly by treating
    // multi-codepoint grapheme clusters as single visual units.
    wrapper.terminal.modes.set(.grapheme_cluster, true);

    return @ptrCast(wrapper);
}

pub fn free(ptr: ?*anyopaque) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    const alloc = wrapper.alloc;
    // stream.deinit() calls handler.deinit() internally.
    wrapper.stream.deinit();
    wrapper.response_buffer.deinit(alloc);
    wrapper.render_state.deinit(alloc);
    wrapper.terminal.deinit(alloc);
    alloc.destroy(wrapper);
}

pub fn resize(ptr: ?*anyopaque, cols: c_int, rows: c_int) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    wrapper.terminal.resize(wrapper.alloc, @intCast(cols), @intCast(rows)) catch return;
    if (wrapper.terminal.screens.get(.primary)) |primary| {
        primary.pages.explicit_max_size = resolveScrollbackMaxSize(
            wrapper.scrollback_limit_lines,
        );
    }
    trimScrollbackLines(wrapper);
}

pub fn setPixelSize(ptr: ?*anyopaque, width_px: c_int, height_px: c_int) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    if (width_px <= 0 or height_px <= 0) return;
    const next_width: u32 = @intCast(width_px);
    const next_height: u32 = @intCast(height_px);
    if (wrapper.terminal.width_px == next_width and wrapper.terminal.height_px == next_height) return;
    wrapper.terminal.width_px = next_width;
    wrapper.terminal.height_px = next_height;
    var it = wrapper.terminal.screens.all.iterator();
    while (it.next()) |entry| {
        entry.value.*.kitty_images.dirty = true;
    }
}

pub fn write(ptr: ?*anyopaque, data: [*]const u8, len: usize) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    // Reset virtual tail trim on every write so stale trims don't persist.
    // If the JS side needs to trim after a specific write (e.g. pi full redraw),
    // it calls eraseScrollbackTail() after write() returns.
    wrapper.scrollback_tail_trim = 0;
    wrapper.stream.nextSlice(data[0..len]);
    trimScrollbackLines(wrapper);
}

pub fn trimScrollback(ptr: ?*anyopaque, lines: c_uint) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    pruneScrollbackLines(wrapper, @intCast(lines));
}

/// Virtually trim the newest N scrollback lines by hiding them from
/// getScrollbackLength / getScrollbackLine reads. Does NOT physically
/// remove pages (which would violate PageList serial-number invariants).
pub fn eraseScrollbackTail(ptr: ?*anyopaque, lines: c_uint) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    wrapper.scrollback_tail_trim += @as(usize, @intCast(lines));
}
