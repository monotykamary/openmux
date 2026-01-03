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
    grapheme_len: u8 = 0,
    _pad: u8 = 0,
};

pub const GhosttyDirty = enum(u8) {
    none = 0,
    partial = 1,
    full = 2,
};

pub const GhosttyTerminalConfig = extern struct {
    scrollback_limit: u32,
    fg_color: u32,
    bg_color: u32,
    cursor_color: u32,
    palette: [16]u32,
};

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
