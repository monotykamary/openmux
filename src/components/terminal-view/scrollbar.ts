/**
 * Scrollbar Rendering - renders the scrollbar overlay for terminal
 */
import type { RGBA, OptimizedBuffer } from '@opentui/core'
import type { TerminalCell } from '../../core/types'
import {
  getCachedRGBA,
  SCROLLBAR_TRACK,
  SCROLLBAR_THUMB,
} from '../../terminal/rendering'

export interface ScrollbarOptions {
  viewportOffset: number
  scrollbackLength: number
  rows: number
  cols: number
  width: number
  offsetX: number
  offsetY: number
}

/**
 * Render scrollbar when scrolled back (not at bottom)
 * Uses semi-transparent overlay to preserve underlying content visibility
 */
export function renderScrollbar(
  buffer: OptimizedBuffer,
  rowCache: (TerminalCell[] | null)[],
  options: ScrollbarOptions,
  fallbackFg: RGBA
): void {
  const { viewportOffset, scrollbackLength, rows, cols, width, offsetX, offsetY } = options

  // Don't render if at bottom or no scrollback
  if (viewportOffset === 0 || scrollbackLength === 0) {
    return
  }

  const totalLines = scrollbackLength + rows
  const thumbHeight = Math.max(1, Math.floor(rows * rows / totalLines))
  const scrollRange = rows - thumbHeight
  // Position: 0 at top (fully scrolled back), scrollRange at bottom (at live terminal)
  const thumbPosition = Math.floor((1 - viewportOffset / scrollbackLength) * scrollRange)

  // Render scrollbar on the rightmost column
  // Preserve underlying character but apply scrollbar background tint
  const scrollbarX = offsetX + width - 1
  const contentCol = cols - 1 // Last column in terminal content

  for (let y = 0; y < rows; y++) {
    const isThumb = y >= thumbPosition && y < thumbPosition + thumbHeight
    // Get the underlying cell to preserve its character
    const row = rowCache[y]
    const cell = contentCol >= 0 ? row?.[contentCol] : null
    const underlyingChar = cell?.char || ' '
    const underlyingFg = cell ? getCachedRGBA(cell.fg.r, cell.fg.g, cell.fg.b) : fallbackFg

    const codepoint = underlyingChar.codePointAt(0) ?? 0x20
    if (codepoint > 0x7f) {
      buffer.drawChar(
        codepoint,
        scrollbarX,
        y + offsetY,
        underlyingFg,
        isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
        0
      )
    } else {
      buffer.setCell(
        scrollbarX,
        y + offsetY,
        underlyingChar,
        underlyingFg,
        isThumb ? SCROLLBAR_THUMB : SCROLLBAR_TRACK,
        0
      )
    }
  }
}
