/**
 * @file terminal.h
 *
 * Minimal, high-performance terminal emulator API for WASM.
 *
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call, avoiding multiple
 * WASM boundary crossings.
 *
 * Basic usage:
 *   1. Create terminal: ghostty_terminal_new(80, 24)
 *   2. Write data: ghostty_terminal_write(term, data, len)
 *   3. Each frame:
 *      - ghostty_render_state_update(term)
 *      - ghostty_render_state_get_viewport(term, buffer, size)
 *      - Render the buffer
 *      - ghostty_render_state_mark_clean(term)
 *   4. Free: ghostty_terminal_free(term)
 */

#ifndef GHOSTTY_VT_TERMINAL_H
#define GHOSTTY_VT_TERMINAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Opaque terminal handle */
typedef void* GhosttyTerminal;

/**
 * Terminal configuration.
 * All color values use 0xRRGGBB format. A value of 0 means "use default".
 */
typedef struct {
    /** Maximum scrollback lines (0 = unlimited) */
    uint32_t scrollback_limit;
    /** Default foreground color (0xRRGGBB, 0 = default) */
    uint32_t fg_color;
    /** Default background color (0xRRGGBB, 0 = default) */
    uint32_t bg_color;
    /** Cursor color (0xRRGGBB, 0 = default) */
    uint32_t cursor_color;
    /** ANSI color palette (16 colors, 0xRRGGBB format, 0 = default) */
    uint32_t palette[16];
} GhosttyTerminalConfig;

/** Kitty graphics image metadata */
typedef struct {
    uint32_t id;
    uint32_t number;
    uint32_t width;
    uint32_t height;
    uint32_t data_len;
    uint8_t format;
    uint8_t compression;
    uint8_t implicit_id;
    uint8_t _pad;
    uint64_t transmit_time;
} GhosttyKittyImageInfo;

/** Kitty graphics placement metadata (pin placements only) */
typedef struct {
    uint32_t image_id;
    uint32_t placement_id;
    uint8_t placement_tag;
    uint8_t _pad[3];
    uint32_t screen_x;
    uint32_t screen_y;
    uint32_t x_offset;
    uint32_t y_offset;
    uint32_t source_x;
    uint32_t source_y;
    uint32_t source_width;
    uint32_t source_height;
    uint32_t columns;
    uint32_t rows;
    int32_t z;
} GhosttyKittyPlacement;

/** Cell structure - 16 bytes, pre-resolved colors */
typedef struct {
    uint32_t codepoint;
    uint8_t fg_r, fg_g, fg_b;
    uint8_t bg_r, bg_g, bg_b;
    uint8_t flags;
    uint8_t width;
    uint16_t hyperlink_id;
    uint8_t grapheme_len;  /* Number of extra codepoints beyond first (0 = no grapheme) */
    uint8_t _pad;
} GhosttyCell;

/** Cell flags */
#define GHOSTTY_CELL_BOLD          (1 << 0)
#define GHOSTTY_CELL_ITALIC        (1 << 1)
#define GHOSTTY_CELL_UNDERLINE     (1 << 2)
#define GHOSTTY_CELL_STRIKETHROUGH (1 << 3)
#define GHOSTTY_CELL_INVERSE       (1 << 4)
#define GHOSTTY_CELL_INVISIBLE     (1 << 5)
#define GHOSTTY_CELL_BLINK         (1 << 6)
#define GHOSTTY_CELL_FAINT         (1 << 7)

/** Dirty state */
typedef enum {
    GHOSTTY_DIRTY_NONE = 0,
    GHOSTTY_DIRTY_PARTIAL = 1,
    GHOSTTY_DIRTY_FULL = 2
} GhosttyDirty;

/* ============================================================================
 * Lifecycle
 * ========================================================================= */

/** Create a new terminal with default settings */
GhosttyTerminal ghostty_terminal_new(int cols, int rows);

/**
 * Create a new terminal with custom configuration.
 * @param cols Number of columns
 * @param rows Number of rows
 * @param config Configuration options (NULL = use defaults)
 * @return Terminal handle, or NULL on failure
 */
GhosttyTerminal ghostty_terminal_new_with_config(
    int cols,
    int rows,
    const GhosttyTerminalConfig* config
);

/** Free a terminal */
void ghostty_terminal_free(GhosttyTerminal term);

/** Resize terminal */
void ghostty_terminal_resize(GhosttyTerminal term, int cols, int rows);

/** Set terminal pixel dimensions (used for kitty graphics sizing) */
void ghostty_terminal_set_pixel_size(GhosttyTerminal term, int width_px, int height_px);

/** Write data to terminal (parses VT sequences) */
void ghostty_terminal_write(GhosttyTerminal term, const uint8_t* data, size_t len);

/* ============================================================================
 * RenderState API - High-performance rendering
 * ========================================================================= */

/** Update render state from terminal. Call once per frame. */
GhosttyDirty ghostty_render_state_update(GhosttyTerminal term);

/** Get dimensions */
int ghostty_render_state_get_cols(GhosttyTerminal term);
int ghostty_render_state_get_rows(GhosttyTerminal term);

/** Get cursor state (individual getters for WASM efficiency) */
int ghostty_render_state_get_cursor_x(GhosttyTerminal term);
int ghostty_render_state_get_cursor_y(GhosttyTerminal term);
bool ghostty_render_state_get_cursor_visible(GhosttyTerminal term);

/** Get default colors as 0xRRGGBB */
uint32_t ghostty_render_state_get_bg_color(GhosttyTerminal term);
uint32_t ghostty_render_state_get_fg_color(GhosttyTerminal term);

/** Check if a row is dirty */
bool ghostty_render_state_is_row_dirty(GhosttyTerminal term, int y);

