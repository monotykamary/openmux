/**
 * Terminal Capabilities Detection and Forwarding
 *
 * Queries the host terminal for its capabilities at startup
 * and responds to capability queries from child processes.
 *
 * This enables apps running inside openmux panes to detect
 * that the host terminal supports Kitty graphics, Sixel, etc.
 */

import { queryHostColors, type TerminalColors } from './terminal-colors';

const ESC = '\x1b';

// Query sequences that child apps may send
const DA1_QUERY = `${ESC}[c`; // Primary Device Attributes
const DA2_QUERY = `${ESC}[>c`; // Secondary Device Attributes
const XTVERSION_QUERY = `${ESC}[>0q`; // Terminal version query

// Kitty graphics query (check if host supports it)
const KITTY_GRAPHICS_QUERY = `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`;

export interface TerminalCapabilities {
  /** Host terminal name (e.g., "ghostty", "kitty", "iterm2") */
  terminalName: string | null;
  /** Primary Device Attributes response */
  da1Response: string | null;
  /** Secondary Device Attributes response */
  da2Response: string | null;
  /** XTVERSION response */
  xtversionResponse: string | null;
  /** Whether Kitty graphics is supported */
  kittyGraphics: boolean;
  /** Whether Sixel is supported */
  sixel: boolean;
  /** Whether true color is supported */
  trueColor: boolean;
  /** Queried terminal colors (foreground, background, palette) */
  colors: TerminalColors | null;
}

let cachedCapabilities: TerminalCapabilities | null = null;

/**
 * Query host terminal for capabilities
 * This should be called once at startup before PTYs are created
 */
export async function detectHostCapabilities(): Promise<TerminalCapabilities> {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const capabilities: TerminalCapabilities = {
    terminalName: null,
    da1Response: null,
    da2Response: null,
    xtversionResponse: null,
    kittyGraphics: false,
    sixel: false,
    trueColor: false,
    colors: null,
  };

  // Check environment variables for terminal hints
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  const colorterm = process.env.COLORTERM || '';

  // Detect terminal from environment
  if (termProgram.toLowerCase().includes('ghostty')) {
    capabilities.terminalName = 'ghostty';
    capabilities.kittyGraphics = true; // Ghostty supports Kitty graphics
    capabilities.trueColor = true;
  } else if (termProgram.toLowerCase().includes('kitty')) {
    capabilities.terminalName = 'kitty';
    capabilities.kittyGraphics = true;
    capabilities.trueColor = true;
  } else if (termProgram.toLowerCase() === 'iterm.app') {
    capabilities.terminalName = 'iterm2';
    capabilities.sixel = true; // iTerm2 supports Sixel
    capabilities.trueColor = true;
  } else if (termProgram.toLowerCase().includes('wezterm')) {
    capabilities.terminalName = 'wezterm';
    capabilities.kittyGraphics = true;
    capabilities.sixel = true;
    capabilities.trueColor = true;
  } else if (term.includes('256color') || term.includes('truecolor')) {
    capabilities.trueColor = true;
  }

  // Check COLORTERM for truecolor
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    capabilities.trueColor = true;
  }

  // Check KITTY_WINDOW_ID for Kitty
  if (process.env.KITTY_WINDOW_ID) {
    capabilities.terminalName = 'kitty';
    capabilities.kittyGraphics = true;
    capabilities.trueColor = true;
  }

  // TODO: For more accurate detection, we could:
  // 1. Send DA1/DA2 queries to stdout
  // 2. Read responses from stdin
  // 3. Parse the responses
  // However, this requires async stdin reading which can be complex
  // For now, we rely on environment variables which covers most cases

  // Query terminal colors (foreground, background, palette)
  // This allows openmux to inherit the user's color scheme
  capabilities.colors = await queryHostColors(500);

  cachedCapabilities = capabilities;
  return capabilities;
}

/**
 * Get cached capabilities (must call detectHostCapabilities first)
 */
export function getHostCapabilities(): TerminalCapabilities | null {
  return cachedCapabilities;
}

/**
 * Check if a sequence is a capability query
 */
export function isCapabilityQuery(data: string): boolean {
  return (
    data.includes(DA1_QUERY) ||
    data.includes(DA2_QUERY) ||
    data.includes(XTVERSION_QUERY)
  );
}

/**
 * Generate response for a capability query based on host capabilities
 * This allows child apps to "see through" openmux to the host terminal
 */
export function generateCapabilityResponse(query: string): string | null {
  const caps = cachedCapabilities;
  if (!caps) return null;

  // For now, we forward the host terminal's identity
  // In a full implementation, we'd store and replay the actual DA1/DA2 responses

  if (query.includes(DA1_QUERY)) {
    // Generate a DA1 response indicating our capabilities
    // Format: ESC [ ? <params> c
    // Common params: 1 (132 columns), 4 (Sixel), 6 (selective erase)
    // For Kitty: adds 4 (Sixel graphics)
    let params = '1;2'; // Base VT100/VT220 compatibility
    if (caps.sixel) {
      params += ';4'; // Sixel graphics
    }
    return `${ESC}[?${params}c`;
  }

  if (query.includes(DA2_QUERY)) {
    // Generate a DA2 response
    // Format: ESC [ > <terminal_type> ; <version> ; <options> c
    if (caps.terminalName === 'ghostty') {
      return `${ESC}[>1;1;0c`; // VT100-style response
    } else if (caps.terminalName === 'kitty') {
      return `${ESC}[>1;1;0c`;
    }
    return `${ESC}[>0;0;0c`; // Generic response
  }

  if (query.includes(XTVERSION_QUERY)) {
    // XTVERSION response - identify as the host terminal
    if (caps.terminalName) {
      return `${ESC}P>|${caps.terminalName}${ESC}\\`;
    }
    return null;
  }

  return null;
}

/**
 * Process input from child PTY, looking for capability queries
 * Returns the data with queries handled (responses written to PTY)
 */
export function processCapabilityQueries(
  data: string,
  writeResponse: (response: string) => void
): string {
  // Check for capability queries
  if (data.includes(DA1_QUERY)) {
    const response = generateCapabilityResponse(DA1_QUERY);
    if (response) {
      writeResponse(response);
    }
  }

  if (data.includes(DA2_QUERY)) {
    const response = generateCapabilityResponse(DA2_QUERY);
    if (response) {
      writeResponse(response);
    }
  }

  if (data.includes(XTVERSION_QUERY)) {
    const response = generateCapabilityResponse(XTVERSION_QUERY);
    if (response) {
      writeResponse(response);
    }
  }

  // Return original data - we don't strip queries as they may be needed
  // by the PTY for other purposes
  return data;
}

/**
 * Forward environment variables that indicate terminal capabilities
 * These should be set in the PTY environment so child apps can detect them
 */
export function getCapabilityEnvironment(): Record<string, string> {
  const caps = cachedCapabilities;
  if (!caps) return {};

  const env: Record<string, string> = {};

  // Forward TERM_PROGRAM if detected
  if (caps.terminalName) {
    // Don't override TERM_PROGRAM, but set our own hint
    env.OPENMUX_HOST_TERMINAL = caps.terminalName;
  }

  // Ensure COLORTERM is set for truecolor
  if (caps.trueColor) {
    env.COLORTERM = 'truecolor';
  }

  // Kitty-specific env vars
  if (caps.kittyGraphics && process.env.KITTY_WINDOW_ID) {
    env.KITTY_WINDOW_ID = process.env.KITTY_WINDOW_ID;
  }

  return env;
}
