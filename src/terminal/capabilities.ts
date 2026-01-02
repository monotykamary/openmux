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
    capabilities.trueColor = true;
  } else if (termProgram.toLowerCase().includes('wezterm')) {
    capabilities.terminalName = 'wezterm';
    capabilities.kittyGraphics = true;
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
