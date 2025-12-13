/**
 * Scroll utility functions for terminal viewport management.
 * Extracted for testability and reuse.
 */

/**
 * Clamp a scroll offset to valid range [0, maxOffset].
 * Prevents momentum accumulation at scroll boundaries.
 */
export function clampScrollOffset(offset: number, maxOffset: number): number {
  return Math.max(0, Math.min(offset, maxOffset));
}

/**
 * Calculate new scroll offset from current offset and delta.
 * Returns clamped value to prevent boundary overflow.
 *
 * @param currentOffset - Current viewport offset (0 = at bottom)
 * @param delta - Scroll delta (positive = scroll up into history, negative = scroll down)
 * @param scrollbackLength - Maximum scrollback available
 * @returns Clamped new offset
 */
export function calculateScrollDelta(
  currentOffset: number,
  delta: number,
  scrollbackLength: number
): number {
  const newOffset = currentOffset + delta;
  return clampScrollOffset(newOffset, scrollbackLength);
}

/**
 * Check if viewport is at the bottom (showing live content).
 */
export function isAtBottom(viewportOffset: number): boolean {
  return viewportOffset <= 0;
}

/**
 * Check if viewport is at the top (fully scrolled back).
 */
export function isAtTop(viewportOffset: number, scrollbackLength: number): boolean {
  return viewportOffset >= scrollbackLength;
}
