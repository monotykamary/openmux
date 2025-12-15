/**
 * Tests for ghostty-emulator utility functions
 * These tests capture the behavior of functions that will be extracted during refactoring
 */
import { describe, test, expect, beforeAll } from 'vitest'

// We'll test the exported utility functions after extraction
// For now, we test the logic by creating standalone implementations that match the current code

// =============================================================================
// Codepoint Utility Tests (will be in codepoint-utils.ts)
// =============================================================================

/**
 * Check if a codepoint is valid and renderable
 * This mirrors the isValidCodepoint() method in GhosttyEmulator
 */
function isValidCodepoint(codepoint: number): boolean {
  if (typeof codepoint !== 'number' ||
      !Number.isFinite(codepoint) ||
      codepoint !== (codepoint | 0) ||
      codepoint <= 0) {
    return false;
  }
  if (codepoint < 0x20) return false;
  if (codepoint === 0x7F) return false;
  if (codepoint >= 0x80 && codepoint <= 0x9F) return false;
  if (codepoint === 0xFFFD) return false;
  if (codepoint >= 0xD800 && codepoint <= 0xDFFF) return false;
  if ((codepoint & 0xFFFE) === 0xFFFE) return false;
  if (codepoint > 0x10FFFF) return false;
  return true;
}

/**
 * Check if a codepoint is a CJK ideograph
 * This mirrors the isCjkIdeograph() method in GhosttyEmulator
 */
function isCjkIdeograph(codepoint: number): boolean {
  if (codepoint >= 0x4E00 && codepoint <= 0x9FFF) return true;
  if (codepoint >= 0x3400 && codepoint <= 0x4DBF) return true;
  if (codepoint >= 0x20000 && codepoint <= 0x2A6DF) return true;
  if (codepoint >= 0x2A700 && codepoint <= 0x2B73F) return true;
  if (codepoint >= 0x2B740 && codepoint <= 0x2B81F) return true;
  if (codepoint >= 0x2B820 && codepoint <= 0x2CEAF) return true;
  if (codepoint >= 0x2CEB0 && codepoint <= 0x2EBEF) return true;
  if (codepoint >= 0xF900 && codepoint <= 0xFAFF) return true;
  if (codepoint >= 0x2F800 && codepoint <= 0x2FA1F) return true;
  return false;
}

/**
 * Check if a codepoint is a space-like character
 * This mirrors the isSpaceLikeChar() method in GhosttyEmulator
 */
function isSpaceLikeChar(codepoint: number): boolean {
  if (codepoint === 0x00A0) return true;
  if (codepoint === 0x1680) return true;
  if (codepoint >= 0x2000 && codepoint <= 0x200A) return true;
  if (codepoint === 0x202F) return true;
  if (codepoint === 0x205F) return true;
  if (codepoint === 0x3000) return true;
  if (codepoint === 0x2800) return true;
  return false;
}

/**
 * Check if a codepoint is a zero-width/invisible character
 * This mirrors the isZeroWidthChar() method in GhosttyEmulator
 */
function isZeroWidthChar(codepoint: number): boolean {
  if (codepoint === 0x00AD) return true;
  if (codepoint === 0x034F) return true;
  if (codepoint === 0x061C) return true;
  if (codepoint >= 0x115F && codepoint <= 0x1160) return true;
  if (codepoint >= 0x17B4 && codepoint <= 0x17B5) return true;
  if (codepoint >= 0x180B && codepoint <= 0x180F) return true;
  if (codepoint >= 0x200B && codepoint <= 0x200F) return true;
  if (codepoint >= 0x2028 && codepoint <= 0x2029) return true;
  if (codepoint >= 0x202A && codepoint <= 0x202E) return true;
  if (codepoint >= 0x2060 && codepoint <= 0x206F) return true;
  if (codepoint === 0x3164) return true;
  if (codepoint >= 0xFE00 && codepoint <= 0xFE0F) return true;
  if (codepoint === 0xFEFF) return true;
  if (codepoint === 0xFFA0) return true;
  if (codepoint >= 0x1BCA0 && codepoint <= 0x1BCA3) return true;
  if (codepoint >= 0x1D173 && codepoint <= 0x1D17A) return true;
  if (codepoint === 0xE0001) return true;
  if (codepoint >= 0xE0020 && codepoint <= 0xE007F) return true;
  if (codepoint >= 0xE0100 && codepoint <= 0xE01EF) return true;
  return false;
}

