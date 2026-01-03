const std = @import("std");
const ghostty = @import("ghostty");
const response_handler = @import("response_handler.zig");

const Allocator = std.mem.Allocator;
const Terminal = ghostty.Terminal;
const RenderState = ghostty.RenderState;

pub const ResponseHandler = response_handler.ResponseHandler;
pub const ResponseStream = response_handler.ResponseStream;

/// Wrapper struct that owns the Terminal, stream, and RenderState.
pub const TerminalWrapper = struct {
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
