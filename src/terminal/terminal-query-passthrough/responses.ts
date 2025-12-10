/**
 * Response generators for terminal queries
 */

import { ESC, ST, DCS } from './constants';

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert string to hex encoding (2 hex digits per character)
 */
export function stringToHex(str: string): string {
  return Array.from(str).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to regular string
 */
export function hexToString(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}

// =============================================================================
// Cursor Position Responses
// =============================================================================

/**
 * Generate a CPR (Cursor Position Report) response
 * Format: ESC[row;colR (1-based positions)
 */
export function generateCprResponse(row: number, col: number): string {
  return `${ESC}[${row + 1};${col + 1}R`;
}

/**
 * Generate a DECXCPR (Extended Cursor Position Report) response
 * Format: ESC[?row;col;pageR (1-based positions, page is always 1)
 */
export function generateDecxcprResponse(row: number, col: number): string {
  return `${ESC}[?${row + 1};${col + 1};1R`;
}

// =============================================================================
// Device Status Responses
// =============================================================================

/**
 * Generate a Device Status OK response
 * Format: ESC[0n
 */
export function generateStatusOkResponse(): string {
  return `${ESC}[0n`;
}

// =============================================================================
// Device Attributes Responses
// =============================================================================

/**
 * Generate a Primary Device Attributes (DA1) response
 * Format: ESC[?62;1;4;22c - Reports VT220 with capabilities:
 * - 62: VT220
 * - 1: 132 columns
 * - 4: Sixel graphics
 * - 22: ANSI color
 */
export function generateDa1Response(): string {
  return `${ESC}[?62;1;4;22c`;
}

/**
 * Generate a Secondary Device Attributes (DA2) response
 * Format: ESC[>Pp;Pv;Pc c
 * - Pp = Terminal type (65 = VT500)
 * - Pv = Firmware version (100)
 * - Pc = ROM cartridge registration (0 = none)
 */
export function generateDa2Response(): string {
  return `${ESC}[>65;100;0c`;
}

/**
 * Generate a Tertiary Device Attributes (DA3) response
 * Format: DCS ! | DDDDDDDD ST (DECRPTUI - Report Terminal Unit ID)
 * Returns 8 hex digits representing the unit ID
 * We return all zeros like many modern terminals
 */
export function generateDa3Response(): string {
  return `${DCS}!|00000000${ST}`;
}

// =============================================================================
// Color Responses
// =============================================================================

/**
 * Generate an OSC foreground color response
 * Format: ESC]10;rgb:rrrr/gggg/bbbb ESC\
 * Note: Uses 16-bit color values (multiply 8-bit by 257 to get rrrr format)
 */
export function generateOscFgResponse(r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]10;rgb:${r16}/${g16}/${b16}${ST}`;
}

/**
 * Generate an OSC background color response
 * Format: ESC]11;rgb:rrrr/gggg/bbbb ESC\
 */
export function generateOscBgResponse(r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]11;rgb:${r16}/${g16}/${b16}${ST}`;
}

/**
 * Generate an OSC cursor color response
 * Format: ESC]12;rgb:rrrr/gggg/bbbb ESC\
 */
export function generateOscCursorResponse(r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]12;rgb:${r16}/${g16}/${b16}${ST}`;
}

/**
 * Generate an OSC 4 palette color response
 * Format: ESC]4;index;rgb:rrrr/gggg/bbbb ESC\
 */
export function generateOscPaletteResponse(index: number, r: number, g: number, b: number): string {
  const r16 = (r * 257).toString(16).padStart(4, '0');
  const g16 = (g * 257).toString(16).padStart(4, '0');
  const b16 = (b * 257).toString(16).padStart(4, '0');
  return `${ESC}]4;${index};rgb:${r16}/${g16}/${b16}${ST}`;
}

// =============================================================================
// Mode Query Responses
// =============================================================================

/**
 * Generate a DECRPM (Report Mode) response for DEC private modes
 * Format: ESC[?Ps;Pm$y
 * - Ps = mode number
 * - Pm = mode value: 0 (not recognized), 1 (set), 2 (reset), 3 (permanently set), 4 (permanently reset)
 */
export function generateDecrpmResponse(mode: number, value: 0 | 1 | 2 | 3 | 4): string {
  return `${ESC}[?${mode};${value}$y`;
}

/**
 * Generate an XTGETTCAP response for capabilities
 * Format: DCS 1 + r name=value ST (valid) or DCS 0 + r name ST (invalid)
 * Names and values are hex-encoded
 */
export function generateXtgettcapResponse(capabilities: Map<string, string | null>): string {
  const responses: string[] = [];
  for (const [name, value] of capabilities) {
    if (value !== null) {
      // Valid capability - encode name and value as hex
      const nameHex = stringToHex(name);
      const valueHex = stringToHex(value);
      responses.push(`${DCS}1+r${nameHex}=${valueHex}${ST}`);
    } else {
      // Invalid/unknown capability
      const nameHex = stringToHex(name);
      responses.push(`${DCS}0+r${nameHex}${ST}`);
    }
  }
  return responses.join('');
}

// =============================================================================
// Window Operation Responses
// =============================================================================

/**
 * Generate an XTWINOPS response for window size queries
 * Format depends on the operation:
 * - 14t (pixels): ESC[4;height;width t
 * - 16t (cell size): ESC[6;height;width t
 * - 18t (text area): ESC[8;rows;cols t
 */
export function generateXtwinopsResponse(winop: number, height: number, width: number): string {
  let responseCode: number;
  switch (winop) {
    case 14: responseCode = 4; break;
    case 16: responseCode = 6; break;
    case 18: responseCode = 8; break;
    default: return '';
  }
  return `${ESC}[${responseCode};${height};${width}t`;
}

// =============================================================================
// Version and Keyboard Responses
// =============================================================================

/**
 * Generate an XTVERSION response
 * Format: DCS > | name(version) ST
 */
export function generateXtversionResponse(name: string, version: string): string {
  return `${DCS}>|${name}(${version})${ST}`;
}

/**
 * Generate a Kitty Keyboard Protocol Query response
 * Format: ESC[?flags u
 * flags is a bitmask of enabled features (0 = legacy mode)
 */
export function generateKittyKeyboardResponse(flags: number): string {
  return `${ESC}[?${flags}u`;
}

// =============================================================================
// DECRQSS (Request Status String) Responses
// =============================================================================

/**
 * Generate a DECRQSS valid response
 * Format: DCS 1 $ r Pt ST
 * Pt is the status string (e.g., "0m" for SGR reset)
 */
export function generateDecrqssValidResponse(statusString: string): string {
  return `${DCS}1$r${statusString}${ST}`;
}

/**
 * Generate a DECRQSS invalid response
 * Format: DCS 0 $ r ST
 */
export function generateDecrqssInvalidResponse(): string {
  return `${DCS}0$r${ST}`;
}

// =============================================================================
// OSC 52 (Clipboard) Responses
// =============================================================================

/**
 * Generate an empty OSC 52 clipboard response (for denied/empty clipboard)
 * Format: ESC]52;selection; ST
 */
export function generateOscClipboardEmptyResponse(selection: string): string {
  return `${ESC}]52;${selection};${ST}`;
}