/**
 * Safely extract RGB values
 * This mirrors the safeRgb() method in GhosttyEmulator
 */
function safeRgb(r: number, g: number, b: number): { r: number; g: number; b: number } {
  return {
    r: typeof r === 'number' && !Number.isNaN(r) ? r : 0,
    g: typeof g === 'number' && !Number.isNaN(g) ? g : 0,
    b: typeof b === 'number' && !Number.isNaN(b) ? b : 0,
  };
}

describe('Codepoint Utilities', () => {
  describe('isValidCodepoint', () => {
    test('rejects null and non-numbers', () => {
      expect(isValidCodepoint(null as unknown as number)).toBe(false);
      expect(isValidCodepoint(undefined as unknown as number)).toBe(false);
      expect(isValidCodepoint('A' as unknown as number)).toBe(false);
    });

    test('rejects zero and negative numbers', () => {
      expect(isValidCodepoint(0)).toBe(false);
      expect(isValidCodepoint(-1)).toBe(false);
      expect(isValidCodepoint(-100)).toBe(false);
    });

    test('rejects non-integers', () => {
      expect(isValidCodepoint(65.5)).toBe(false);
      expect(isValidCodepoint(NaN)).toBe(false);
      expect(isValidCodepoint(Infinity)).toBe(false);
    });

    test('rejects C0 control characters (0x01-0x1F)', () => {
      expect(isValidCodepoint(0x01)).toBe(false); // SOH
      expect(isValidCodepoint(0x0A)).toBe(false); // LF
      expect(isValidCodepoint(0x0D)).toBe(false); // CR
      expect(isValidCodepoint(0x1B)).toBe(false); // ESC
      expect(isValidCodepoint(0x1F)).toBe(false);
    });

    test('rejects DEL character (0x7F)', () => {
      expect(isValidCodepoint(0x7F)).toBe(false);
    });

    test('rejects C1 control characters (0x80-0x9F)', () => {
      expect(isValidCodepoint(0x80)).toBe(false);
      expect(isValidCodepoint(0x9F)).toBe(false);
    });

    test('rejects replacement character (U+FFFD)', () => {
      expect(isValidCodepoint(0xFFFD)).toBe(false);
    });

    test('rejects Unicode surrogates (U+D800-U+DFFF)', () => {
      expect(isValidCodepoint(0xD800)).toBe(false);
      expect(isValidCodepoint(0xDBFF)).toBe(false);
      expect(isValidCodepoint(0xDC00)).toBe(false);
      expect(isValidCodepoint(0xDFFF)).toBe(false);
    });

    test('rejects non-characters (U+nFFFE/U+nFFFF)', () => {
      expect(isValidCodepoint(0xFFFE)).toBe(false);
      expect(isValidCodepoint(0xFFFF)).toBe(false);
      expect(isValidCodepoint(0x1FFFE)).toBe(false);
      expect(isValidCodepoint(0x1FFFF)).toBe(false);
    });

    test('rejects codepoints beyond Unicode range', () => {
      expect(isValidCodepoint(0x110000)).toBe(false);
      expect(isValidCodepoint(0x200000)).toBe(false);
    });

    test('accepts printable ASCII (0x20-0x7E)', () => {
      expect(isValidCodepoint(0x20)).toBe(true); // Space
      expect(isValidCodepoint(0x41)).toBe(true); // 'A'
      expect(isValidCodepoint(0x7A)).toBe(true); // 'z'
      expect(isValidCodepoint(0x7E)).toBe(true); // '~'
    });

    test('accepts Latin-1 Supplement (0xA0-0xFF)', () => {
      expect(isValidCodepoint(0xA0)).toBe(true); // NBSP
      expect(isValidCodepoint(0xC0)).toBe(true); // 'À'
      expect(isValidCodepoint(0xFF)).toBe(true); // 'ÿ'
    });

    test('accepts CJK ideographs', () => {
      expect(isValidCodepoint(0x4E00)).toBe(true); // First CJK
      expect(isValidCodepoint(0x9FFF)).toBe(true); // Last common CJK
    });

    test('accepts emoji codepoints', () => {
      expect(isValidCodepoint(0x1F600)).toBe(true); // Grinning face
      expect(isValidCodepoint(0x1F4A9)).toBe(true); // Pile of poo
    });
  });

  describe('isCjkIdeograph', () => {
    test('detects CJK Unified Ideographs (U+4E00-U+9FFF)', () => {
      expect(isCjkIdeograph(0x4E00)).toBe(true); // First
      expect(isCjkIdeograph(0x4E2D)).toBe(true); // 中
      expect(isCjkIdeograph(0x9FFF)).toBe(true); // Last
    });

    test('detects CJK Extension A (U+3400-U+4DBF)', () => {
      expect(isCjkIdeograph(0x3400)).toBe(true);
      expect(isCjkIdeograph(0x4DBF)).toBe(true);
    });

    test('detects CJK Extension B (U+20000-U+2A6DF)', () => {
      expect(isCjkIdeograph(0x20000)).toBe(true);
      expect(isCjkIdeograph(0x2A6DF)).toBe(true);
    });

    test('detects CJK Extensions C-F', () => {
      expect(isCjkIdeograph(0x2A700)).toBe(true); // Ext C
      expect(isCjkIdeograph(0x2B740)).toBe(true); // Ext D
      expect(isCjkIdeograph(0x2B820)).toBe(true); // Ext E
      expect(isCjkIdeograph(0x2CEB0)).toBe(true); // Ext F
    });

    test('detects CJK Compatibility Ideographs', () => {
      expect(isCjkIdeograph(0xF900)).toBe(true);
      expect(isCjkIdeograph(0xFAFF)).toBe(true);
      expect(isCjkIdeograph(0x2F800)).toBe(true);
      expect(isCjkIdeograph(0x2FA1F)).toBe(true);
    });

    test('rejects non-CJK codepoints', () => {
      expect(isCjkIdeograph(0x41)).toBe(false); // 'A'
      expect(isCjkIdeograph(0x1F600)).toBe(false); // Emoji
      expect(isCjkIdeograph(0x3000)).toBe(false); // Ideographic space
    });
  });

  describe('isSpaceLikeChar', () => {
    test('detects no-break space (U+00A0)', () => {
      expect(isSpaceLikeChar(0x00A0)).toBe(true);
    });

    test('detects Ogham space mark (U+1680)', () => {
      expect(isSpaceLikeChar(0x1680)).toBe(true);
    });

    test('detects various width spaces (U+2000-U+200A)', () => {
      expect(isSpaceLikeChar(0x2000)).toBe(true); // EN QUAD
      expect(isSpaceLikeChar(0x2003)).toBe(true); // EM SPACE
      expect(isSpaceLikeChar(0x200A)).toBe(true); // HAIR SPACE
    });

    test('detects narrow no-break space (U+202F)', () => {
      expect(isSpaceLikeChar(0x202F)).toBe(true);
    });

    test('detects medium mathematical space (U+205F)', () => {
      expect(isSpaceLikeChar(0x205F)).toBe(true);
    });

    test('detects ideographic space (U+3000)', () => {
      expect(isSpaceLikeChar(0x3000)).toBe(true);
    });

    test('detects braille pattern blank (U+2800)', () => {
      expect(isSpaceLikeChar(0x2800)).toBe(true);
    });

    test('rejects regular space (U+0020)', () => {
      expect(isSpaceLikeChar(0x20)).toBe(false);
    });

    test('rejects non-space characters', () => {
      expect(isSpaceLikeChar(0x41)).toBe(false); // 'A'
      expect(isSpaceLikeChar(0x4E2D)).toBe(false); // 中
    });
  });

  describe('isZeroWidthChar', () => {
    test('detects soft hyphen (U+00AD)', () => {
      expect(isZeroWidthChar(0x00AD)).toBe(true);
    });

    test('detects combining grapheme joiner (U+034F)', () => {
      expect(isZeroWidthChar(0x034F)).toBe(true);
    });

    test('detects zero-width space (U+200B)', () => {
      expect(isZeroWidthChar(0x200B)).toBe(true);
    });

    test('detects zero-width non-joiner (U+200C)', () => {
      expect(isZeroWidthChar(0x200C)).toBe(true);
    });

    test('detects zero-width joiner (U+200D)', () => {
      expect(isZeroWidthChar(0x200D)).toBe(true);
    });

    test('detects left-to-right/right-to-left marks (U+200E-U+200F)', () => {
      expect(isZeroWidthChar(0x200E)).toBe(true);
      expect(isZeroWidthChar(0x200F)).toBe(true);
    });

    test('detects bidirectional formatting (U+202A-U+202E)', () => {
      expect(isZeroWidthChar(0x202A)).toBe(true); // LRE
      expect(isZeroWidthChar(0x202E)).toBe(true); // RLO
    });

    test('detects word joiner (U+2060)', () => {
      expect(isZeroWidthChar(0x2060)).toBe(true);
    });

    test('detects variation selectors (U+FE00-U+FE0F)', () => {
      expect(isZeroWidthChar(0xFE00)).toBe(true);
      expect(isZeroWidthChar(0xFE0F)).toBe(true);
    });

    test('detects byte order mark (U+FEFF)', () => {
      expect(isZeroWidthChar(0xFEFF)).toBe(true);
    });

    test('detects Hangul filler (U+3164)', () => {
      expect(isZeroWidthChar(0x3164)).toBe(true);
    });

    test('detects tag characters (U+E0020-U+E007F)', () => {
      expect(isZeroWidthChar(0xE0020)).toBe(true);
      expect(isZeroWidthChar(0xE007F)).toBe(true);
    });

    test('detects variation selectors supplement (U+E0100-U+E01EF)', () => {
      expect(isZeroWidthChar(0xE0100)).toBe(true);
      expect(isZeroWidthChar(0xE01EF)).toBe(true);
    });

    test('rejects regular visible characters', () => {
      expect(isZeroWidthChar(0x41)).toBe(false); // 'A'
      expect(isZeroWidthChar(0x20)).toBe(false); // Space
      expect(isZeroWidthChar(0x4E2D)).toBe(false); // 中
    });
  });
});

