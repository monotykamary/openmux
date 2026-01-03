//! C API wrapper for Terminal
//!
//! This provides a minimal, high-performance interface to Ghostty's Terminal
//! for WASM export. The key optimization is using RenderState which provides
//! a pre-computed snapshot of all render data in a single update call.
//!
//! API Design:
//! - Lifecycle: new, free, resize, write
//! - Rendering: render_state_update, render_state_get_viewport, etc.
//!
//! The RenderState approach means:
//! - ONE call to update all state (render_state_update)
//! - ONE call to get all cells (render_state_get_viewport)
//! - No per-row or per-cell WASM boundary crossings!

const std = @import("std");
const Allocator = std.mem.Allocator;
const builtin = @import("builtin");
const ghostty = @import("ghostty");

const Terminal = ghostty.Terminal;
const apc = ghostty.apc;
const Action = ghostty.StreamAction;
const RenderState = ghostty.RenderState;
const color = ghostty.color;
const modespkg = ghostty.modes;
const Style = ghostty.Style;
const device_status = ghostty.device_status;
const kitty_gfx = ghostty.kitty.graphics;
const kitty_max_dimension: u32 = 10000;

const log = std.log.scoped(.terminal_c);
const is_posix_clock = switch (builtin.os.tag) {
    .windows, .uefi, .wasi => false,
    else => true,
};

