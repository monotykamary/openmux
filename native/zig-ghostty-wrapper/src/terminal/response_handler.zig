const std = @import("std");
const ghostty = @import("ghostty");

const Allocator = std.mem.Allocator;
const Terminal = ghostty.Terminal;
const apc = ghostty.apc;
const Action = ghostty.StreamAction;
const modespkg = ghostty.modes;
const device_status = ghostty.device_status;
const kitty_gfx = ghostty.kitty.graphics;
const kitty_max_dimension: u32 = 10000;

/// Response handler that processes VT sequences and queues responses.
/// This extends the readonly stream handler to also handle queries.
pub const ResponseHandler = struct {
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

pub const ResponseStream = ghostty.Stream(ResponseHandler);
