/**
 * Terminal Capabilities Detection and Forwarding
 *
 * Queries the host terminal for its capabilities at startup
 * and responds to capability queries from child processes.
 *
 * This enables apps running inside openmux panes to detect
 * that the host terminal supports Kitty graphics, etc.
 */

import { queryHostColors, type TerminalColors } from './terminal-colors';

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
  /** Whether true color is supported */
  trueColor: boolean;
  /** Whether terminal supports OSC 997 color scheme events (Kitty, Ghostty, iTerm2) */
  colorSchemeEvents: boolean;
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
    trueColor: false,
    colorSchemeEvents: false,
    colors: null,
  };

  // Check environment variables for terminal hints
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  const colorterm = process.env.COLORTERM || '';

  // Detect terminal from environment and check for OSC 997 support
  if (termProgram.toLowerCase().includes('ghostty')) {
    capabilities.terminalName = 'ghostty';
    capabilities.kittyGraphics = true; // Ghostty supports Kitty graphics
    capabilities.trueColor = true;
    capabilities.colorSchemeEvents = true; // Ghostty supports OSC 997
  } else if (termProgram.toLowerCase().includes('kitty')) {
    capabilities.terminalName = 'kitty';
    capabilities.kittyGraphics = true;
    capabilities.trueColor = true;
    capabilities.colorSchemeEvents = true; // Kitty invented OSC 997
  } else if (termProgram.toLowerCase() === 'iterm.app') {
    capabilities.terminalName = 'iterm2';
    capabilities.trueColor = true;
    // iTerm2 added OSC 997 support in version 3.5.0
    const itermVersion = process.env.TERM_PROGRAM_VERSION;
    capabilities.colorSchemeEvents = itermVersion ? parseFloat(itermVersion) >= 3.5 : false;
  } else if (termProgram.toLowerCase().includes('wezterm')) {
    capabilities.terminalName = 'wezterm';
    capabilities.kittyGraphics = true;
    capabilities.trueColor = true;
    // WezTerm supports OSC 997
    capabilities.colorSchemeEvents = true;
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
    capabilities.colorSchemeEvents = true;
  }

  // Terminal name detection relies on env vars (TERM, KITTY_WINDOW_ID, etc.) which
  // covers the common cases (iTerm2, Kitty, Ghostty, WezTerm, etc.).
  // Full DA1/DA2 query+parse would require non-blocking stdin at init time and is
  // intentionally deferred (see queryHostColors + host-color-scheme for color probing).

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
 * Update cached host colors in capabilities (if initialized).
 */
export function setHostCapabilitiesColors(colors: TerminalColors): void {
  if (cachedCapabilities) {
    cachedCapabilities.colors = colors;
  }
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