/// Response handler that processes VT sequences and queues responses.
/// This extends the readonly stream handler to also handle queries.
const ResponseHandler = struct {
    alloc: Allocator,
    terminal: *Terminal,
    response_buffer: *std.ArrayList(u8),
    apc: apc.Handler = .{},

    pub fn init(alloc: Allocator, terminal: *Terminal, response_buffer: *std.ArrayList(u8)) ResponseHandler {
        return .{
            .alloc = alloc,
            .terminal = terminal,
            .response_buffer = response_buffer,
            .apc = .{},
        };
    }

    pub fn deinit(self: *ResponseHandler) void {
        self.apc.deinit();
    }

    pub fn vt(
        self: *ResponseHandler,
        comptime action: Action.Tag,
        value: Action.Value(action),
    ) !void {
        switch (action) {
            // Device status reports - these need responses
            .device_status => try self.handleDeviceStatus(value.request),
            .device_attributes => try self.handleDeviceAttributes(value),

            // All the terminal state modifications (same as stream_readonly.zig)
            .print => try self.terminal.print(value.cp),
            .print_repeat => try self.terminal.printRepeat(value),
            .backspace => self.terminal.backspace(),
            .carriage_return => self.terminal.carriageReturn(),
            .linefeed => try self.terminal.linefeed(),
            .index => try self.terminal.index(),
            .next_line => {
                try self.terminal.index();
                self.terminal.carriageReturn();
            },
            .reverse_index => self.terminal.reverseIndex(),
            .cursor_up => self.terminal.cursorUp(value.value),
            .cursor_down => self.terminal.cursorDown(value.value),
            .cursor_left => self.terminal.cursorLeft(value.value),
            .cursor_right => self.terminal.cursorRight(value.value),
            .cursor_pos => self.terminal.setCursorPos(value.row, value.col),
            .cursor_col => self.terminal.setCursorPos(self.terminal.screens.active.cursor.y + 1, value.value),
            .cursor_row => self.terminal.setCursorPos(value.value, self.terminal.screens.active.cursor.x + 1),
            .cursor_col_relative => self.terminal.setCursorPos(
                self.terminal.screens.active.cursor.y + 1,
                self.terminal.screens.active.cursor.x + 1 +| value.value,
            ),
            .cursor_row_relative => self.terminal.setCursorPos(
                self.terminal.screens.active.cursor.y + 1 +| value.value,
                self.terminal.screens.active.cursor.x + 1,
            ),
            .cursor_style => {
                const blink = switch (value) {
                    .default, .steady_block, .steady_bar, .steady_underline => false,
                    .blinking_block, .blinking_bar, .blinking_underline => true,
                };
                const style: ghostty.CursorStyle = switch (value) {
                    .default, .blinking_block, .steady_block => .block,
                    .blinking_bar, .steady_bar => .bar,
                    .blinking_underline, .steady_underline => .underline,
                };
                self.terminal.modes.set(.cursor_blinking, blink);
                self.terminal.screens.active.cursor.cursor_style = style;
            },
            .erase_display_below => self.terminal.eraseDisplay(.below, value),
            .erase_display_above => self.terminal.eraseDisplay(.above, value),
            .erase_display_complete => self.terminal.eraseDisplay(.complete, value),
            .erase_display_scrollback => self.terminal.eraseDisplay(.scrollback, value),
            .erase_display_scroll_complete => self.terminal.eraseDisplay(.scroll_complete, value),
            .erase_line_right => self.terminal.eraseLine(.right, value),
            .erase_line_left => self.terminal.eraseLine(.left, value),
            .erase_line_complete => self.terminal.eraseLine(.complete, value),
            .erase_line_right_unless_pending_wrap => self.terminal.eraseLine(.right_unless_pending_wrap, value),
            .delete_chars => self.terminal.deleteChars(value),
            .erase_chars => self.terminal.eraseChars(value),
            .insert_lines => self.terminal.insertLines(value),
            .insert_blanks => self.terminal.insertBlanks(value),
            .delete_lines => self.terminal.deleteLines(value),
            .scroll_up => try self.terminal.scrollUp(value),
            .scroll_down => self.terminal.scrollDown(value),
            .horizontal_tab => try self.horizontalTab(value),
            .horizontal_tab_back => try self.horizontalTabBack(value),
            .tab_clear_current => self.terminal.tabClear(.current),
            .tab_clear_all => self.terminal.tabClear(.all),
            .tab_set => self.terminal.tabSet(),
            .tab_reset => self.terminal.tabReset(),
            .set_mode => try self.setMode(value.mode, true),
            .reset_mode => try self.setMode(value.mode, false),
            .save_mode => self.terminal.modes.save(value.mode),
            .restore_mode => {
                const v = self.terminal.modes.restore(value.mode);
                try self.setMode(value.mode, v);
            },
            .top_and_bottom_margin => self.terminal.setTopAndBottomMargin(value.top_left, value.bottom_right),
            .left_and_right_margin => self.terminal.setLeftAndRightMargin(value.top_left, value.bottom_right),
            .left_and_right_margin_ambiguous => {
                if (self.terminal.modes.get(.enable_left_and_right_margin)) {
                    self.terminal.setLeftAndRightMargin(0, 0);
                } else {
                    self.terminal.saveCursor();
                }
            },
            .save_cursor => self.terminal.saveCursor(),
            .restore_cursor => try self.terminal.restoreCursor(),
            .invoke_charset => self.terminal.invokeCharset(value.bank, value.charset, value.locking),
            .configure_charset => self.terminal.configureCharset(value.slot, value.charset),
            .set_attribute => switch (value) {
                .unknown => {},
                else => self.terminal.setAttribute(value) catch {},
            },
            .protected_mode_off => self.terminal.setProtectedMode(.off),
            .protected_mode_iso => self.terminal.setProtectedMode(.iso),
            .protected_mode_dec => self.terminal.setProtectedMode(.dec),
            .mouse_shift_capture => self.terminal.flags.mouse_shift_capture = if (value) .true else .false,
            .kitty_keyboard_push => self.terminal.screens.active.kitty_keyboard.push(value.flags),
            .kitty_keyboard_pop => self.terminal.screens.active.kitty_keyboard.pop(@intCast(value)),
            .kitty_keyboard_set => self.terminal.screens.active.kitty_keyboard.set(.set, value.flags),
            .kitty_keyboard_set_or => self.terminal.screens.active.kitty_keyboard.set(.@"or", value.flags),
            .kitty_keyboard_set_not => self.terminal.screens.active.kitty_keyboard.set(.not, value.flags),
            .modify_key_format => {
                self.terminal.flags.modify_other_keys_2 = false;
                switch (value) {
                    .other_keys_numeric => self.terminal.flags.modify_other_keys_2 = true,
                    else => {},
                }
            },
            .active_status_display => self.terminal.status_display = value,
            .decaln => try self.terminal.decaln(),
            .full_reset => self.terminal.fullReset(),
            .start_hyperlink => try self.terminal.screens.active.startHyperlink(value.uri, value.id),
            .end_hyperlink => self.terminal.screens.active.endHyperlink(),
            .prompt_start => {
                self.terminal.screens.active.cursor.page_row.semantic_prompt = .prompt;
                self.terminal.flags.shell_redraws_prompt = value.redraw;
            },
            .prompt_continuation => self.terminal.screens.active.cursor.page_row.semantic_prompt = .prompt_continuation,
            .prompt_end => self.terminal.markSemanticPrompt(.input),
            .end_of_input => self.terminal.markSemanticPrompt(.command),
            .end_of_command => self.terminal.screens.active.cursor.page_row.semantic_prompt = .input,
            .mouse_shape => self.terminal.mouse_shape = value,
            .color_operation => try self.colorOperation(value.op, &value.requests),
            .kitty_color_report => try self.kittyColorOperation(value),

            // Actions that require no response and have no terminal effect
            .dcs_hook,
            .dcs_put,
            .dcs_unhook,
            .apc_start => self.apc.start(),
            .apc_put => self.apc.feed(self.alloc, value),
            .apc_end => try self.apcEnd(),
            .bell,
            .enquiry,
            .request_mode,
            .request_mode_unknown,
            .size_report,
            .xtversion,
            .kitty_keyboard_query,
            .window_title,
            .report_pwd,
            .show_desktop_notification,
            .progress_report,
            .clipboard_contents,
            .title_push,
            .title_pop,
            => {},
        }
    }

    fn apcEnd(self: *ResponseHandler) !void {
        var cmd = self.apc.end() orelse return;
        defer cmd.deinit(self.alloc);

        switch (cmd) {
            .kitty => |*kitty_cmd| {
                if (self.handleKittyCommand(kitty_cmd)) |resp| {
                    var buf: [1024]u8 = undefined;
                    var writer: std.Io.Writer = .fixed(&buf);
                    try resp.encode(&writer);
                    const final = writer.buffered();
                    if (final.len > 0) {
                        try self.response_buffer.appendSlice(self.alloc, final);
                    }
                }
            },
        }
    }

    fn handleKittyCommand(
        self: *ResponseHandler,
        cmd: *kitty_gfx.Command,
    ) ?kitty_gfx.Response {
        switch (cmd.control) {
            .query => |t| {
                if (t.medium != .direct) {
                    const resp: kitty_gfx.Response = .{
                        .id = t.image_id,
                        .image_number = t.image_number,
                        .placement_id = t.placement_id,
                    };
                    return self.applyKittyQuiet(cmd, resp);
                }
            },
            .transmit, .transmit_and_display => {
                if (cmd.data.len == 0) {
                    if (self.handleKittyPassthrough(cmd)) |resp| {
                        return resp;
                    }
                }
            },
            else => {},
        }

        return self.terminal.kittyGraphics(self.alloc, cmd);
    }

    fn handleKittyPassthrough(
        self: *ResponseHandler,
        cmd: *kitty_gfx.Command,
    ) ?kitty_gfx.Response {
        const t = cmd.transmission() orelse return null;
        if (t.more_chunks) return null;

        const storage = &self.terminal.screens.active.kitty_images;
        if (!storage.enabled()) return null;

        var resp: kitty_gfx.Response = .{
            .id = t.image_id,
            .image_number = t.image_number,
            .placement_id = t.placement_id,
        };

        if (t.image_id > 0 and t.image_number > 0) {
            resp.message = "EINVAL: image ID and number are mutually exclusive";
            return self.applyKittyQuiet(cmd, resp);
        }

        var image: kitty_gfx.Image = .{
            .id = t.image_id,
            .number = t.image_number,
            .width = t.width,
            .height = t.height,
            .format = t.format,
            .compression = t.compression,
            .data = "",
            .transmit_time = std.time.Instant.now() catch {
                resp.message = "EINVAL: internal error";
                return self.applyKittyQuiet(cmd, resp);
            },
            .implicit_id = false,
        };

        if (image.width == 0 or image.height == 0) {
            resp.message = "EINVAL: dimensions required";
            return self.applyKittyQuiet(cmd, resp);
        }

        if (image.width > kitty_max_dimension or image.height > kitty_max_dimension) {
            resp.message = "EINVAL: dimensions too large";
            return self.applyKittyQuiet(cmd, resp);
        }

        if (image.id == 0) {
            image.id = storage.next_image_id;
            storage.next_image_id +%= 1;
            if (image.number == 0) {
                image.implicit_id = true;
            }
        }

        storage.addImage(self.alloc, image) catch |err| {
            image.deinit(self.alloc);
            encodeKittyError(&resp, err);
            return self.applyKittyQuiet(cmd, resp);
        };

        if (cmd.display()) |d| {
            var display = d;
            display.image_id = image.id;
            var display_cmd: kitty_gfx.Command = .{
                .control = .{ .display = display },
                .quiet = cmd.quiet,
                .data = "",
            };
            const display_resp = self.terminal.kittyGraphics(self.alloc, &display_cmd);
            if (image.implicit_id) return null;
            return display_resp;
        }

        if (image.implicit_id) return null;
        resp.id = image.id;
        return self.applyKittyQuiet(cmd, resp);
    }

    fn applyKittyQuiet(
        self: *ResponseHandler,
        cmd: *const kitty_gfx.Command,
        resp: kitty_gfx.Response,
    ) ?kitty_gfx.Response {
        _ = self;

        if (resp.empty()) return null;
        return switch (cmd.quiet) {
            .no => resp,
            .ok => if (resp.ok()) null else resp,
            .failures => null,
        };
    }

    fn encodeKittyError(resp: *kitty_gfx.Response, err: anyerror) void {
        switch (err) {
            error.OutOfMemory => resp.message = "ENOMEM: out of memory",
            error.InternalError => resp.message = "EINVAL: internal error",
            error.InvalidData => resp.message = "EINVAL: invalid data",
            error.DecompressionFailed => resp.message = "EINVAL: decompression failed",
            error.FilePathTooLong => resp.message = "EINVAL: file path too long",
            error.TemporaryFileNotInTempDir => resp.message = "EINVAL: temporary file not in temp dir",
            error.TemporaryFileNotNamedCorrectly => resp.message = "EINVAL: temporary file not named correctly",
            error.UnsupportedFormat => resp.message = "EINVAL: unsupported format",
            error.UnsupportedMedium => resp.message = "EINVAL: unsupported medium",
            error.UnsupportedDepth => resp.message = "EINVAL: unsupported pixel depth",
            error.DimensionsRequired => resp.message = "EINVAL: dimensions required",
            error.DimensionsTooLarge => resp.message = "EINVAL: dimensions too large",
            else => resp.message = "EINVAL: invalid data",
        }
    }

    fn handleDeviceStatus(self: *ResponseHandler, req: device_status.Request) !void {
        switch (req) {
            .operating_status => {
                // DSR 5 - Operating status report: always report "OK"
                try self.response_buffer.appendSlice(self.alloc, "\x1B[0n");
            },
            .cursor_position => {
                // DSR 6 - Cursor position report (CPR)
                const cursor = self.terminal.screens.active.cursor;
                const x = if (self.terminal.modes.get(.origin))
                    cursor.x -| self.terminal.scrolling_region.left
                else
                    cursor.x;
                const y = if (self.terminal.modes.get(.origin))
                    cursor.y -| self.terminal.scrolling_region.top
                else
                    cursor.y;
                var buf: [32]u8 = undefined;
                const resp = std.fmt.bufPrint(&buf, "\x1B[{};{}R", .{
                    y + 1,
                    x + 1,
                }) catch return;
                try self.response_buffer.appendSlice(self.alloc, resp);
            },
            .color_scheme => {
                // Not supported in WASM context
            },
        }
    }

    fn handleDeviceAttributes(self: *ResponseHandler, req: ghostty.DeviceAttributeReq) !void {
        // Match main Ghostty behavior for device attribute responses
        switch (req) {
            .primary => {
                // DA1 - Primary Device Attributes
                // Report as VT220 with color support (simplified for WASM)
                // 62 = Level 2 conformance, 22 = Color text
                try self.response_buffer.appendSlice(self.alloc, "\x1B[?62;22c");
            },
            .secondary => {
                // DA2 - Secondary Device Attributes
                // Report firmware version 1.10.0 (matching main Ghostty)
                try self.response_buffer.appendSlice(self.alloc, "\x1B[>1;10;0c");
            },
            else => {
                // DA3 and other requests - not implemented in WASM context
            },
        }
    }

    inline fn horizontalTab(self: *ResponseHandler, count: u16) !void {
        for (0..count) |_| {
            const x = self.terminal.screens.active.cursor.x;
            try self.terminal.horizontalTab();
            if (x == self.terminal.screens.active.cursor.x) break;
        }
    }

    inline fn horizontalTabBack(self: *ResponseHandler, count: u16) !void {
        for (0..count) |_| {
            const x = self.terminal.screens.active.cursor.x;
            try self.terminal.horizontalTabBack();
            if (x == self.terminal.screens.active.cursor.x) break;
        }
    }

    fn setMode(self: *ResponseHandler, mode: modespkg.Mode, enabled: bool) !void {
        self.terminal.modes.set(mode, enabled);
        switch (mode) {
            .autorepeat, .reverse_colors => {},
            .origin => self.terminal.setCursorPos(1, 1),
            .enable_left_and_right_margin => if (!enabled) {
                self.terminal.scrolling_region.left = 0;
                self.terminal.scrolling_region.right = self.terminal.cols - 1;
            },
            .alt_screen_legacy => try self.terminal.switchScreenMode(.@"47", enabled),
            .alt_screen => try self.terminal.switchScreenMode(.@"1047", enabled),
            .alt_screen_save_cursor_clear_enter => try self.terminal.switchScreenMode(.@"1049", enabled),
            .save_cursor => if (enabled) {
                self.terminal.saveCursor();
            } else {
                try self.terminal.restoreCursor();
            },
            .enable_mode_3 => {},
            .@"132_column" => try self.terminal.deccolm(
                self.terminal.screens.active.alloc,
                if (enabled) .@"132_cols" else .@"80_cols",
            ),
            else => {},
        }
    }

    fn colorOperation(self: *ResponseHandler, op: anytype, requests: anytype) !void {
        _ = self;
        _ = op;
        _ = requests;
        // Color operations are not supported in WASM context
    }

    fn kittyColorOperation(self: *ResponseHandler, value: anytype) !void {
        _ = self;
        _ = value;
        // Kitty color operations are not supported in WASM context
    }
};

