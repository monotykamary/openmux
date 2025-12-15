/**
 * Constants for terminal query passthrough
 */

// =============================================================================
// Escape Sequence Building Blocks
// =============================================================================

export const ESC = '\x1b';
export const BEL = '\x07';
export const ST = `${ESC}\\`;
export const DCS = `${ESC}P`;

// =============================================================================
// DSR Query Patterns
// =============================================================================

export const DSR_CPR_QUERY = `${ESC}[6n`;      // Cursor Position Report query
export const DSR_STATUS_QUERY = `${ESC}[5n`;   // Device Status query

// =============================================================================
// Device Attributes Query Patterns
// =============================================================================

export const DA1_QUERY = `${ESC}[c`;           // Primary Device Attributes (short form)
export const DA1_QUERY_FULL = `${ESC}[0c`;     // Primary Device Attributes (explicit)
export const DA2_QUERY = `${ESC}[>c`;          // Secondary Device Attributes (short form)
export const DA2_QUERY_FULL = `${ESC}[>0c`;    // Secondary Device Attributes (explicit)
export const DA3_QUERY = `${ESC}[=c`;          // Tertiary Device Attributes (short form)
export const DA3_QUERY_FULL = `${ESC}[=0c`;    // Tertiary Device Attributes (explicit)

// =============================================================================
// XTVERSION Query Patterns
// =============================================================================

export const XTVERSION_QUERY = `${ESC}[>q`;    // Terminal version query (short form)
export const XTVERSION_QUERY_FULL = `${ESC}[>0q`; // Terminal version query (explicit)

// =============================================================================
// DECRQM (Request Mode) Patterns
// =============================================================================

export const DECRQM_PREFIX = `${ESC}[?`;
export const DECRQM_SUFFIX = '$p';

// =============================================================================
// XTGETTCAP (Termcap Query) Patterns
// =============================================================================

export const XTGETTCAP_PREFIX = `${DCS}+q`;

// =============================================================================
// Kitty Keyboard Protocol
// =============================================================================

export const KITTY_KEYBOARD_QUERY = `${ESC}[?u`;

// =============================================================================
// XTWINOPS Window Size Query Patterns
// =============================================================================

export const XTWINOPS_14T = `${ESC}[14t`;  // Window size in pixels
export const XTWINOPS_16T = `${ESC}[16t`;  // Cell size in pixels
export const XTWINOPS_18T = `${ESC}[18t`;  // Text area in characters

// =============================================================================
// Extended Cursor Position Report
// =============================================================================

export const DECXCPR_QUERY = `${ESC}[?6n`;

// =============================================================================
// OSC Color Query Patterns
// =============================================================================

export const OSC_PALETTE_PREFIX = `${ESC}]4;`;
export const OSC_FG_QUERY_BEL = `${ESC}]10;?${BEL}`;
export const OSC_FG_QUERY_ST = `${ESC}]10;?${ST}`;
export const OSC_BG_QUERY_BEL = `${ESC}]11;?${BEL}`;
export const OSC_BG_QUERY_ST = `${ESC}]11;?${ST}`;
export const OSC_CURSOR_QUERY_BEL = `${ESC}]12;?${BEL}`;
export const OSC_CURSOR_QUERY_ST = `${ESC}]12;?${ST}`;

// =============================================================================
// OSC 52 Clipboard Query Patterns
// =============================================================================

export const OSC_CLIPBOARD_PREFIX = `${ESC}]52;`;

// =============================================================================
// DECRQSS (Request Status String) Patterns
// =============================================================================

export const DECRQSS_PREFIX = `${DCS}$q`;

// =============================================================================
// Known Termcap/Terminfo Capabilities
// =============================================================================

export const KNOWN_CAPABILITIES: Record<string, string> = {
  // Terminal name
  'TN': 'xterm-256color',
  'name': 'xterm-256color',
  // Colors
  'Co': '256',
  'colors': '256',
  // RGB/True color support
  'RGB': '',  // Empty string means supported
  'rgb': '',
  // Setrgbf/Setrgbb for true color
  'setrgbf': '\x1b[38;2;%p1%d;%p2%d;%p3%dm',
  'setrgbb': '\x1b[48;2;%p1%d;%p2%d;%p3%dm',
};

// =============================================================================
// Known DEC Private Modes
// =============================================================================

// Mode values: 0 = not recognized, 1 = set, 2 = reset, 3 = permanently set, 4 = permanently reset
export const KNOWN_MODES: Record<number, 0 | 1 | 2 | 3 | 4> = {
  1: 2,      // DECCKM - Cursor keys mode (reset = normal)
  7: 2,      // DECAWM - Auto-wrap mode (reset = no wrap)
  12: 2,     // Cursor blink (reset = steady)
  25: 1,     // DECTCEM - Text cursor enable (set = visible)
  1000: 2,   // Mouse tracking (reset)
  1002: 2,   // Cell motion mouse tracking (reset)
  1003: 2,   // All motion mouse tracking (reset)
  1004: 2,   // Focus events (reset)
  1006: 2,   // SGR mouse mode (reset)
  1049: 2,   // Alternate screen buffer (reset = normal)
  2004: 2,   // Bracketed paste (reset)
  2026: 2,   // Synchronized output (reset)
  2048: 2,   // In-band resize notifications (reset) - sends CSI 48 on resize when enabled
};

// =============================================================================
// Default 256-Color ANSI Palette
// =============================================================================

export const DEFAULT_PALETTE: number[] = (() => {
  const palette: number[] = [];

  // Standard 16 colors (indices 0-15)
  const standard16 = [
    0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5,
    0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff,
  ];
  palette.push(...standard16);

  // 216 color cube (indices 16-231)
  const levels = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push((levels[r] << 16) | (levels[g] << 8) | levels[b]);
      }
    }
  }

  // Grayscale (indices 232-255)
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push((v << 16) | (v << 8) | v);
  }

  return palette;
})();
