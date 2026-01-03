const terminal = @import("terminal.zig");
const key_event = @import("key_event.zig");
const key_encode = @import("key_encode.zig");

comptime {
    // Terminal lifecycle
    @export(&terminal.new, .{ .name = "ghostty_terminal_new" });
    @export(&terminal.newWithConfig, .{ .name = "ghostty_terminal_new_with_config" });
    @export(&terminal.free, .{ .name = "ghostty_terminal_free" });
    @export(&terminal.resize, .{ .name = "ghostty_terminal_resize" });
    @export(&terminal.setPixelSize, .{ .name = "ghostty_terminal_set_pixel_size" });
    @export(&terminal.write, .{ .name = "ghostty_terminal_write" });

    // Render state API
    @export(&terminal.renderStateUpdate, .{ .name = "ghostty_render_state_update" });
    @export(&terminal.renderStateGetCols, .{ .name = "ghostty_render_state_get_cols" });
    @export(&terminal.renderStateGetRows, .{ .name = "ghostty_render_state_get_rows" });
    @export(&terminal.renderStateGetCursorX, .{ .name = "ghostty_render_state_get_cursor_x" });
    @export(&terminal.renderStateGetCursorY, .{ .name = "ghostty_render_state_get_cursor_y" });
    @export(&terminal.renderStateGetCursorVisible, .{ .name = "ghostty_render_state_get_cursor_visible" });
    @export(&terminal.renderStateGetBgColor, .{ .name = "ghostty_render_state_get_bg_color" });
    @export(&terminal.renderStateGetFgColor, .{ .name = "ghostty_render_state_get_fg_color" });
    @export(&terminal.renderStateIsRowDirty, .{ .name = "ghostty_render_state_is_row_dirty" });
    @export(&terminal.renderStateMarkClean, .{ .name = "ghostty_render_state_mark_clean" });
    @export(&terminal.renderStateGetViewport, .{ .name = "ghostty_render_state_get_viewport" });
    @export(&terminal.renderStateGetGrapheme, .{ .name = "ghostty_render_state_get_grapheme" });

    // Terminal modes
    @export(&terminal.isAlternateScreen, .{ .name = "ghostty_terminal_is_alternate_screen" });
    @export(&terminal.hasMouseTracking, .{ .name = "ghostty_terminal_has_mouse_tracking" });
    @export(&terminal.getMode, .{ .name = "ghostty_terminal_get_mode" });
    @export(&terminal.getKittyKeyboardFlags, .{ .name = "ghostty_terminal_get_kitty_keyboard_flags" });

    // Scrollback
    @export(&terminal.getScrollbackLength, .{ .name = "ghostty_terminal_get_scrollback_length" });
    @export(&terminal.getScrollbackLine, .{ .name = "ghostty_terminal_get_scrollback_line" });
    @export(&terminal.getScrollbackGrapheme, .{ .name = "ghostty_terminal_get_scrollback_grapheme" });
    @export(&terminal.isRowWrapped, .{ .name = "ghostty_terminal_is_row_wrapped" });

    // Responses
    @export(&terminal.hasResponse, .{ .name = "ghostty_terminal_has_response" });
    @export(&terminal.readResponse, .{ .name = "ghostty_terminal_read_response" });

    // Kitty graphics
    @export(&terminal.getKittyImagesDirty, .{ .name = "ghostty_terminal_get_kitty_images_dirty" });
    @export(&terminal.clearKittyImagesDirty, .{ .name = "ghostty_terminal_clear_kitty_images_dirty" });
    @export(&terminal.getKittyImageCount, .{ .name = "ghostty_terminal_get_kitty_image_count" });
    @export(&terminal.getKittyImageIds, .{ .name = "ghostty_terminal_get_kitty_image_ids" });
    @export(&terminal.getKittyImageInfo, .{ .name = "ghostty_terminal_get_kitty_image_info" });
    @export(&terminal.copyKittyImageData, .{ .name = "ghostty_terminal_copy_kitty_image_data" });
    @export(&terminal.getKittyPlacementCount, .{ .name = "ghostty_terminal_get_kitty_placement_count" });
    @export(&terminal.getKittyPlacements, .{ .name = "ghostty_terminal_get_kitty_placements" });

    // Key event
    @export(&key_event.new, .{ .name = "ghostty_key_event_new" });
    @export(&key_event.free, .{ .name = "ghostty_key_event_free" });
    @export(&key_event.set_action, .{ .name = "ghostty_key_event_set_action" });
    @export(&key_event.get_action, .{ .name = "ghostty_key_event_get_action" });
    @export(&key_event.set_key, .{ .name = "ghostty_key_event_set_key" });
    @export(&key_event.get_key, .{ .name = "ghostty_key_event_get_key" });
    @export(&key_event.set_mods, .{ .name = "ghostty_key_event_set_mods" });
    @export(&key_event.get_mods, .{ .name = "ghostty_key_event_get_mods" });
    @export(&key_event.set_consumed_mods, .{ .name = "ghostty_key_event_set_consumed_mods" });
    @export(&key_event.get_consumed_mods, .{ .name = "ghostty_key_event_get_consumed_mods" });
    @export(&key_event.set_composing, .{ .name = "ghostty_key_event_set_composing" });
    @export(&key_event.get_composing, .{ .name = "ghostty_key_event_get_composing" });
    @export(&key_event.set_utf8, .{ .name = "ghostty_key_event_set_utf8" });
    @export(&key_event.get_utf8, .{ .name = "ghostty_key_event_get_utf8" });
    @export(&key_event.set_unshifted_codepoint, .{ .name = "ghostty_key_event_set_unshifted_codepoint" });
    @export(&key_event.get_unshifted_codepoint, .{ .name = "ghostty_key_event_get_unshifted_codepoint" });

    // Key encoding
    @export(&key_encode.new, .{ .name = "ghostty_key_encoder_new" });
    @export(&key_encode.free, .{ .name = "ghostty_key_encoder_free" });
    @export(&key_encode.setopt, .{ .name = "ghostty_key_encoder_setopt" });
    @export(&key_encode.encode, .{ .name = "ghostty_key_encoder_encode" });
}

test {
    _ = @import("tests.zig");
}