/// The stream type using our response handler
const ResponseStream = ghostty.Stream(ResponseHandler);

/// Wrapper struct that owns the Terminal, stream, and RenderState.
const TerminalWrapper = struct {
    alloc: Allocator,
    terminal: Terminal,
    handler: ResponseHandler,
    stream: ResponseStream,
    render_state: RenderState,
    /// Response buffer for DSR and other query responses
    response_buffer: std.ArrayList(u8),
    /// Track alternate screen state to detect screen switches
    last_screen_is_alternate: bool = false,
};

/// C-compatible cell structure (16 bytes)
pub const GhosttyCell = extern struct {
    codepoint: u32,
    fg_r: u8,
    fg_g: u8,
    fg_b: u8,
    bg_r: u8,
    bg_g: u8,
    bg_b: u8,
    flags: u8,
    width: u8,
    hyperlink_id: u16,
    grapheme_len: u8 = 0, // Number of extra codepoints beyond first
    _pad: u8 = 0,
};

/// Dirty state
pub const GhosttyDirty = enum(u8) {
    none = 0,
    partial = 1,
    full = 2,
};

/// C-compatible terminal configuration
pub const GhosttyTerminalConfig = extern struct {
    scrollback_limit: u32,
    fg_color: u32,
    bg_color: u32,
    cursor_color: u32,
    palette: [16]u32,
};

