/**
 * Terminal Color Detection Module
 *
 * Detects terminal colors from environment variables.
 * This enables openmux to inherit the user's terminal theme.
 *
 * Note: OSC-based color queries are not used because they would
 * interfere with the TUI's stdin handling. In the future, we could
 * do OSC queries before the TUI starts (e.g., in a pre-init phase).
 */

/**
 * Terminal color information
 */
export interface TerminalColors {
  /** Foreground color in 0xRRGGBB format */
  foreground: number;
  /** Background color in 0xRRGGBB format */
  background: number;
  /** 256-color palette, each in 0xRRGGBB format */
  palette: number[];
  /** True if using fallback defaults */
  isDefault: boolean;
}

let cachedColors: TerminalColors | null = null;

/**
 * Generate the standard 256-color palette
 * Colors 0-15: ANSI colors (from base16 or defaults)
 * Colors 16-231: 6x6x6 color cube
 * Colors 232-255: Grayscale ramp
 */
function generate256Palette(base16?: number[]): number[] {
  const palette: number[] = [];

  // Colors 0-15: ANSI colors
  const defaultBase16 = [
    0x000000, // 0: black
    0xCD0000, // 1: red
    0x00CD00, // 2: green
    0xCDCD00, // 3: yellow
    0x0000EE, // 4: blue
    0xCD00CD, // 5: magenta
    0x00CDCD, // 6: cyan
    0xE5E5E5, // 7: white
    0x7F7F7F, // 8: bright black
    0xFF0000, // 9: bright red
    0x00FF00, // 10: bright green
    0xFFFF00, // 11: bright yellow
    0x5C5CFF, // 12: bright blue
    0xFF00FF, // 13: bright magenta
    0x00FFFF, // 14: bright cyan
    0xFFFFFF, // 15: bright white
  ];

  for (let i = 0; i < 16; i++) {
    palette.push(base16?.[i] ?? defaultBase16[i]);
  }

  // Colors 16-231: 6x6x6 color cube
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const rv = r ? 55 + r * 40 : 0;
        const gv = g ? 55 + g * 40 : 0;
        const bv = b ? 55 + b * 40 : 0;
        palette.push((rv << 16) | (gv << 8) | bv);
      }
    }
  }

  // Colors 232-255: Grayscale ramp
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push((v << 16) | (v << 8) | v);
  }

  return palette;
}

/**
 * Marker color for "default" background - slightly off-black (0,0,1)
 * This allows us to distinguish between:
 * - Default background (should be transparent): rgb(0,0,1)
 * - Explicit black set by programs like htop: rgb(0,0,0)
 *
 * The difference is imperceptible but lets us detect which cells
 * should be transparent vs which have intentional black backgrounds.
 */
export const DEFAULT_BG_MARKER = 0x000001; // rgb(0,0,1)

/**
 * Get default colors (used as fallback)
 */
export function getDefaultColors(): TerminalColors {
  return {
    foreground: 0xFFFFFF,
    background: DEFAULT_BG_MARKER, // Use marker instead of pure black
    palette: generate256Palette(),
    isDefault: true,
  };
}

/**
 * Query host terminal for its color scheme
 *
 * Currently uses environment-based detection since OSC queries would
 * interfere with the TUI's stdin handling. In the future, we could
 * do OSC queries before the TUI starts.
 *
 * @param _timeoutMs Timeout in milliseconds (unused, for API compatibility)
 * @returns Terminal colors (currently always returns defaults or env-based)
 */
export async function queryHostColors(_timeoutMs: number = 500): Promise<TerminalColors> {
  // Return cached if available
  if (cachedColors) {
    return cachedColors;
  }

  // For now, use environment-based color detection instead of OSC queries
  // OSC queries manipulate stdin which breaks TUI input handling
  cachedColors = detectColorsFromEnvironment();
  return cachedColors;
}

/**
 * Detect terminal colors from environment variables
 * Uses COLORFGBG if available, otherwise returns defaults
 */
function detectColorsFromEnvironment(): TerminalColors {
  // Check COLORFGBG (format: "fg;bg" e.g., "15;0" for white on black)
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const fgIndex = parseInt(parts[0], 10);
      const bgIndex = parseInt(parts[parts.length - 1], 10);

      // Map ANSI color index to RGB
      const defaultPalette = generate256Palette();
      const fg = (fgIndex >= 0 && fgIndex < 256) ? defaultPalette[fgIndex] : 0xFFFFFF;
      const bg = (bgIndex >= 0 && bgIndex < 256) ? defaultPalette[bgIndex] : 0x000000;

      return {
        foreground: fg,
        background: bg,
        palette: defaultPalette,
        isDefault: false,
      };
    }
  }

  // Check for common dark/light theme indicators
  const colorScheme = process.env.TERM_BACKGROUND || process.env.COLORTHEME;
  if (colorScheme === 'light') {
    return {
      foreground: 0x000000,
      background: 0xFFFFFF,
      palette: generate256Palette(),
      isDefault: false,
    };
  }

  // Default to dark theme
  return getDefaultColors();
}

/**
 * Get cached colors (must call queryHostColors first)
 */
export function getHostColors(): TerminalColors | null {
  return cachedColors;
}

/**
 * Set colors directly (for testing or manual override)
 */
export function setHostColors(colors: TerminalColors): void {
  cachedColors = colors;
}

/**
 * Clear cached colors (mainly for testing)
 */
export function clearColorCache(): void {
  cachedColors = null;
}

/**
 * Extract RGB components from 0xRRGGBB color
 */
export function extractRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xFF,
    g: (color >> 8) & 0xFF,
    b: color & 0xFF,
  };
}
