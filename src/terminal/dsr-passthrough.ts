/**
 * Terminal Query Passthrough
 *
 * Intercepts terminal queries from PTY output and generates appropriate responses
 * that are written back to the PTY, allowing applications inside openmux panes
 * to query cursor position, terminal status, capabilities, modes, and colors.
 *
 * The flow:
 * 1. Application (e.g., codex) writes ESC[6n to query cursor position
 * 2. This goes through the PTY and arrives at pty.onData()
 * 3. We intercept it, get cursor position from ghostty-web emulator
 * 4. We write the response (ESC[row;colR) back to the PTY
 * 5. Application receives the response
 *
 * Supported queries:
 * - DSR 5 (ESC[5n): Device Status Report - responds with ESC[0n (OK)
 * - DSR 6 (ESC[6n): Cursor Position Report - responds with ESC[row;colR
 * - DA1 (ESC[c or ESC[0c): Primary Device Attributes - responds with VT220 capabilities
 * - DA2 (ESC[>c or ESC[>0c): Secondary Device Attributes - responds with VT500 type
 * - DA3 (ESC[=c or ESC[=0c): Tertiary Device Attributes - responds with unit ID
 * - XTVERSION (ESC[>q or ESC[>0q): Terminal version - responds with DCS>|openmux(version)ST
 * - DECRQM (ESC[?Ps$p): Request DEC private mode - responds with mode status
 * - XTGETTCAP (DCS+q...ST): Termcap/terminfo query - responds with capability values
 * - Kitty Keyboard Query (ESC[?u): Query keyboard protocol flags
 * - OSC 10 (ESC]10;?): Foreground color query - responds with ESC]10;rgb:rr/gg/bb
 * - OSC 11 (ESC]11;?): Background color query - responds with ESC]11;rgb:rr/gg/bb
 */

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;
const DCS = `${ESC}P`;

// DSR query patterns
const DSR_CPR_QUERY = `${ESC}[6n`;  // Cursor Position Report query
const DSR_STATUS_QUERY = `${ESC}[5n`;  // Device Status query

// Device Attributes query patterns
const DA1_QUERY = `${ESC}[c`;  // Primary Device Attributes (short form)
const DA1_QUERY_FULL = `${ESC}[0c`;  // Primary Device Attributes (explicit)
const DA2_QUERY = `${ESC}[>c`;  // Secondary Device Attributes (short form)
const DA2_QUERY_FULL = `${ESC}[>0c`;  // Secondary Device Attributes (explicit)
const DA3_QUERY = `${ESC}[=c`;  // Tertiary Device Attributes (short form)
const DA3_QUERY_FULL = `${ESC}[=0c`;  // Tertiary Device Attributes (explicit)

// XTVERSION query patterns
const XTVERSION_QUERY = `${ESC}[>q`;  // Terminal version query (short form)
const XTVERSION_QUERY_FULL = `${ESC}[>0q`;  // Terminal version query (explicit)

// DECRQM (Request Mode) pattern prefix - ESC[?Ps$p
// We'll parse the Ps parameter dynamically
const DECRQM_PREFIX = `${ESC}[?`;
const DECRQM_SUFFIX = '$p';

// XTGETTCAP (Termcap query) - DCS+q...ST or DCS+q...BEL
const XTGETTCAP_PREFIX = `${DCS}+q`;

// Kitty keyboard protocol query
const KITTY_KEYBOARD_QUERY = `${ESC}[?u`;

// OSC color query patterns - can end with BEL or ST
// OSC 10;? = query foreground, OSC 11;? = query background
const OSC_FG_QUERY_BEL = `${ESC}]10;?${BEL}`;
const OSC_FG_QUERY_ST = `${ESC}]10;?${ST}`;
const OSC_BG_QUERY_BEL = `${ESC}]11;?${BEL}`;
const OSC_BG_QUERY_ST = `${ESC}]11;?${ST}`;

export interface DsrQuery {
  type: 'cpr' | 'status' | 'da1' | 'da2' | 'da3' | 'xtversion' | 'decrqm' | 'xtgettcap' | 'kitty-keyboard' | 'osc-fg' | 'osc-bg';
  startIndex: number;
  endIndex: number;
  /** Mode number for DECRQM queries */
  mode?: number;
  /** Capability names for XTGETTCAP queries (hex-encoded) */
  capabilities?: string[];
}