// =============================================================================
// RGB Utility Tests (will be in cell-converter.ts)
// =============================================================================

describe('RGB Utilities', () => {
  describe('safeRgb', () => {
    test('returns valid RGB values unchanged', () => {
      expect(safeRgb(255, 128, 0)).toEqual({ r: 255, g: 128, b: 0 });
      expect(safeRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
      expect(safeRgb(255, 255, 255)).toEqual({ r: 255, g: 255, b: 255 });
    });

    test('converts NaN to 0', () => {
      expect(safeRgb(NaN, 128, 64)).toEqual({ r: 0, g: 128, b: 64 });
      expect(safeRgb(255, NaN, 64)).toEqual({ r: 255, g: 0, b: 64 });
      expect(safeRgb(255, 128, NaN)).toEqual({ r: 255, g: 128, b: 0 });
    });

    test('converts undefined to 0', () => {
      expect(safeRgb(undefined as unknown as number, 128, 64)).toEqual({ r: 0, g: 128, b: 64 });
    });

    test('converts non-numbers to 0', () => {
      expect(safeRgb('red' as unknown as number, 128, 64)).toEqual({ r: 0, g: 128, b: 64 });
    });
  });
});

// =============================================================================
// Scrollback Cache Tests (will be in scrollback-cache.ts)
// =============================================================================

describe('Scrollback Cache', () => {
  // These tests verify the LRU cache behavior

  class ScrollbackCache {
    private cache = new Map<number, string[]>();
    private order: number[] = [];
    private maxSize: number;
    private trimSize: number;

    constructor(maxSize = 1000, trimSize = 500) {
      this.maxSize = maxSize;
      this.trimSize = trimSize;
    }

    get(offset: number): string[] | null {
      return this.cache.get(offset) ?? null;
    }

    set(offset: number, cells: string[]): void {
      this.cache.set(offset, cells);
      this.order.push(offset);
    }

    trim(): void {
      if (this.cache.size > this.maxSize) {
        const toRemove = this.cache.size - this.trimSize;
        const keysToRemove = this.order.splice(0, toRemove);
        for (const key of keysToRemove) {
          this.cache.delete(key);
        }
      }
    }

    clear(): void {
      this.cache.clear();
      this.order = [];
    }

    get size(): number {
      return this.cache.size;
    }
  }

  test('stores and retrieves cached lines', () => {
    const cache = new ScrollbackCache();
    cache.set(0, ['hello']);
    cache.set(1, ['world']);

    expect(cache.get(0)).toEqual(['hello']);
    expect(cache.get(1)).toEqual(['world']);
    expect(cache.get(2)).toBeNull();
  });

  test('trims oldest entries when exceeding max size', () => {
    const cache = new ScrollbackCache(10, 5);

    // Add 15 entries (exceeds max of 10)
    for (let i = 0; i < 15; i++) {
      cache.set(i, [`line-${i}`]);
    }

    cache.trim();

    // Should have trimmed to 5 entries (10 removed)
    expect(cache.size).toBe(5);

    // Oldest entries should be gone
    expect(cache.get(0)).toBeNull();
    expect(cache.get(9)).toBeNull();

    // Newest entries should remain
    expect(cache.get(10)).toEqual(['line-10']);
    expect(cache.get(14)).toEqual(['line-14']);
  });

  test('clear removes all entries', () => {
    const cache = new ScrollbackCache();
    cache.set(0, ['a']);
    cache.set(1, ['b']);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get(0)).toBeNull();
  });
});