/// Kitty graphics image metadata
pub const GhosttyKittyImageInfo = extern struct {
    id: u32,
    number: u32,
    width: u32,
    height: u32,
    data_len: u32,
    format: u8,
    compression: u8,
    implicit_id: u8,
    _pad: u8 = 0,
    transmit_time: u64,
};

/// Kitty graphics placement metadata (pin placements only)
pub const GhosttyKittyPlacement = extern struct {
    image_id: u32,
    placement_id: u32,
    placement_tag: u8,
    _pad: [3]u8 = .{ 0, 0, 0 },
    screen_x: u32,
    screen_y: u32,
    x_offset: u32,
    y_offset: u32,
    source_x: u32,
    source_y: u32,
    source_width: u32,
    source_height: u32,
    columns: u32,
    rows: u32,
    z: i32,
};

// ============================================================================
// Lifecycle
// ============================================================================

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
    wrapper.response_buffer = .{};

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

// ============================================================================
// RenderState API - High-performance rendering
// ============================================================================

/// Update render state from terminal. Call once per frame.
/// Returns dirty state: 0=none, 1=partial, 2=full
pub fn renderStateUpdate(ptr: ?*anyopaque) callconv(.c) GhosttyDirty {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return .full));
    
    // Detect screen buffer switch (normal <-> alternate)
    const current_is_alternate = wrapper.terminal.screens.active_key == .alternate;
    const screen_switched = current_is_alternate != wrapper.last_screen_is_alternate;
    wrapper.last_screen_is_alternate = current_is_alternate;
    
    // When screen switches, we must fully reset the render state to avoid
    // stale cached cell data from the previous screen buffer.
    if (screen_switched) {
        wrapper.render_state.deinit(wrapper.alloc);
        wrapper.render_state = RenderState.empty;
    }
    
    wrapper.render_state.update(wrapper.alloc, &wrapper.terminal) catch return .full;
    
    // If screen switched, always return full dirty to force complete redraw
    if (screen_switched) {
        return .full;
    }
    
    return switch (wrapper.render_state.dirty) {
        .false => .none,
        .partial => .partial,
        .full => .full,
    };
}

