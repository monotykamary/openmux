/**
 * Codepoint validation utilities for terminal cell conversion.
 * These functions determine how Unicode codepoints should be handled
 * when rendering terminal content.
 */

/**
 * Check if a codepoint is valid and renderable.
 * Filters out null, replacement chars, surrogates, control chars, and invalid Unicode.
 *
 * @param codepoint - The Unicode codepoint to validate
 * @returns true if the codepoint can be rendered as a visible character
 */
export function isValidCodepoint(codepoint: number): boolean {
  // Type safety: must be a finite positive integer
  if (
    typeof codepoint !== 'number' ||
    !Number.isFinite(codepoint) ||
    codepoint !== (codepoint | 0) || // Must be integer (32-bit)
    codepoint <= 0
  ) {
    return false;
  }
  // C0 control characters (0x01-0x1F) except space (0x20)
  // These are non-printable and shouldn't be rendered as glyphs
  if (codepoint < 0x20) return false;
  // DEL character (0x7F)
  if (codepoint === 0x7f) return false;
  // C1 control characters (0x80-0x9F)
  if (codepoint >= 0x80 && codepoint <= 0x9f) return false;
  // Replacement character (U+FFFD) - renders as diamond question mark
  if (codepoint === 0xfffd) return false;
  // Unicode surrogates (U+D800-U+DFFF) - invalid on their own
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) return false;
  // Non-characters (U+FFFE, U+FFFF, and U+nFFFE/U+nFFFF in each plane)
  if ((codepoint & 0xfffe) === 0xfffe) return false;
  // Out of Unicode range
  if (codepoint > 0x10ffff) return false;
  // Note: Zero-width characters (U+200B-U+200F, U+2060, U+FEFF, U+FE00-U+FE0F)
  // are handled separately in isZeroWidthChar() with different treatment
  return true;
}

/**
 * Check if a codepoint is a CJK ideograph that requires width=2.
 * These should only be rendered if the cell has proper double-width (width=2).
 * If they appear with width=1, it's likely corrupted cell data.
 *
 * @param codepoint - The Unicode codepoint to check
 * @returns true if the codepoint is a CJK ideograph
 */
export function isCjkIdeograph(codepoint: number): boolean {
  // CJK Unified Ideographs (U+4E00-U+9FFF)
  if (codepoint >= 0x4e00 && codepoint <= 0x9fff) return true;
  // CJK Unified Ideographs Extension A (U+3400-U+4DBF)
  if (codepoint >= 0x3400 && codepoint <= 0x4dbf) return true;
  // CJK Unified Ideographs Extension B (U+20000-U+2A6DF)
  if (codepoint >= 0x20000 && codepoint <= 0x2a6df) return true;
  // CJK Unified Ideographs Extension C (U+2A700-U+2B73F)
  if (codepoint >= 0x2a700 && codepoint <= 0x2b73f) return true;
  // CJK Unified Ideographs Extension D (U+2B740-U+2B81F)
  if (codepoint >= 0x2b740 && codepoint <= 0x2b81f) return true;
  // CJK Unified Ideographs Extension E (U+2B820-U+2CEAF)
  if (codepoint >= 0x2b820 && codepoint <= 0x2ceaf) return true;
  // CJK Unified Ideographs Extension F (U+2CEB0-U+2EBEF)
  if (codepoint >= 0x2ceb0 && codepoint <= 0x2ebef) return true;
  // CJK Compatibility Ideographs (U+F900-U+FAFF)
  if (codepoint >= 0xf900 && codepoint <= 0xfaff) return true;
  // CJK Compatibility Ideographs Supplement (U+2F800-U+2FA1F)
  if (codepoint >= 0x2f800 && codepoint <= 0x2fa1f) return true;
  return false;
}

/**
 * Check if a codepoint is a space-like character that should be normalized to regular space.
 * These are visually empty/blank characters that might cause rendering inconsistencies
 * if not converted to standard space (U+0020).
 *
 * @param codepoint - The Unicode codepoint to check
 * @returns true if the codepoint should be normalized to a regular space
 */
export function isSpaceLikeChar(codepoint: number): boolean {
  // No-break space (U+00A0)
  if (codepoint === 0x00a0) return true;
  // Ogham space mark (U+1680) - renders as space in most fonts
  if (codepoint === 0x1680) return true;
  // Various width spaces (U+2000-U+200A)
  // EN QUAD, EM QUAD, EN SPACE, EM SPACE, etc.
  if (codepoint >= 0x2000 && codepoint <= 0x200a) return true;
  // NARROW NO-BREAK SPACE (U+202F)
  if (codepoint === 0x202f) return true;
  // MEDIUM MATHEMATICAL SPACE (U+205F)
  if (codepoint === 0x205f) return true;
  // IDEOGRAPHIC SPACE (U+3000) - full-width CJK space
  if (codepoint === 0x3000) return true;
  // BRAILLE PATTERN BLANK (U+2800) - all dots off, looks empty
  // Often used in TUI graphics that use braille patterns
  if (codepoint === 0x2800) return true;
  return false;
}

