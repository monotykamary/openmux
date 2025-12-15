/**
 * Terminal color bridge functions
 * Provides access to host terminal colors
 */

import { getHostColors, extractRgb } from "../../terminal/terminal-colors"

/**
 * Get the host terminal's background color as a hex string.
 * Returns the cached color if available, otherwise returns a default.
 */
export function getHostBackgroundColor(): string {
  const colors = getHostColors()
  if (colors) {
    const rgb = extractRgb(colors.background)
    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
  }
  // Default dark background if no host colors detected
  return '#000000'
}

/**
 * Get the host terminal's foreground color as a hex string.
 * Returns the cached color if available, otherwise returns a default.
 */
export function getHostForegroundColor(): string {
  const colors = getHostColors()
  if (colors) {
    const rgb = extractRgb(colors.foreground)
    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
  }
  // Default white foreground if no host colors detected
  return '#ffffff'
}