export interface DsrParseResult {
  /** Text to pass through to emulator (without DSR queries) */
  textSegments: string[];
  /** DSR queries that need responses */
  queries: DsrQuery[];
}

/**
 * Quick check if data might contain terminal queries
 */
function mightContainQueries(data: string): boolean {
  // Check for CSI sequences (ESC[)
  if (data.includes(`${ESC}[`)) {
    // DSR queries (5n, 6n), DA queries (c), XTVERSION (q), DECRQM ($p), Kitty (?u)
    if (data.includes('n') || data.includes('c') || data.includes('q') ||
        data.includes('$p') || data.includes('?u')) {
      return true;
    }
  }
  // Check for OSC color queries (ESC]10;? or ESC]11;?)
  if (data.includes(`${ESC}]`) && data.includes(';?')) {
    return true;
  }
  // Check for DCS sequences (XTGETTCAP)
  if (data.includes(DCS)) {
    return true;
  }
  return false;
}

/**
 * Parse PTY output for DSR and OSC queries
 */
export function parseDsrQueries(data: string): DsrParseResult {
  const textSegments: string[] = [];
  const queries: DsrQuery[] = [];

  if (!mightContainQueries(data)) {
    return { textSegments: [data], queries: [] };
  }

  let currentIndex = 0;
  let textStart = 0;

  while (currentIndex < data.length) {
    // Check for CPR query (ESC[6n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_CPR_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'cpr',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    // Check for Device Status query (ESC[5n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_STATUS_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'status',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    // Check for DA2 (Secondary Device Attributes) - must check before DA1
    // DA2: ESC[>c or ESC[>0c
    if (data.startsWith(DA2_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY_FULL.length,
      });
      currentIndex += DA2_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA2_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY.length,
      });
      currentIndex += DA2_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DA3 (Tertiary Device Attributes) - must check before DA1
    // DA3: ESC[=c or ESC[=0c
    if (data.startsWith(DA3_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da3',
        startIndex: currentIndex,
        endIndex: currentIndex + DA3_QUERY_FULL.length,
      });
      currentIndex += DA3_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA3_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da3',
        startIndex: currentIndex,
        endIndex: currentIndex + DA3_QUERY.length,
      });
      currentIndex += DA3_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for XTVERSION - must check before DA1 since ESC[>0q contains 'c'-like pattern
    // XTVERSION: ESC[>q or ESC[>0q
    if (data.startsWith(XTVERSION_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtversion',
        startIndex: currentIndex,
        endIndex: currentIndex + XTVERSION_QUERY_FULL.length,
      });
      currentIndex += XTVERSION_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(XTVERSION_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtversion',
        startIndex: currentIndex,
        endIndex: currentIndex + XTVERSION_QUERY.length,
      });
      currentIndex += XTVERSION_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DA1 (Primary Device Attributes)
    // DA1: ESC[c or ESC[0c
    if (data.startsWith(DA1_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY_FULL.length,
      });
      currentIndex += DA1_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA1_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY.length,
      });
      currentIndex += DA1_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DECRQM (Request DEC Private Mode) - ESC[?Ps$p
    // Need to parse the mode number dynamically
    if (data.startsWith(DECRQM_PREFIX, currentIndex)) {
      // Look for the $p suffix and extract the mode number
      let endPos = currentIndex + DECRQM_PREFIX.length;
      let modeStr = '';
      while (endPos < data.length && /\d/.test(data[endPos])) {
        modeStr += data[endPos];
        endPos++;
      }
      if (modeStr.length > 0 && data.startsWith(DECRQM_SUFFIX, endPos)) {
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }
        queries.push({
          type: 'decrqm',
          startIndex: currentIndex,
          endIndex: endPos + DECRQM_SUFFIX.length,
          mode: parseInt(modeStr, 10),
        });
        currentIndex = endPos + DECRQM_SUFFIX.length;
        textStart = currentIndex;
        continue;
      }
    }

    // Check for Kitty Keyboard Protocol Query - ESC[?u
    if (data.startsWith(KITTY_KEYBOARD_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'kitty-keyboard',
        startIndex: currentIndex,
        endIndex: currentIndex + KITTY_KEYBOARD_QUERY.length,
      });
      currentIndex += KITTY_KEYBOARD_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for XTGETTCAP (Termcap Query) - DCS+qXXXX...ST or DCS+qXXXX...BEL
    if (data.startsWith(XTGETTCAP_PREFIX, currentIndex)) {
      // Find the terminator (ST = ESC\ or BEL)
      let endPos = currentIndex + XTGETTCAP_PREFIX.length;
      let terminated = false;
      let terminatorLen = 0;
      while (endPos < data.length) {
        if (data[endPos] === BEL) {
          terminated = true;
          terminatorLen = 1;
          break;
        }
        if (data.startsWith(ST, endPos)) {
          terminated = true;
          terminatorLen = ST.length;
          break;
        }
        endPos++;
      }
      if (terminated) {
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }
        // Extract capability names (hex-encoded, separated by ;)
        const capsHex = data.slice(currentIndex + XTGETTCAP_PREFIX.length, endPos);
        const capabilities = capsHex.split(';').filter(s => s.length > 0);
        queries.push({
          type: 'xtgettcap',
          startIndex: currentIndex,
          endIndex: endPos + terminatorLen,
          capabilities,
        });
        currentIndex = endPos + terminatorLen;
        textStart = currentIndex;
        continue;
      }
    }

    // Check for OSC foreground color query (ESC]10;? with BEL or ST terminator)
    if (data.startsWith(OSC_FG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_BEL.length,
      });
      currentIndex += OSC_FG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_FG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_ST.length,
      });
      currentIndex += OSC_FG_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC background color query (ESC]11;? with BEL or ST terminator)
    if (data.startsWith(OSC_BG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_BEL.length,
      });
      currentIndex += OSC_BG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_BG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_ST.length,
      });
      currentIndex += OSC_BG_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    currentIndex++;
  }

  // Add remaining text
  if (textStart < data.length) {
    textSegments.push(data.slice(textStart));
  }

  return { textSegments, queries };
}