// =============================================================================
// Structural Sharing Tests (will be in structural-sharing.ts)
// =============================================================================

describe('Row Version Tracking', () => {
  class RowVersionTracker {
    private rowVersions: number[] = [];
    private globalVersion = 0;

    constructor(rows: number) {
      this.rowVersions = new Array(rows).fill(0);
    }

    getVersion(row: number): number {
      return this.rowVersions[row] ?? 0;
    }

    incrementVersion(row: number): void {
      if (row >= 0 && row < this.rowVersions.length) {
        this.rowVersions[row]++;
        this.globalVersion++;
      }
    }

    getGlobalVersion(): number {
      return this.globalVersion;
    }

    resize(newRows: number): void {
      this.rowVersions = new Array(newRows).fill(0);
      this.globalVersion++;
    }
  }

  test('initializes all row versions to 0', () => {
    const tracker = new RowVersionTracker(24);
    for (let i = 0; i < 24; i++) {
      expect(tracker.getVersion(i)).toBe(0);
    }
    expect(tracker.getGlobalVersion()).toBe(0);
  });

  test('increments individual row versions', () => {
    const tracker = new RowVersionTracker(10);

    tracker.incrementVersion(5);
    expect(tracker.getVersion(5)).toBe(1);
    expect(tracker.getVersion(4)).toBe(0);
    expect(tracker.getGlobalVersion()).toBe(1);

    tracker.incrementVersion(5);
    expect(tracker.getVersion(5)).toBe(2);
    expect(tracker.getGlobalVersion()).toBe(2);
  });

  test('handles resize by resetting versions', () => {
    const tracker = new RowVersionTracker(10);
    tracker.incrementVersion(5);

    tracker.resize(20);

    expect(tracker.getVersion(5)).toBe(0);
    // Global version should increment on resize
    expect(tracker.getGlobalVersion()).toBe(2);
  });

  test('ignores out-of-bounds increments', () => {
    const tracker = new RowVersionTracker(10);

    tracker.incrementVersion(-1);
    tracker.incrementVersion(100);

    expect(tracker.getGlobalVersion()).toBe(0);
  });
});