/// Get dimensions from render state
pub fn renderStateGetCols(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.render_state.cols);
}

pub fn renderStateGetRows(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.render_state.rows);
}

/// Get cursor X position
pub fn renderStateGetCursorX(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.render_state.cursor.active.x);
}

/// Get cursor Y position  
pub fn renderStateGetCursorY(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.render_state.cursor.active.y);
}

/// Check if cursor is visible
pub fn renderStateGetCursorVisible(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.render_state.cursor.visible;
}

/// Get default background color as 0xRRGGBB
pub fn renderStateGetBgColor(ptr: ?*anyopaque) callconv(.c) u32 {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    const bg = wrapper.render_state.colors.background;
    return (@as(u32, bg.r) << 16) | (@as(u32, bg.g) << 8) | bg.b;
}

/// Get default foreground color as 0xRRGGBB
pub fn renderStateGetFgColor(ptr: ?*anyopaque) callconv(.c) u32 {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0xCCCCCC));
    const fg = wrapper.render_state.colors.foreground;
    return (@as(u32, fg.r) << 16) | (@as(u32, fg.g) << 8) | fg.b;
}

/// Check if row is dirty
pub fn renderStateIsRowDirty(ptr: ?*anyopaque, y: c_int) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return true));
    if (wrapper.render_state.dirty == .full) return true;
    if (wrapper.render_state.dirty == .false) return false;
    const y_usize: usize = @intCast(y);
    if (y_usize >= wrapper.render_state.row_data.len) return false;
    return wrapper.render_state.row_data.items(.dirty)[y_usize];
}

/// Mark render state as clean after rendering
pub fn renderStateMarkClean(ptr: ?*anyopaque) callconv(.c) void {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return));
    wrapper.render_state.dirty = .false;
    @memset(wrapper.render_state.row_data.items(.dirty), false);
}