/**
 * Check if a codepoint is a zero-width/invisible character that should use default colors.
 * These are invisible modifiers that can carry stale color information.
 * Based on Unicode "Default_Ignorable_Code_Point" property.
 *
 * @param codepoint - The Unicode codepoint to check
 * @returns true if the codepoint is zero-width/invisible
 */
export function isZeroWidthChar(codepoint: number): boolean {
  // Soft hyphen (U+00AD) - invisible unless at line break
  if (codepoint === 0x00ad) return true;
  // Combining grapheme joiner (U+034F)
  if (codepoint === 0x034f) return true;
  // Arabic letter mark (U+061C)
  if (codepoint === 0x061c) return true;
  // Hangul jungseong/jongseong fillers (U+115F-U+1160)
  if (codepoint >= 0x115f && codepoint <= 0x1160) return true;
  // Khmer vowel inherent (U+17B4-U+17B5)
  if (codepoint >= 0x17b4 && codepoint <= 0x17b5) return true;
  // Mongolian free variation selectors and vowel separator (U+180B-U+180F)
  if (codepoint >= 0x180b && codepoint <= 0x180f) return true;
  // Zero-width and directional formatting (U+200B-U+200F)
  if (codepoint >= 0x200b && codepoint <= 0x200f) return true;
  // Line/paragraph separators (U+2028-U+2029)
  if (codepoint >= 0x2028 && codepoint <= 0x2029) return true;
  // Bidirectional formatting (U+202A-U+202E)
  if (codepoint >= 0x202a && codepoint <= 0x202e) return true;
  // Word joiner and invisible operators (U+2060-U+206F)
  if (codepoint >= 0x2060 && codepoint <= 0x206f) return true;
  // Hangul filler (U+3164)
  if (codepoint === 0x3164) return true;
  // Variation selectors (U+FE00-U+FE0F)
  if (codepoint >= 0xfe00 && codepoint <= 0xfe0f) return true;
  // Byte order mark / Zero-width no-break space (U+FEFF)
  if (codepoint === 0xfeff) return true;
  // Halfwidth Hangul filler (U+FFA0)
  if (codepoint === 0xffa0) return true;
  // Shorthand format controls (U+1BCA0-U+1BCA3)
  if (codepoint >= 0x1bca0 && codepoint <= 0x1bca3) return true;
  // Musical symbol formatting (U+1D173-U+1D17A)
  if (codepoint >= 0x1d173 && codepoint <= 0x1d17a) return true;
  // Language tag (U+E0001)
  if (codepoint === 0xe0001) return true;
  // Tag characters (U+E0020-U+E007F)
  if (codepoint >= 0xe0020 && codepoint <= 0xe007f) return true;
  // Variation selectors supplement (U+E0100-U+E01EF)
  if (codepoint >= 0xe0100 && codepoint <= 0xe01ef) return true;
  return false;
}

/**
 * Convert a codepoint to a character string, with safety checks.
 * Returns space for invalid or unrenderable codepoints.
 *
 * @param codepoint - The Unicode codepoint to convert
 * @param isInvisible - Whether the cell has the INVISIBLE flag set
 * @returns The character string, or space if invalid
 */
export function codepointToChar(codepoint: number, isInvisible: boolean = false): string {
  if (isInvisible) return ' ';

  const cp = codepoint;
  if (typeof cp !== 'number' || cp < 0x20) return ' ';

  if (cp <= 0x7e) {
    // Printable ASCII
    return String.fromCharCode(cp);
  } else if (cp >= 0xa0 && cp <= 0xd7ff) {
    // Latin-1 Supplement through pre-surrogate BMP
    return String.fromCharCode(cp);
  } else if (cp >= 0xe000 && cp <= 0xfffd && cp !== 0xfffd) {
    // Private Use Area (nerd fonts) through end of BMP, excluding U+FFFD
    return String.fromCharCode(cp);
  } else if (cp >= 0x10000 && cp <= 0xcffff) {
    // Planes 1-12 (skip Plane 13 - unassigned, ghostty-web returns garbage here)
    try {
      return String.fromCodePoint(cp);
    } catch {
      return ' ';
    }
  } else if (cp >= 0xe0000 && cp <= 0xeffff) {
    // Plane 14: SSP (tags, variation selectors supplement)
    try {
      return String.fromCodePoint(cp);
    } catch {
      return ' ';
    }
  } else if (cp >= 0xf0000 && cp <= 0xfffff) {
    // Plane 15: PUA-A (Supplementary Private Use Area A - file icons)
    try {
      return String.fromCodePoint(cp);
    } catch {
      return ' ';
    }
  }

  // Implicitly skip: DEL (0x7F), C1 controls (0x80-0x9F), surrogates (0xD800-0xDFFF),
  // replacement char (0xFFFD), non-characters, Plane 13 + Plane 16 (ghostty-web bug)
  return ' ';
}
