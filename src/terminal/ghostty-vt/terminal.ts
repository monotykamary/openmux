/**
 * Native libghostty-vt terminal wrapper.
 */

import { ghostty } from "./ffi";
import type { Pointer } from "bun:ffi";
import type {
  DirtyState,
  GhosttyCell,
  GhosttyTerminalConfig,
  GhosttyKittyImageInfo,
  GhosttyKittyPlacement,
} from "./types";

const CELL_SIZE = 16;
const CONFIG_SIZE = 4 * 4 + 16 * 4;
const KITTY_IMAGE_INFO_SIZE = 32;
const KITTY_PLACEMENT_SIZE = 56;

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export class GhosttyVtTerminal {
  private handle: Pointer;
  private _cols: number;
  private _rows: number;
  private viewportBuffer: Buffer | null = null;
  private cellPool: GhosttyCell[] = [];
  private lineBuffer: Buffer | null = null;
  private encoder = new TextEncoder();

  constructor(cols: number, rows: number, config?: GhosttyTerminalConfig) {
    this._cols = cols;
    this._rows = rows;

    if (config) {
      const configBuffer = Buffer.alloc(CONFIG_SIZE);
      const view = new DataView(configBuffer.buffer, configBuffer.byteOffset, configBuffer.byteLength);
      let offset = 0;

      view.setUint32(offset, config.scrollbackLimit ?? 10000, true);
      offset += 4;
      view.setUint32(offset, config.fgColor ?? 0, true);
      offset += 4;
      view.setUint32(offset, config.bgColor ?? 0, true);
      offset += 4;
      view.setUint32(offset, config.cursorColor ?? 0, true);
      offset += 4;

      for (let i = 0; i < 16; i++) {
        const color = config.palette?.[i] ?? 0;
        view.setUint32(offset, color, true);
        offset += 4;
      }

      const handle = ghostty.symbols.ghostty_terminal_new_with_config(cols, rows, configBuffer);
      if (!handle) {
        throw new Error("Failed to create ghostty-vt terminal");
      }
      this.handle = handle;
    } else {
      const handle = ghostty.symbols.ghostty_terminal_new(cols, rows);
      if (!handle) {
        throw new Error("Failed to create ghostty-vt terminal");
      }
      this.handle = handle;
    }

    this.initCellPool();
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  write(data: string | Uint8Array): void {
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    if (bytes.length === 0) return;
    const buffer = toBuffer(bytes);
    ghostty.symbols.ghostty_terminal_write(this.handle, buffer, buffer.byteLength);
  }

  resize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    ghostty.symbols.ghostty_terminal_resize(this.handle, cols, rows);
    this.viewportBuffer = null;
    this.lineBuffer = null;
    this.initCellPool();
  }

  setPixelSize(widthPx: number, heightPx: number): void {
    if (widthPx <= 0 || heightPx <= 0) return;
    ghostty.symbols.ghostty_terminal_set_pixel_size(this.handle, widthPx, heightPx);
  }

  free(): void {
    ghostty.symbols.ghostty_terminal_free(this.handle);
  }

  // ==========================================================================
  // Render state
  // ==========================================================================

  update(): DirtyState {
    return ghostty.symbols.ghostty_render_state_update(this.handle) as DirtyState;
  }

  getCursor(): { x: number; y: number; visible: boolean } {
    return {
      x: ghostty.symbols.ghostty_render_state_get_cursor_x(this.handle),
      y: ghostty.symbols.ghostty_render_state_get_cursor_y(this.handle),
      visible: ghostty.symbols.ghostty_render_state_get_cursor_visible(this.handle),
    };
  }

  getColors(): { foreground: number; background: number } {
    return {
      foreground: ghostty.symbols.ghostty_render_state_get_fg_color(this.handle),
      background: ghostty.symbols.ghostty_render_state_get_bg_color(this.handle),
    };
  }

  isRowDirty(y: number): boolean {
    return ghostty.symbols.ghostty_render_state_is_row_dirty(this.handle, y);
  }

  markClean(): void {
    ghostty.symbols.ghostty_render_state_mark_clean(this.handle);
  }

  getViewport(): GhosttyCell[] {
    const totalCells = this._cols * this._rows;
    const neededSize = totalCells * CELL_SIZE;

    if (!this.viewportBuffer || this.viewportBuffer.byteLength < neededSize) {
      this.viewportBuffer = Buffer.alloc(neededSize);
    }

    const count = ghostty.symbols.ghostty_render_state_get_viewport(
      this.handle,
      this.viewportBuffer,
      totalCells
    );

    if (count < 0) return this.cellPool;

    this.parseCellsIntoPool(this.viewportBuffer, count);
    return this.cellPool;
  }

  // ==========================================================================
  // Modes and state
  // ==========================================================================

  isAlternateScreen(): boolean {
    return ghostty.symbols.ghostty_terminal_is_alternate_screen(this.handle);
  }

  hasMouseTracking(): boolean {
    return ghostty.symbols.ghostty_terminal_has_mouse_tracking(this.handle);
  }

  getMode(mode: number, isAnsi: boolean): boolean {
    return ghostty.symbols.ghostty_terminal_get_mode(this.handle, mode, isAnsi);
  }

  getScrollbackLength(): number {
    return ghostty.symbols.ghostty_terminal_get_scrollback_length(this.handle);
  }

  getScrollbackLine(offset: number): GhosttyCell[] | null {
    const neededSize = this._cols * CELL_SIZE;
    if (!this.lineBuffer || this.lineBuffer.byteLength < neededSize) {
      this.lineBuffer = Buffer.alloc(neededSize);
    }

    const count = ghostty.symbols.ghostty_terminal_get_scrollback_line(
      this.handle,
      offset,
      this.lineBuffer,
      this._cols
    );

    if (count < 0) return null;
    return this.parseCells(this.lineBuffer, count);
  }

  isRowWrapped(row: number): boolean {
    return ghostty.symbols.ghostty_terminal_is_row_wrapped(this.handle, row);
  }

  hasResponse(): boolean {
    return ghostty.symbols.ghostty_terminal_has_response(this.handle);
  }

  getKittyKeyboardFlags(): number {
    return ghostty.symbols.ghostty_terminal_get_kitty_keyboard_flags(this.handle);
  }

  readResponse(): string | null {
    if (!this.hasResponse()) return null;
    const buffer = Buffer.alloc(256);
    const count = ghostty.symbols.ghostty_terminal_read_response(this.handle, buffer, buffer.byteLength);
    if (count <= 0) return null;
    return buffer.subarray(0, count).toString("utf8");
  }

  // ==========================================================================
  // Kitty graphics
  // ==========================================================================

  getKittyImagesDirty(): boolean {
    return ghostty.symbols.ghostty_terminal_get_kitty_images_dirty(this.handle);
  }

  clearKittyImagesDirty(): void {
    ghostty.symbols.ghostty_terminal_clear_kitty_images_dirty(this.handle);
  }

  getKittyImageIds(): number[] {
    const count = ghostty.symbols.ghostty_terminal_get_kitty_image_count(this.handle);
    if (count <= 0) return [];

    const buffer = Buffer.alloc(count * 4);
    const written = ghostty.symbols.ghostty_terminal_get_kitty_image_ids(this.handle, buffer, count);
    if (written <= 0) return [];

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const ids: number[] = [];
    const total = Math.min(written, count);
    for (let i = 0; i < total; i++) {
      ids.push(view.getUint32(i * 4, true));
    }
    return ids;
  }

  getKittyImageInfo(imageId: number): GhosttyKittyImageInfo | null {
    const buffer = Buffer.alloc(KITTY_IMAGE_INFO_SIZE);
    const ok = ghostty.symbols.ghostty_terminal_get_kitty_image_info(this.handle, imageId, buffer);
    if (!ok) return null;

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return {
      id: view.getUint32(0, true),
      number: view.getUint32(4, true),
      width: view.getUint32(8, true),
      height: view.getUint32(12, true),
      data_len: view.getUint32(16, true),
      format: view.getUint8(20),
      compression: view.getUint8(21),
      implicit_id: view.getUint8(22),
      transmit_time: view.getBigUint64(24, true),
    };
  }

  getKittyImageData(imageId: number): Uint8Array | null {
    const info = this.getKittyImageInfo(imageId);
    if (!info || info.data_len === 0) return null;

    const buffer = Buffer.alloc(info.data_len);
    const written = ghostty.symbols.ghostty_terminal_copy_kitty_image_data(
      this.handle,
      imageId,
      buffer,
      buffer.byteLength
    );
    if (written <= 0) return null;
    return buffer.subarray(0, written);
  }

  getKittyPlacements(): GhosttyKittyPlacement[] {
    const count = ghostty.symbols.ghostty_terminal_get_kitty_placement_count(this.handle);
    if (count <= 0) return [];

    const buffer = Buffer.alloc(count * KITTY_PLACEMENT_SIZE);
    const written = ghostty.symbols.ghostty_terminal_get_kitty_placements(this.handle, buffer, count);
    if (written <= 0) return [];

    const placements: GhosttyKittyPlacement[] = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const total = Math.min(written, count);
    for (let i = 0; i < total; i++) {
      const offset = i * KITTY_PLACEMENT_SIZE;
      placements.push({
        image_id: view.getUint32(offset, true),
        placement_id: view.getUint32(offset + 4, true),
        placement_tag: view.getUint8(offset + 8),
        screen_x: view.getUint32(offset + 12, true),
        screen_y: view.getUint32(offset + 16, true),
        x_offset: view.getUint32(offset + 20, true),
        y_offset: view.getUint32(offset + 24, true),
        source_x: view.getUint32(offset + 28, true),
        source_y: view.getUint32(offset + 32, true),
        source_width: view.getUint32(offset + 36, true),
        source_height: view.getUint32(offset + 40, true),
        columns: view.getUint32(offset + 44, true),
        rows: view.getUint32(offset + 48, true),
        z: view.getInt32(offset + 52, true),
      });
    }
    return placements;
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  private initCellPool(): void {
    const totalCells = this._cols * this._rows;
    this.cellPool = [];
    for (let i = 0; i < totalCells; i++) {
      this.cellPool.push({
        codepoint: 0,
        fg_r: 0,
        fg_g: 0,
        fg_b: 0,
        bg_r: 0,
        bg_g: 0,
        bg_b: 0,
        flags: 0,
        width: 1,
        hyperlink_id: 0,
        grapheme_len: 0,
      });
    }
  }

  private parseCellsIntoPool(buffer: Buffer, count: number): void {
    const view = new DataView(buffer.buffer, buffer.byteOffset, count * CELL_SIZE);
    for (let i = 0; i < count; i++) {
      const offset = i * CELL_SIZE;
      const cell = this.cellPool[i];
      cell.codepoint = view.getUint32(offset, true);
      cell.fg_r = buffer[offset + 4];
      cell.fg_g = buffer[offset + 5];
      cell.fg_b = buffer[offset + 6];
      cell.bg_r = buffer[offset + 7];
      cell.bg_g = buffer[offset + 8];
      cell.bg_b = buffer[offset + 9];
      cell.flags = buffer[offset + 10];
      cell.width = buffer[offset + 11];
      cell.hyperlink_id = view.getUint16(offset + 12, true);
      cell.grapheme_len = buffer[offset + 14];
    }
  }

  private parseCells(buffer: Buffer, count: number): GhosttyCell[] {
    const view = new DataView(buffer.buffer, buffer.byteOffset, count * CELL_SIZE);
    const cells: GhosttyCell[] = [];
    for (let i = 0; i < count; i++) {
      const offset = i * CELL_SIZE;
      cells.push({
        codepoint: view.getUint32(offset, true),
        fg_r: buffer[offset + 4],
        fg_g: buffer[offset + 5],
        fg_b: buffer[offset + 6],
        bg_r: buffer[offset + 7],
        bg_g: buffer[offset + 8],
        bg_b: buffer[offset + 9],
        flags: buffer[offset + 10],
        width: buffer[offset + 11],
        hyperlink_id: view.getUint16(offset + 12, true),
        grapheme_len: buffer[offset + 14],
      });
    }
    return cells;
  }
}