/// Get ALL viewport cells in one call - reads directly from terminal screen buffer.
/// This bypasses the RenderState cache to ensure fresh data for all rows.
/// Returns total cells written (rows * cols), or -1 on error.
pub fn renderStateGetViewport(
    ptr: ?*anyopaque,
    out: [*]GhosttyCell,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const rs = &wrapper.render_state;
    const t = &wrapper.terminal;
    const rows = rs.rows;
    const cols = rs.cols;
    const total: usize = @as(usize, rows) * cols;

    if (buf_size < total) return -1;

    // Read directly from terminal's active screen, bypassing RenderState cache.
    // This ensures we always get fresh data for ALL rows, not just dirty ones.
    const pages = &t.screens.active.pages;

    var idx: usize = 0;
    for (0..rows) |y| {
        // Get the row from the active viewport
        const pin = pages.pin(.{ .active = .{ .y = @intCast(y) } }) orelse {
            // Row doesn't exist, fill with defaults
            for (0..cols) |_| {
                out[idx] = .{
                    .codepoint = 0,
                    .fg_r = rs.colors.foreground.r,
                    .fg_g = rs.colors.foreground.g,
                    .fg_b = rs.colors.foreground.b,
                    .bg_r = rs.colors.background.r,
                    .bg_g = rs.colors.background.g,
                    .bg_b = rs.colors.background.b,
                    .flags = 0,
                    .width = 1,
                    .hyperlink_id = 0,
                };
                idx += 1;
            }
            continue;
        };

        const cells = pin.cells(.all);
        const page = pin.node.data;

        for (0..cols) |x| {
            if (x >= cells.len) {
                // Past end of row, fill with default
                out[idx] = .{
                    .codepoint = 0,
                    .fg_r = rs.colors.foreground.r,
                    .fg_g = rs.colors.foreground.g,
                    .fg_b = rs.colors.foreground.b,
                    .bg_r = rs.colors.background.r,
                    .bg_g = rs.colors.background.g,
                    .bg_b = rs.colors.background.b,
                    .flags = 0,
                    .width = 1,
                    .hyperlink_id = 0,
                };
                idx += 1;
                continue;
            }

            const cell = &cells[x];

            // Get style from page styles (cell has style_id)
            const sty: Style = if (cell.style_id > 0)
                page.styles.get(page.memory, cell.style_id).*
            else
                .{};

            // Resolve colors
            const fg: color.RGB = switch (sty.fg_color) {
                .none => rs.colors.foreground,
                .palette => |i| rs.colors.palette[i],
                .rgb => |rgb| rgb,
            };
            const bg: color.RGB = if (sty.bg(cell, &rs.colors.palette)) |rgb| rgb else rs.colors.background;

            // Build flags
            var flags: u8 = 0;
            if (sty.flags.bold) flags |= 1 << 0;
            if (sty.flags.italic) flags |= 1 << 1;
            if (sty.flags.underline != .none) flags |= 1 << 2;
            if (sty.flags.strikethrough) flags |= 1 << 3;
            if (sty.flags.inverse) flags |= 1 << 4;
            if (sty.flags.invisible) flags |= 1 << 5;
            if (sty.flags.blink) flags |= 1 << 6;
            if (sty.flags.faint) flags |= 1 << 7;

            // Get grapheme length if cell has grapheme data
            const grapheme_len: u8 = if (cell.hasGrapheme())
                if (page.lookupGrapheme(cell)) |cps| @min(@as(u8, @intCast(cps.len)), 255) else 0
            else
                0;

            out[idx] = .{
                .codepoint = cell.codepoint(),
                .fg_r = fg.r,
                .fg_g = fg.g,
                .fg_b = fg.b,
                .bg_r = bg.r,
                .bg_g = bg.g,
                .bg_b = bg.b,
                .flags = flags,
                .width = switch (cell.wide) {
                    .narrow => 1,
                    .wide => 2,
                    .spacer_tail, .spacer_head => 0,
                },
                .hyperlink_id = if (cell.hyperlink) 1 else 0,
                .grapheme_len = grapheme_len,
            };
            idx += 1;
        }
    }

    return @intCast(total);
}

/// Get grapheme codepoints for a cell at (row, col).
/// Returns all codepoints (including the first one) as u32 values.
/// Returns the number of codepoints written, or -1 on error.
pub fn renderStateGetGrapheme(
    ptr: ?*anyopaque,
    row: c_int,
    col: c_int,
    out: [*]u32,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const rs = &wrapper.render_state;
    const t = &wrapper.terminal;
    const cols: usize = @intCast(rs.cols);

    if (row < 0 or col < 0) return -1;
    if (@as(usize, @intCast(row)) >= rs.rows) return -1;
    if (@as(usize, @intCast(col)) >= cols) return -1;
    if (buf_size < 1) return -1;

    // Get the pin for this row from the terminal's active screen
    const pages = &t.screens.active.pages;
    const pin = pages.pin(.{ .active = .{ .y = @intCast(row) } }) orelse return -1;

    const cells = pin.cells(.all);
    const page = pin.node.data;
    const x: usize = @intCast(col);

    if (x >= cells.len) return -1;

    const cell = &cells[x];

    // First codepoint is always from the cell
    out[0] = cell.codepoint();
    var count: usize = 1;

    // Add extra codepoints from grapheme map if present
    if (cell.hasGrapheme()) {
        if (page.lookupGrapheme(cell)) |cps| {
            for (cps) |cp| {
                if (count >= buf_size) break;
                out[count] = cp;
                count += 1;
            }
        }
    }

    return @intCast(count);
}

