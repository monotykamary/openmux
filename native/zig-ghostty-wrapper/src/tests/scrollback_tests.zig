const std = @import("std");
const terminal = @import("../terminal.zig");

const testing = std.testing;

test "regular: scrollback exposes oldest lines" {
    const term = terminal.new(4, 1);
    defer terminal.free(term);

    terminal.write(term, "A\r\nB\r\n", 6);
    _ = terminal.renderStateUpdate(term);

    const len = terminal.getScrollbackLength(term);
    try testing.expect(len >= 1);

    var cells: [4]terminal.GhosttyCell = undefined;
    const count = terminal.getScrollbackLine(term, 0, &cells, cells.len);
    try testing.expectEqual(@as(c_int, 4), count);
    try testing.expectEqual(@as(u32, 'A'), cells[0].codepoint);
}

test "regular: scrollback trims to configured limit" {
    const config = terminal.GhosttyTerminalConfig{
        .scrollback_limit = 3,
        .fg_color = 0,
        .bg_color = 0,
        .cursor_color = 0,
        .palette = .{0} ** 16,
    };
    const term = terminal.newWithConfig(4, 2, &config);
    defer terminal.free(term);

    const line = "X\r\n";
    for (0..12) |_| {
        terminal.write(term, line, line.len);
    }

    const len = terminal.getScrollbackLength(term);
    try testing.expectEqual(@as(c_int, 3), len);
}
