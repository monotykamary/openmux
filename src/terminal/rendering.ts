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
 * RGBA cache to avoid per-cell allocations
 * Map key is (r << 16) | (g << 8) | b
 */
export const RGBA_CACHE = new Map<number, RGBA>();

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

/** Dim text attribute flag */
export const ATTR_DIM = 2;

/** Italic text attribute flag */
export const ATTR_ITALIC = 4;

/** Underline text attribute flag */
export const ATTR_UNDERLINE = 8;

/** Strikethrough text attribute flag */
export const ATTR_STRIKETHROUGH = 128;

/**
 * Calculate combined attributes from a terminal cell
 */
export function calculateAttributes(cell: {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}): number {
  let attributes = 0;
  if (cell.bold) attributes |= ATTR_BOLD;
  if (cell.dim) attributes |= ATTR_DIM;
  if (cell.italic) attributes |= ATTR_ITALIC;
  if (cell.underline) attributes |= ATTR_UNDERLINE;
  if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;
  return attributes;
}
