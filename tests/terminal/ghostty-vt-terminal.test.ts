/**
 * Tests for GhosttyVtTerminal with mocked FFI bindings.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const mockGhostty: { symbols: Record<string, any> } = { symbols: {} };

vi.mock("../../src/terminal/ghostty-vt/ffi", () => ({
  ghostty: mockGhostty,
}));

let GhosttyVtTerminal: typeof import("../../src/terminal/ghostty-vt/terminal").GhosttyVtTerminal;

beforeAll(async () => {
  ({ GhosttyVtTerminal } = await import("../../src/terminal/ghostty-vt/terminal"));
});

beforeEach(() => {
  mockGhostty.symbols = {};
});

const CELL_SIZE = 16;

type CellInput = {
  codepoint: number;
  fg: [number, number, number];
  bg: [number, number, number];
  flags?: number;
  width?: number;
  hyperlinkId?: number;
  graphemeLen?: number;
};

function writeCell(buffer: Buffer, index: number, cell: CellInput): void {
  const offset = index * CELL_SIZE;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, cell.codepoint, true);
  buffer[offset + 4] = cell.fg[0];
  buffer[offset + 5] = cell.fg[1];
  buffer[offset + 6] = cell.fg[2];
  buffer[offset + 7] = cell.bg[0];
  buffer[offset + 8] = cell.bg[1];
  buffer[offset + 9] = cell.bg[2];
  buffer[offset + 10] = cell.flags ?? 0;
  buffer[offset + 11] = cell.width ?? 1;
  view.setUint16(offset + 12, cell.hyperlinkId ?? 0, true);
  buffer[offset + 14] = cell.graphemeLen ?? 0;
  buffer[offset + 15] = 0;
}

describe("GhosttyVtTerminal", () => {
  it("passes config to native constructor", () => {
    let capturedConfig: Buffer | null = null;

    const ghosttyTerminalNew = vi.fn(() => 1);
    const ghosttyTerminalNewWithConfig = vi.fn((_cols: number, _rows: number, config: Buffer) => {
      capturedConfig = Buffer.from(config);
      return 1;
    });

    mockGhostty.symbols = {
      ghostty_terminal_new: ghosttyTerminalNew,
      ghostty_terminal_new_with_config: ghosttyTerminalNewWithConfig,
      ghostty_terminal_free: vi.fn(),
    };

    const palette = Array.from({ length: 16 }, (_, i) => 0x100000 + i);
    const term = new GhosttyVtTerminal(80, 24, {
      scrollbackLimit: 1234,
      fgColor: 0x112233,
      bgColor: 0x445566,
      cursorColor: 0x778899,
      palette,
    });

    term.free();

    expect(ghosttyTerminalNew).not.toHaveBeenCalled();
    expect(ghosttyTerminalNewWithConfig).toHaveBeenCalledTimes(1);
    expect(capturedConfig).not.toBeNull();

    const view = new DataView(
      capturedConfig!.buffer,
      capturedConfig!.byteOffset,
      capturedConfig!.byteLength
    );
    expect(view.getUint32(0, true)).toBe(1234);
    expect(view.getUint32(4, true)).toBe(0x112233);
    expect(view.getUint32(8, true)).toBe(0x445566);
    expect(view.getUint32(12, true)).toBe(0x778899);

    const paletteOffset = 16;
    for (let i = 0; i < 16; i++) {
      expect(view.getUint32(paletteOffset + i * 4, true)).toBe(palette[i]);
    }
  });

  it("parses viewport cells into the pool", () => {
    const viewportData = Buffer.alloc(CELL_SIZE * 2);
    writeCell(viewportData, 0, {
      codepoint: 0x41,
      fg: [1, 2, 3],
      bg: [4, 5, 6],
      flags: 5,
      width: 1,
      hyperlinkId: 9,
    });
    writeCell(viewportData, 1, {
      codepoint: 0x42,
      fg: [7, 8, 9],
      bg: [10, 11, 12],
      flags: 0x80,
      width: 2,
      hyperlinkId: 257,
      graphemeLen: 1,
    });

    const viewportMock = vi.fn((_handle: number, outBuffer: Buffer, totalCells: number) => {
      expect(totalCells).toBe(2);
      viewportData.copy(outBuffer);
      return 2;
    });

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_render_state_get_viewport: viewportMock,
    };

    const term = new GhosttyVtTerminal(2, 1);

    const first = term.getViewport();
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      codepoint: 0x41,
      fg_r: 1,
      fg_g: 2,
      fg_b: 3,
      bg_r: 4,
      bg_g: 5,
      bg_b: 6,
      flags: 5,
      width: 1,
      hyperlink_id: 9,
      grapheme_len: 0,
    });
    expect(first[1].codepoint).toBe(0x42);
    expect(first[1].width).toBe(2);
    expect(first[1].hyperlink_id).toBe(257);
    expect(first[1].grapheme_len).toBe(1);

    const firstCell = first[0];
    const second = term.getViewport();
    expect(second[0]).toBe(firstCell);

    term.free();
  });

  it("parses scrollback lines into new arrays", () => {
    const lineData = Buffer.alloc(CELL_SIZE * 2);
    writeCell(lineData, 0, {
      codepoint: 0x43,
      fg: [11, 12, 13],
      bg: [14, 15, 16],
      flags: 1,
      width: 1,
      hyperlinkId: 0,
    });
    writeCell(lineData, 1, {
      codepoint: 0x44,
      fg: [21, 22, 23],
      bg: [24, 25, 26],
      flags: 2,
      width: 1,
      hyperlinkId: 3,
    });

    const scrollbackMock = vi.fn((_handle: number, _offset: number, outBuffer: Buffer, cols: number) => {
      expect(cols).toBe(2);
      lineData.copy(outBuffer);
      return 2;
    });

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_get_scrollback_line: scrollbackMock,
    };

    const term = new GhosttyVtTerminal(2, 1);
    const line = term.getScrollbackLine(0);
    expect(line).not.toBeNull();
    expect(line![0].codepoint).toBe(0x43);
    expect(line![1].fg_r).toBe(21);
    expect(line![1].bg_b).toBe(26);

    term.free();
  });

  it("reads terminal responses when available", () => {
    const readMock = vi.fn((_handle: number, buffer: Buffer, _size: number) => {
      buffer.write("OK");
      return 2;
    });

    const hasResponseMock = vi.fn(() => true);

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_has_response: hasResponseMock,
      ghostty_terminal_read_response: readMock,
    };

    const term = new GhosttyVtTerminal(80, 24);
    expect(term.readResponse()).toBe("OK");

    mockGhostty.symbols.ghostty_terminal_has_response = vi.fn(() => false);
    expect(term.readResponse()).toBeNull();

    term.free();
  });
});