/** Mark render state as clean (call after rendering) */
void ghostty_render_state_mark_clean(GhosttyTerminal term);

/**
 * Get ALL viewport cells in one call - the key performance optimization!
 * Buffer must be at least (rows * cols) cells.
 * Returns total cells written, or -1 on error.
 */
int ghostty_render_state_get_viewport(
    GhosttyTerminal term,
    GhosttyCell* out_buffer,
    size_t buffer_size
);

/**
 * Get grapheme codepoints for a cell at (row, col).
 * For cells with grapheme_len > 0, this returns all codepoints that make up
 * the grapheme cluster. The buffer receives u32 codepoints.
 * @param row Row index (0-based)
 * @param col Column index (0-based)
 * @param out_buffer Buffer to receive codepoints
 * @param buffer_size Size of buffer in u32 elements
 * @return Number of codepoints written (including the first), or -1 on error
 */
int ghostty_render_state_get_grapheme(
    GhosttyTerminal term,
    int row,
    int col,
    uint32_t* out_buffer,
    size_t buffer_size
);

/* ============================================================================
 * Terminal Modes
 * ========================================================================= */

/** Check if alternate screen is active */
bool ghostty_terminal_is_alternate_screen(GhosttyTerminal term);

/** Check if any mouse tracking mode is enabled */
bool ghostty_terminal_has_mouse_tracking(GhosttyTerminal term);

/**
 * Query arbitrary terminal mode by number.
 * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
 * @param is_ansi true for ANSI modes, false for DEC modes
 * @return true if mode is enabled
 */
bool ghostty_terminal_get_mode(GhosttyTerminal term, int mode, bool is_ansi);

/** Get current Kitty keyboard protocol flags (bitmask) */
uint8_t ghostty_terminal_get_kitty_keyboard_flags(GhosttyTerminal term);

/* ============================================================================
 * Scrollback API
 * ========================================================================= */

/** Get number of scrollback lines (history, not including active screen) */
int ghostty_terminal_get_scrollback_length(GhosttyTerminal term);

/**
 * Get a line from the scrollback buffer.
 * @param offset 0 = oldest line, (length-1) = most recent scrollback line
 * @param out_buffer Buffer to write cells to
 * @param buffer_size Size of buffer in cells (must be >= cols)
 * @return Number of cells written, or -1 on error
 */
int ghostty_terminal_get_scrollback_line(
    GhosttyTerminal term,
    int offset,
    GhosttyCell* out_buffer,
    size_t buffer_size
);

/**
 * Get grapheme codepoints for a cell in the scrollback buffer.
 * @param offset Scrollback line offset (0 = oldest)
 * @param col Column index (0-based)
 * @param out_buffer Buffer to receive codepoints
 * @param buffer_size Size of buffer in u32 elements
 * @return Number of codepoints written, or -1 on error
 */
int ghostty_terminal_get_scrollback_grapheme(
    GhosttyTerminal term,
    int offset,
    int col,
    uint32_t* out_buffer,
    size_t buffer_size
);

/** Check if a row is a continuation from previous row (soft-wrapped) */
bool ghostty_terminal_is_row_wrapped(GhosttyTerminal term, int y);

/* ============================================================================
 * Response API - for DSR and other terminal queries
 * ========================================================================= */

/**
 * Check if there are pending responses from the terminal.
 * Responses are generated by escape sequences like DSR (Device Status Report).
 */
bool ghostty_terminal_has_response(GhosttyTerminal term);

/**
 * Read pending responses from the terminal.
 * @param out_buffer Buffer to write response bytes to
 * @param buffer_size Size of buffer in bytes
 * @return Number of bytes written, 0 if no responses pending, -1 on error
 */
int ghostty_terminal_read_response(
    GhosttyTerminal term,
    uint8_t* out_buffer,
    size_t buffer_size
);

/* ========================================================================
 * Kitty Graphics API
 * ====================================================================== */

/** Check if kitty images/placements are dirty */
bool ghostty_terminal_get_kitty_images_dirty(GhosttyTerminal term);

/** Clear kitty images dirty flag */
void ghostty_terminal_clear_kitty_images_dirty(GhosttyTerminal term);

/** Get number of kitty images */
int ghostty_terminal_get_kitty_image_count(GhosttyTerminal term);

/**
 * Get kitty image IDs.
 * @param out_buffer Buffer to receive image IDs
 * @param buffer_size Size of buffer in u32 entries
 * @return Number of IDs written, or -1 on error
 */
int ghostty_terminal_get_kitty_image_ids(
    GhosttyTerminal term,
    uint32_t* out_buffer,
    size_t buffer_size
);

/**
 * Get kitty image metadata.
 * @return true if image exists
 */
bool ghostty_terminal_get_kitty_image_info(
    GhosttyTerminal term,
    uint32_t image_id,
    GhosttyKittyImageInfo* out_info
);

/**
 * Copy kitty image data into buffer.
 * @return Number of bytes written, or -1 on error
 */
int ghostty_terminal_copy_kitty_image_data(
    GhosttyTerminal term,
    uint32_t image_id,
    uint8_t* out_buffer,
    size_t buffer_size
);

/** Get number of kitty placements (pin placements only) */
int ghostty_terminal_get_kitty_placement_count(GhosttyTerminal term);

/**
 * Get kitty placements.
 * @param out_buffer Buffer to receive placements
 * @param buffer_size Size of buffer in GhosttyKittyPlacement entries
 * @return Number of placements written, or -1 on error
 */
int ghostty_terminal_get_kitty_placements(
    GhosttyTerminal term,
    GhosttyKittyPlacement* out_buffer,
    size_t buffer_size
);

#ifdef __cplusplus
}
#endif

#endif /* GHOSTTY_VT_TERMINAL_H */
