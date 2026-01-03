const ghostty = @import("ghostty");
const state = @import("state.zig");
const types = @import("types.zig");

const Style = ghostty.Style;
const color = ghostty.color;
const TerminalWrapper = state.TerminalWrapper;
const GhosttyCell = types.GhosttyCell;

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
