const ghostty = @import("ghostty");
const state = @import("state.zig");

const modespkg = ghostty.modes;
const TerminalWrapper = state.TerminalWrapper;

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
