/**
 * Shared terminal rendering utilities
 * Used by TerminalView and AggregateView's InteractivePreview
 */

import { RGBA } from '@opentui/core';

// =============================================================================
// RGBA Color Cache
// =============================================================================

/** White color constant */
export const WHITE = RGBA.fromInts(255, 255, 255);

/** Black color constant */
export const BLACK = RGBA.fromInts(0, 0, 0);

/**
 * RGBA cache to avoid per-cell allocations (internal implementation detail)
 * Map key is (r << 16) | (g << 8) | b
 */
const RGBA_CACHE = new Map<number, RGBA>();

// Pre-populate common colors
RGBA_CACHE.set(0x000000, BLACK);
RGBA_CACHE.set(0xFFFFFF, WHITE);

/**
 * Get a cached RGBA instance for given RGB values.
 * Creates and caches if not present.
 */
export function getCachedRGBA(r: number, g: number, b: number): RGBA {
  // Fast path for black/white
  if ((r | g | b) === 0) return BLACK;
  if (r === 255 && g === 255 && b === 255) return WHITE;

  const key = (r << 16) | (g << 8) | b;
  let cached = RGBA_CACHE.get(key);
  if (!cached) {
    cached = RGBA.fromInts(r, g, b);
    RGBA_CACHE.set(key, cached);
  }
  return cached;
}

// =============================================================================
// Text Attributes
// =============================================================================

/** Bold text attribute flag */
export const ATTR_BOLD = 1;

/** Italic text attribute flag */
export const ATTR_ITALIC = 4;

/** Underline text attribute flag */
export const ATTR_UNDERLINE = 8;

/** Strikethrough text attribute flag */
export const ATTR_STRIKETHROUGH = 128;

// =============================================================================
// UI Colors (Scrollbar, Selection, Search)
// =============================================================================

/** Scrollbar track color */
export const SCROLLBAR_TRACK = RGBA.fromInts(40, 40, 40);

/** Scrollbar thumb color */
export const SCROLLBAR_THUMB = RGBA.fromInts(100, 100, 100);

/** Selection background color */
export const SELECTION_BG = RGBA.fromInts(80, 120, 200);

/** Selection foreground color */
export const SELECTION_FG = RGBA.fromInts(255, 255, 255);

/** Search match background color (muted brown for other matches) */
export const SEARCH_MATCH_BG = RGBA.fromInts(100, 80, 60);

/** Search match foreground color (light tan text) */
export const SEARCH_MATCH_FG = RGBA.fromInts(200, 180, 160);

/** Current search match background color (bright magenta/pink) */
export const SEARCH_CURRENT_BG = RGBA.fromInts(255, 50, 150);

/** Current search match foreground color (white text) */
export const SEARCH_CURRENT_FG = RGBA.fromInts(255, 255, 255);
