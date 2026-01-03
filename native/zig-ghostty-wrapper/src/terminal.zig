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

const types = @import("terminal/types.zig");
const lifecycle = @import("terminal/lifecycle.zig");
const render_state = @import("terminal/render_state.zig");
const modes = @import("terminal/modes.zig");
const scrollback = @import("terminal/scrollback.zig");
const response = @import("terminal/response.zig");
const kitty_graphics = @import("terminal/kitty_graphics.zig");

pub const GhosttyCell = types.GhosttyCell;
pub const GhosttyDirty = types.GhosttyDirty;
pub const GhosttyTerminalConfig = types.GhosttyTerminalConfig;
pub const GhosttyKittyImageInfo = types.GhosttyKittyImageInfo;
pub const GhosttyKittyPlacement = types.GhosttyKittyPlacement;

pub const new = lifecycle.new;
pub const newWithConfig = lifecycle.newWithConfig;
pub const free = lifecycle.free;
pub const resize = lifecycle.resize;
pub const setPixelSize = lifecycle.setPixelSize;
pub const write = lifecycle.write;

pub const renderStateUpdate = render_state.renderStateUpdate;
pub const renderStateGetCols = render_state.renderStateGetCols;
pub const renderStateGetRows = render_state.renderStateGetRows;
pub const renderStateGetCursorX = render_state.renderStateGetCursorX;
pub const renderStateGetCursorY = render_state.renderStateGetCursorY;
pub const renderStateGetCursorVisible = render_state.renderStateGetCursorVisible;
pub const renderStateGetBgColor = render_state.renderStateGetBgColor;
pub const renderStateGetFgColor = render_state.renderStateGetFgColor;
pub const renderStateIsRowDirty = render_state.renderStateIsRowDirty;
pub const renderStateMarkClean = render_state.renderStateMarkClean;
pub const renderStateGetViewport = render_state.renderStateGetViewport;
pub const renderStateGetGrapheme = render_state.renderStateGetGrapheme;

pub const isAlternateScreen = modes.isAlternateScreen;
pub const hasMouseTracking = modes.hasMouseTracking;
pub const getMode = modes.getMode;
pub const getKittyKeyboardFlags = modes.getKittyKeyboardFlags;

pub const getScrollbackLength = scrollback.getScrollbackLength;
pub const getScrollbackLine = scrollback.getScrollbackLine;
pub const getScrollbackGrapheme = scrollback.getScrollbackGrapheme;
pub const isRowWrapped = scrollback.isRowWrapped;

pub const hasResponse = response.hasResponse;
pub const readResponse = response.readResponse;

pub const getKittyImagesDirty = kitty_graphics.getKittyImagesDirty;
pub const clearKittyImagesDirty = kitty_graphics.clearKittyImagesDirty;
pub const getKittyImageCount = kitty_graphics.getKittyImageCount;
pub const getKittyImageIds = kitty_graphics.getKittyImageIds;
pub const getKittyImageInfo = kitty_graphics.getKittyImageInfo;
pub const copyKittyImageData = kitty_graphics.copyKittyImageData;
pub const getKittyPlacementCount = kitty_graphics.getKittyPlacementCount;
pub const getKittyPlacements = kitty_graphics.getKittyPlacements;