/**
 * Generate a CPR (Cursor Position Report) response
 * Format: ESC[row;colR (1-based positions)
 */
export function generateCprResponse(row: number, col: number): string {
  // Convert to 1-based positions for the response
  return `${ESC}[${row + 1};${col + 1}R`;
}

/**
 * Generate a Device Status OK response
 * Format: ESC[0n
 */
export function generateStatusOkResponse(): string {
  return `${ESC}[0n`;
}

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

/**
 * Generate an XTVERSION response
 * Format: DCS > | name(version) ST
 */
export function generateXtversionResponse(name: string, version: string): string {
  return `${DCS}>|${name}(${version})${ST}`;
}

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
 * Generate an XTGETTCAP response for a single capability
 * Format: DCS 1 + r name=value ST (valid) or DCS 0 + r ST (invalid)
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

/**
 * Generate a Kitty Keyboard Protocol Query response
 * Format: ESC[?flags u
 * flags is a bitmask of enabled features (0 = legacy mode)
 */
export function generateKittyKeyboardResponse(flags: number): string {
  return `${ESC}[?${flags}u`;
}

/**
 * Convert string to hex encoding (2 hex digits per character)
 */
function stringToHex(str: string): string {
  return Array.from(str).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to regular string
 */
function hexToString(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}

/**
 * Terminal Query Passthrough handler for a PTY session
 *
 * Intercepts DSR and OSC queries from PTY output, generates responses using
 * cursor position and colors from the emulator, and writes them back to the PTY.
 */
// Known termcap/terminfo capabilities we can respond to
const KNOWN_CAPABILITIES: Record<string, string> = {
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

// Known DEC private modes and their default states
// 0 = not recognized, 1 = set, 2 = reset, 3 = permanently set, 4 = permanently reset
const KNOWN_MODES: Record<number, 0 | 1 | 2 | 3 | 4> = {
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
};

export class DsrPassthrough {
  private ptyWriter: ((data: string) => void) | null = null;
  private cursorGetter: (() => { x: number; y: number }) | null = null;
  private colorsGetter: (() => { foreground: number; background: number }) | null = null;
  private modeGetter: ((mode: number) => boolean | null) | null = null;
  private kittyKeyboardFlags: number = 0;
  private terminalVersion: string = '0.1.0';

  constructor() {}

  /**
   * Set the PTY writer function (called to write responses back to PTY)
   */
  setPtyWriter(writer: (data: string) => void): void {
    this.ptyWriter = writer;
  }

  /**
   * Set the cursor getter function (called to get current cursor position)
   */
  setCursorGetter(getter: () => { x: number; y: number }): void {
    this.cursorGetter = getter;
  }

  /**
   * Set the colors getter function (called to get terminal colors for OSC queries)
   * Colors should be in 0xRRGGBB format
   */
  setColorsGetter(getter: () => { foreground: number; background: number }): void {
    this.colorsGetter = getter;
  }

  /**
   * Set the mode getter function (called to get DEC private mode state)
   * Returns true if set, false if reset, null if unknown
   */
  setModeGetter(getter: (mode: number) => boolean | null): void {
    this.modeGetter = getter;
  }

  /**
   * Set the Kitty keyboard protocol flags
   */
  setKittyKeyboardFlags(flags: number): void {
    this.kittyKeyboardFlags = flags;
  }

  /**
   * Set the terminal version string for XTVERSION responses
   */
  setTerminalVersion(version: string): void {
    this.terminalVersion = version;
  }

  /**
   * Process PTY data, intercepting terminal queries and generating responses
   * Returns the data to send to the emulator (without queries)
   */
  process(data: string): string {
    const result = parseDsrQueries(data);

    // Handle queries
    if (result.queries.length > 0) {
      for (const query of result.queries) {
        this.handleQuery(query);
      }
    }

    // Return text segments joined (without queries)
    return result.textSegments.join('');
  }

  /**
   * Handle a query by generating and sending the appropriate response
   */
  private handleQuery(query: DsrQuery): void {
    if (!this.ptyWriter) return;

    if (query.type === 'cpr') {
      // Get cursor position from emulator
      const cursor = this.cursorGetter?.() ?? { x: 0, y: 0 };
      const response = generateCprResponse(cursor.y, cursor.x);
      this.ptyWriter(response);
    } else if (query.type === 'status') {
      // Device is OK
      const response = generateStatusOkResponse();
      this.ptyWriter(response);
    } else if (query.type === 'osc-fg') {
      // Get foreground color
      const colors = this.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
      const r = (colors.foreground >> 16) & 0xFF;
      const g = (colors.foreground >> 8) & 0xFF;
      const b = colors.foreground & 0xFF;
      const response = generateOscFgResponse(r, g, b);
      this.ptyWriter(response);
    } else if (query.type === 'da1') {
      // Primary Device Attributes - report VT220 capabilities
      const response = generateDa1Response();
      this.ptyWriter(response);
    } else if (query.type === 'da2') {
      // Secondary Device Attributes - report VT500 type
      const response = generateDa2Response();
      this.ptyWriter(response);
    } else if (query.type === 'da3') {
      // Tertiary Device Attributes - report unit ID
      const response = generateDa3Response();
      this.ptyWriter(response);
    } else if (query.type === 'xtversion') {
      // Terminal version query
      const response = generateXtversionResponse('openmux', this.terminalVersion);
      this.ptyWriter(response);
    } else if (query.type === 'decrqm') {
      // Request DEC private mode
      const mode = query.mode ?? 0;
      let value: 0 | 1 | 2 | 3 | 4 = 0; // Default to "not recognized"

      // First check if we have a mode getter that can provide live state
      if (this.modeGetter) {
        const state = this.modeGetter(mode);
        if (state !== null) {
          value = state ? 1 : 2; // 1 = set, 2 = reset
        } else if (mode in KNOWN_MODES) {
          value = KNOWN_MODES[mode];
        }
      } else if (mode in KNOWN_MODES) {
        value = KNOWN_MODES[mode];
      }

      const response = generateDecrpmResponse(mode, value);
      this.ptyWriter(response);
    } else if (query.type === 'xtgettcap') {
      // Termcap/terminfo query
      const caps = new Map<string, string | null>();
      for (const hexName of query.capabilities ?? []) {
        const name = hexToString(hexName);
        if (name in KNOWN_CAPABILITIES) {
          caps.set(name, KNOWN_CAPABILITIES[name]);
        } else {
          caps.set(name, null); // Unknown capability
        }
      }
      const response = generateXtgettcapResponse(caps);
      this.ptyWriter(response);
    } else if (query.type === 'kitty-keyboard') {
      // Kitty keyboard protocol query
      const response = generateKittyKeyboardResponse(this.kittyKeyboardFlags);
      this.ptyWriter(response);
    } else if (query.type === 'osc-bg') {
      // Get background color
      const colors = this.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
      const r = (colors.background >> 16) & 0xFF;
      const g = (colors.background >> 8) & 0xFF;
      const b = colors.background & 0xFF;
      const response = generateOscBgResponse(r, g, b);
      this.ptyWriter(response);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.ptyWriter = null;
    this.cursorGetter = null;
    this.colorsGetter = null;
    this.modeGetter = null;
  }
}
