const std = @import("std");
const terminal = @import("terminal.zig");

const testing = std.testing;

test "litmus: kitty graphics plumbing is available" {
    const term = terminal.new(1, 1);
    defer terminal.free(term);

    try testing.expectEqual(@as(c_int, 0), terminal.getKittyImageCount(term));
    try testing.expect(!terminal.getKittyImagesDirty(term));
}

test "litmus: kitty query accepts non-direct medium" {
    const term = terminal.new(2, 2);
    defer terminal.free(term);

    const query = "\x1b_Ga=q,t=f,i=1;\x1b\\";
    terminal.write(term, query, query.len);

    try testing.expect(terminal.hasResponse(term));

    var buf: [64]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expectEqualStrings("\x1b_Gi=1;OK\x1b\\", buf[0..@intCast(written)]);
}

test "litmus: kitty passthrough accepts empty payloads" {
    const term = terminal.new(4, 4);
    defer terminal.free(term);

    const sequence = "\x1b_Ga=T,f=100,s=2,v=3,i=7;\x1b\\";
    terminal.write(term, sequence, sequence.len);

    try testing.expectEqual(@as(c_int, 1), terminal.getKittyImageCount(term));
    try testing.expectEqual(@as(c_int, 1), terminal.getKittyPlacementCount(term));

    var info: terminal.GhosttyKittyImageInfo = undefined;
    try testing.expect(terminal.getKittyImageInfo(term, 7, &info));
    try testing.expectEqual(@as(u32, 2), info.width);
    try testing.expectEqual(@as(u32, 3), info.height);
    try testing.expectEqual(@as(u32, 0), info.data_len);

    try testing.expect(terminal.hasResponse(term));
    var buf: [64]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expectEqualStrings("\x1b_Gi=7;OK\x1b\\", buf[0..@intCast(written)]);
}

test "smoke: device status response buffer" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    terminal.write(term, "\x1b[6n", 4);
    try testing.expect(terminal.hasResponse(term));

    var buf: [32]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expect(written > 0);
    try testing.expectEqualStrings("\x1b[1;1R", buf[0..@intCast(written)]);
}

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

test "terminal lifecycle" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);
    try testing.expect(term != null);

    _ = terminal.renderStateUpdate(term);
    try testing.expectEqual(@as(c_int, 80), terminal.renderStateGetCols(term));
    try testing.expectEqual(@as(c_int, 24), terminal.renderStateGetRows(term));
}

test "terminal write and read via render state" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    terminal.write(term, "Hello", 5);
    _ = terminal.renderStateUpdate(term);

    var cells: [80 * 24]terminal.GhosttyCell = undefined;
    const count = terminal.renderStateGetViewport(term, &cells, 80 * 24);
    try testing.expectEqual(@as(c_int, 80 * 24), count);
    try testing.expectEqual(@as(u32, 'H'), cells[0].codepoint);
    try testing.expectEqual(@as(u32, 'e'), cells[1].codepoint);
    try testing.expectEqual(@as(u32, 'l'), cells[2].codepoint);
    try testing.expectEqual(@as(u32, 'l'), cells[3].codepoint);
    try testing.expectEqual(@as(u32, 'o'), cells[4].codepoint);
}
