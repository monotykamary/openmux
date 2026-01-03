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
    const scrollback_limit: usize = if (config_) |cfg|
        if (cfg.scrollback_limit == 0) std.math.maxInt(usize) else cfg.scrollback_limit
    else
        10_000;

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

    // Initialize handler with references to terminal and response buffer
    wrapper.handler = ResponseHandler.init(alloc, &wrapper.terminal, &wrapper.response_buffer);

    // Initialize stream with the handler
    wrapper.stream = ResponseStream.init(wrapper.handler);

    wrapper.* = .{
        .alloc = alloc,
        .terminal = wrapper.terminal,
        .handler = wrapper.handler,
        .stream = wrapper.stream,
        .render_state = RenderState.empty,
        .response_buffer = wrapper.response_buffer,
    };

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
    wrapper.stream.deinit();
    wrapper.response_buffer.deinit(alloc);
    wrapper.render_state.deinit(alloc);
    wrapper.terminal.deinit(alloc);
    alloc.destroy(wrapper);
}

pub fn resize(ptr: ?*anyopaque, cols: c_int, rows: c_int) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    wrapper.terminal.resize(wrapper.alloc, @intCast(cols), @intCast(rows)) catch return;
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
    wrapper.stream.nextSlice(data[0..len]) catch return;
}
