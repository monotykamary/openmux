const std = @import("std");
const ghostty = @import("ghostty");
const state = @import("state.zig");
const types = @import("types.zig");

const TerminalWrapper = state.TerminalWrapper;
const RenderState = ghostty.RenderState;
const Style = ghostty.Style;
const color = ghostty.color;
const GhosttyCell = types.GhosttyCell;
const GhosttyDirty = types.GhosttyDirty;

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