// ============================================================================
// Terminal Modes (minimal set for compatibility)
// ============================================================================

pub fn isAlternateScreen(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.terminal.screens.active_key == .alternate;
}

pub fn hasMouseTracking(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.terminal.modes.get(.mouse_event_normal) or
           wrapper.terminal.modes.get(.mouse_event_button) or
           wrapper.terminal.modes.get(.mouse_event_any);
}

/// Query arbitrary terminal mode by number
/// Returns true if mode is set, false otherwise
pub fn getMode(ptr: ?*anyopaque, mode_num: c_int, is_ansi: bool) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    const mode = modespkg.modeFromInt(@intCast(mode_num), is_ansi) orelse return false;
    return wrapper.terminal.modes.get(mode);
}

/// Get current Kitty keyboard flags (bitmask)
pub fn getKittyKeyboardFlags(ptr: ?*anyopaque) callconv(.c) u8 {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    return @intCast(wrapper.terminal.screens.active.kitty_keyboard.current().int());
}

// ============================================================================
// Scrollback API
// ============================================================================

/// Get the number of scrollback lines (history, not including active screen)
pub fn getScrollbackLength(ptr: ?*anyopaque) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return 0));
    const pages = &wrapper.terminal.screens.active.pages;
    // total_rows includes both scrollback and active area
    // We subtract rows (active area) to get just scrollback
    if (pages.total_rows <= pages.rows) return 0;
    return @intCast(pages.total_rows - pages.rows);
}

/// Get a line from the scrollback buffer
/// offset 0 = oldest line in scrollback, offset (length-1) = most recent scrollback line
/// Returns number of cells written, or -1 on error
pub fn getScrollbackLine(
    ptr: ?*anyopaque,
    offset: c_int,
    out: [*]GhosttyCell,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const rs = &wrapper.render_state;
    const cols = rs.cols;
    
    if (buf_size < cols) return -1;
    if (offset < 0) return -1;
    
    const scrollback_len = getScrollbackLength(ptr);
    if (offset >= scrollback_len) return -1;
    
    // Get the pin for this scrollback row
    // history point: y=0 is oldest, y=scrollback_len-1 is newest
    const pages = &wrapper.terminal.screens.active.pages;
    const pin = pages.pin(.{ .history = .{ .y = @intCast(offset) } }) orelse return -1;
    
    // Get cells for this row
    const cells = pin.cells(.all);
    const page = pin.node.data;
    
    // Fill output buffer
    for (0..cols) |x| {
        if (x >= cells.len) {
            // Fill with default
            out[x] = .{
                .codepoint = 0,
                .fg_r = rs.colors.foreground.r,
                .fg_g = rs.colors.foreground.g,
                .fg_b = rs.colors.foreground.b,
                .bg_r = rs.colors.background.r,
                .bg_g = rs.colors.background.g,
                .bg_b = rs.colors.background.b,
                .flags = 0,
                .width = 1,
                .hyperlink_id = 0,
            };
            continue;
        }
        
        const cell = &cells[x];
        
        // Get style from page styles (cell has style_id)
        const sty: Style = if (cell.style_id > 0)
            page.styles.get(page.memory, cell.style_id).*
        else
            .{};
        
        // Resolve colors
        const fg: color.RGB = switch (sty.fg_color) {
            .none => rs.colors.foreground,
            .palette => |i| rs.colors.palette[i],
            .rgb => |rgb| rgb,
        };
        const bg: color.RGB = if (sty.bg(cell, &rs.colors.palette)) |rgb| rgb else rs.colors.background;
        
        // Build flags
        var flags: u8 = 0;
        if (sty.flags.bold) flags |= 1 << 0;
        if (sty.flags.italic) flags |= 1 << 1;
        if (sty.flags.underline != .none) flags |= 1 << 2;
        if (sty.flags.strikethrough) flags |= 1 << 3;
        if (sty.flags.inverse) flags |= 1 << 4;
        if (sty.flags.invisible) flags |= 1 << 5;
        if (sty.flags.blink) flags |= 1 << 6;
        if (sty.flags.faint) flags |= 1 << 7;

        // Get grapheme length if cell has grapheme data
        const grapheme_len: u8 = if (cell.hasGrapheme())
            if (page.lookupGrapheme(cell)) |cps| @min(@as(u8, @intCast(cps.len)), 255) else 0
        else
            0;

        out[x] = .{
            .codepoint = cell.codepoint(),
            .fg_r = fg.r,
            .fg_g = fg.g,
            .fg_b = fg.b,
            .bg_r = bg.r,
            .bg_g = bg.g,
            .bg_b = bg.b,
            .flags = flags,
            .width = switch (cell.wide) {
                .narrow => 1,
                .wide => 2,
                .spacer_tail, .spacer_head => 0,
            },
            .hyperlink_id = if (cell.hyperlink) 1 else 0,
            .grapheme_len = grapheme_len,
        };
    }
    return @intCast(cols);
}