// =============================================================================
// Cell Conversion Tests (will be in cell-converter.ts)
// =============================================================================

describe('Cell Conversion', () => {
  // Mock CellFlags values (from ghostty-web)
  const CellFlags = {
    BOLD: 1,
    ITALIC: 2,
    UNDERLINE: 4,
    STRIKETHROUGH: 128,
    INVERSE: 8,
    BLINK: 16,
    FAINT: 64,
  };

  interface MockCell {
    codepoint: number;
    fg_r: number;
    fg_g: number;
    fg_b: number;
    bg_r: number;
    bg_g: number;
    bg_b: number;
    flags: number;
    width: number;
    hyperlink_id?: number;
  }

  interface TerminalCell {
    char: string;
    fg: { r: number; g: number; b: number };
    bg: { r: number; g: number; b: number };
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    inverse: boolean;
    blink: boolean;
    dim: boolean;
    width: 1 | 2;
    hyperlinkId?: number;
  }

  const defaultColors = {
    foreground: { r: 255, g: 255, b: 255 },
    background: { r: 0, g: 0, b: 0 },
  };

  function convertCell(cell: MockCell): TerminalCell {
    const fg = safeRgb(cell.fg_r, cell.fg_g, cell.fg_b);
    const bg = safeRgb(cell.bg_r, cell.bg_g, cell.bg_b);

    // Zero-width characters
    if (isZeroWidthChar(cell.codepoint)) {
      return {
        char: ' ',
        fg: bg,
        bg: bg,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      };
    }

    // Space-like characters
    if (isSpaceLikeChar(cell.codepoint)) {
      return {
        char: ' ',
        fg,
        bg,
        bold: (cell.flags & CellFlags.BOLD) !== 0,
        italic: (cell.flags & CellFlags.ITALIC) !== 0,
        underline: (cell.flags & CellFlags.UNDERLINE) !== 0,
        strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
        inverse: (cell.flags & CellFlags.INVERSE) !== 0,
        blink: (cell.flags & CellFlags.BLINK) !== 0,
        dim: (cell.flags & CellFlags.FAINT) !== 0,
        width: 1,
      };
    }

    // Width=0 cells (spacers for wide chars)
    if (cell.width === 0) {
      return {
        char: ' ',
        fg,
        bg,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      };
    }

    // CJK with wrong width
    if (isCjkIdeograph(cell.codepoint) && cell.width !== 2) {
      return {
        char: ' ',
        fg,
        bg,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      };
    }

    // Convert codepoint to character
    let char = ' ';
    const cp = cell.codepoint;
    if (typeof cp === 'number' && cp >= 0x20) {
      if (cp <= 0x7E || (cp >= 0xA0 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFC)) {
        try {
          char = String.fromCharCode(cp);
        } catch {
          char = ' ';
        }
      } else if (cp >= 0x10000 && cp <= 0x10FFFF) {
        try {
          char = String.fromCodePoint(cp);
        } catch {
          char = ' ';
        }
      }
    }

    return {
      char,
      fg,
      bg,
      bold: (cell.flags & CellFlags.BOLD) !== 0,
      italic: (cell.flags & CellFlags.ITALIC) !== 0,
      underline: (cell.flags & CellFlags.UNDERLINE) !== 0,
      strikethrough: (cell.flags & CellFlags.STRIKETHROUGH) !== 0,
      inverse: (cell.flags & CellFlags.INVERSE) !== 0,
      blink: (cell.flags & CellFlags.BLINK) !== 0,
      dim: (cell.flags & CellFlags.FAINT) !== 0,
      width: cell.width as 1 | 2,
      hyperlinkId: cell.hyperlink_id,
    };
  }

  test('converts basic ASCII character', () => {
    const cell: MockCell = {
      codepoint: 0x41, // 'A'
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0,
      width: 1,
    };

    const result = convertCell(cell);
    expect(result.char).toBe('A');
    expect(result.fg).toEqual({ r: 255, g: 255, b: 255 });
    expect(result.bg).toEqual({ r: 0, g: 0, b: 0 });
    expect(result.width).toBe(1);
  });

  test('converts cell with formatting flags', () => {
    const cell: MockCell = {
      codepoint: 0x41,
      fg_r: 255, fg_g: 0, fg_b: 0,
      bg_r: 0, bg_g: 0, bg_b: 255,
      flags: CellFlags.BOLD | CellFlags.ITALIC | CellFlags.UNDERLINE,
      width: 1,
    };

    const result = convertCell(cell);
    expect(result.bold).toBe(true);
    expect(result.italic).toBe(true);
    expect(result.underline).toBe(true);
    expect(result.strikethrough).toBe(false);
  });

  test('converts zero-width character to invisible space', () => {
    const cell: MockCell = {
      codepoint: 0x200B, // Zero-width space
      fg_r: 255, fg_g: 0, fg_b: 0, // Red foreground
      bg_r: 0, bg_g: 128, bg_b: 0, // Green background
      flags: CellFlags.BOLD,
      width: 1,
    };

    const result = convertCell(cell);
    expect(result.char).toBe(' ');
    // Foreground should match background (invisible)
    expect(result.fg).toEqual({ r: 0, g: 128, b: 0 });
    expect(result.bg).toEqual({ r: 0, g: 128, b: 0 });
    // Flags should be reset
    expect(result.bold).toBe(false);
  });

  test('normalizes space-like character to regular space', () => {
    const cell: MockCell = {
      codepoint: 0x00A0, // No-break space
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 128, bg_g: 128, bg_b: 128,
      flags: CellFlags.BOLD,
      width: 1,
    };

    const result = convertCell(cell);
    expect(result.char).toBe(' ');
    // Colors should be preserved
    expect(result.fg).toEqual({ r: 255, g: 255, b: 255 });
    expect(result.bg).toEqual({ r: 128, g: 128, b: 128 });
    // Flags should be preserved
    expect(result.bold).toBe(true);
  });

  test('converts width=0 spacer cell to empty space', () => {
    const cell: MockCell = {
      codepoint: 0x4E2D, // CJK character (shouldn't matter for width=0)
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: CellFlags.BOLD,
      width: 0,
    };

    const result = convertCell(cell);
    expect(result.char).toBe(' ');
    expect(result.width).toBe(1);
    expect(result.bold).toBe(false); // Flags reset for spacer
  });

  test('filters CJK ideograph with wrong width', () => {
    const cell: MockCell = {
      codepoint: 0x4E2D, // 中
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0,
      width: 1, // Wrong! CJK should be width=2
    };

    const result = convertCell(cell);
    expect(result.char).toBe(' '); // Filtered out
  });

  test('accepts CJK ideograph with correct width=2', () => {
    const cell: MockCell = {
      codepoint: 0x4E2D, // 中
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0,
      width: 2, // Correct
    };

    const result = convertCell(cell);
    expect(result.char).toBe('中');
    expect(result.width).toBe(2);
  });

  test('preserves hyperlink ID', () => {
    const cell: MockCell = {
      codepoint: 0x41,
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 42,
    };

    const result = convertCell(cell);
    expect(result.hyperlinkId).toBe(42);
  });

  test('handles emoji in supplementary planes', () => {
    const cell: MockCell = {
      codepoint: 0x1F600, // 😀
      fg_r: 255, fg_g: 255, fg_b: 255,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0,
      width: 2,
    };

    const result = convertCell(cell);
    expect(result.char).toBe('😀');
  });
});