/// Get grapheme codepoints for a cell in the scrollback buffer.
/// Returns all codepoints (including the first one) as u32 values.
/// Returns the number of codepoints written, or -1 on error.
pub fn getScrollbackGrapheme(
    ptr: ?*anyopaque,
    offset: c_int,
    col: c_int,
    out: [*]u32,
    buf_size: usize,
) callconv(.c) c_int {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const rs = &wrapper.render_state;
    const cols: usize = @intCast(rs.cols);

    if (offset < 0 or col < 0) return -1;
    if (@as(usize, @intCast(col)) >= cols) return -1;
    if (buf_size < 1) return -1;

    const scrollback_len = getScrollbackLength(ptr);
    if (offset >= scrollback_len) return -1;

    // Get the pin for this scrollback row
    const pages = &wrapper.terminal.screens.active.pages;
    const pin = pages.pin(.{ .history = .{ .y = @intCast(offset) } }) orelse return -1;

    const cells = pin.cells(.all);
    const page = pin.node.data;
    const x: usize = @intCast(col);

    if (x >= cells.len) return -1;

    const cell = &cells[x];

    // First codepoint is always from the cell
    out[0] = cell.codepoint();
    var count: usize = 1;

    // Add extra codepoints from grapheme map if present
    if (cell.hasGrapheme()) {
        if (page.lookupGrapheme(cell)) |cps| {
            for (cps) |cp| {
                if (count >= buf_size) break;
                out[count] = cp;
                count += 1;
            }
        }
    }

    return @intCast(count);
}

/// Check if a row is a continuation from the previous row (soft-wrapped)
/// This matches xterm.js semantics where isWrapped indicates the row continues
/// from the previous row, not that it wraps to the next row.
pub fn isRowWrapped(ptr: ?*anyopaque, y: c_int) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    const pages = &wrapper.terminal.screens.active.pages;
    
    // Get pin for this row in active area
    const pin = pages.pin(.{ .active = .{ .y = @intCast(y) } }) orelse return false;
    const rac = pin.rowAndCell();
    
    // wrap_continuation means this row continues from the previous row
    return rac.row.wrap_continuation;
}

// ============================================================================
// Response API - for DSR and other terminal queries
// ============================================================================

/// Check if there are pending responses from the terminal
pub fn hasResponse(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.response_buffer.items.len > 0;
}

/// Read pending responses from the terminal.
/// Returns number of bytes written to buffer, or 0 if no responses pending.
/// Returns -1 on error (null pointer or buffer too small).
pub fn readResponse(ptr: ?*anyopaque, out: [*]u8, buf_size: usize) callconv(.c) c_int {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const len = @min(wrapper.response_buffer.items.len, buf_size);
    if (len == 0) return 0;
    
    @memcpy(out[0..len], wrapper.response_buffer.items[0..len]);
    
    // Remove consumed bytes from buffer
    if (len == wrapper.response_buffer.items.len) {
        wrapper.response_buffer.clearRetainingCapacity();
    } else {
        // Shift remaining bytes to front
        std.mem.copyForwards(
            u8,
            wrapper.response_buffer.items[0..],
            wrapper.response_buffer.items[len..],
        );
        wrapper.response_buffer.shrinkRetainingCapacity(wrapper.response_buffer.items.len - len);
    }
    
    return @intCast(len);
}

// ============================================================================
// Kitty Graphics API
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

test "terminal lifecycle" {
    const term = new(80, 24);
    defer free(term);
    try std.testing.expect(term != null);

    _ = renderStateUpdate(term);
    try std.testing.expectEqual(@as(c_int, 80), renderStateGetCols(term));
    try std.testing.expectEqual(@as(c_int, 24), renderStateGetRows(term));
}

test "terminal write and read via render state" {
    const term = new(80, 24);
    defer free(term);

    write(term, "Hello", 5);
    _ = renderStateUpdate(term);

    var cells: [80 * 24]GhosttyCell = undefined;
    const count = renderStateGetViewport(term, &cells, 80 * 24);
    try std.testing.expectEqual(@as(c_int, 80 * 24), count);
    try std.testing.expectEqual(@as(u32, 'H'), cells[0].codepoint);
    try std.testing.expectEqual(@as(u32, 'e'), cells[1].codepoint);
    try std.testing.expectEqual(@as(u32, 'l'), cells[2].codepoint);
    try std.testing.expectEqual(@as(u32, 'l'), cells[3].codepoint);
    try std.testing.expectEqual(@as(u32, 'o'), cells[4].codepoint);
}
