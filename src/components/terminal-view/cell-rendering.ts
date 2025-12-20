/**
 * Cell Rendering - utilities for rendering terminal cells with styling
 */
import type { RGBA, OptimizedBuffer } from '@opentui/core'
import type { TerminalCell } from '../../core/types'
import {
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
  SELECTION_BG,
  SELECTION_FG,
  SEARCH_MATCH_BG,
  SEARCH_MATCH_FG,
  SEARCH_CURRENT_BG,
  SEARCH_CURRENT_FG,
} from '../../terminal/rendering'

const spaceRowCache = new Map<number, string>()

const getSpaceRow = (cols: number): string => {
  let cached = spaceRowCache.get(cols)
  if (!cached) {
    cached = ' '.repeat(cols)
    spaceRowCache.set(cols, cached)
  }
  return cached
}

export interface SelectedColumnRange {
  start: number
  end: number
}

export interface CellRenderingDeps {
  isCellSelected: (ptyId: string, x: number, y: number) => boolean
  getSelectedColumnsForRow: (ptyId: string, absoluteY: number, rowWidth: number) => SelectedColumnRange | null
  isSearchMatch: (ptyId: string, x: number, y: number) => boolean
  isCurrentMatch: (ptyId: string, x: number, y: number) => boolean
  getSelection: (ptyId: string) => { normalizedRange: unknown } | undefined
  getSearchMatchRanges: (
    ptyId: string,
    absoluteY: number
  ) => Array<{ startCol: number; endCol: number }> | null
}

export interface CellRenderingOptions {
  ptyId: string
  hasSelection: boolean
  hasSearch: boolean
  isAtBottom: boolean
  isFocused: boolean
  cursorX: number
  cursorY: number
  cursorVisible: boolean
  scrollbackLength: number
  viewportOffset: number
  currentMatch: { lineIndex: number; startCol: number; endCol: number } | null
}

/**
 * Render a single terminal cell with appropriate styling
 * Returns the colors to use for the cell
 */
export function getCellColors(
  cell: TerminalCell,
  x: number,
  absoluteY: number,
  screenY: number,
  options: CellRenderingOptions,
  deps: CellRenderingDeps
): { fg: RGBA; bg: RGBA; attributes: number } {
  const { ptyId, hasSelection, hasSearch, isAtBottom, isFocused, cursorX, cursorY, cursorVisible } = options

  // Only show cursor when at bottom (not scrolled back) and focused
  const isCursor = isAtBottom && isFocused && cursorVisible &&
                   cursorY === screenY && cursorX === x

  // Check if cell is selected (skip function call if no active selection)
  const isSelected = hasSelection && deps.isCellSelected(ptyId, x, absoluteY)

  // Check if cell is a search match (skip function calls if no active search)
  const isMatch = hasSearch && deps.isSearchMatch(ptyId, x, absoluteY)
  const isCurrent = hasSearch && deps.isCurrentMatch(ptyId, x, absoluteY)

  // Determine cell colors
  let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b
  let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b

  // Apply dim effect
  if (cell.dim) {
    fgR = Math.floor(fgR * 0.5)
    fgG = Math.floor(fgG * 0.5)
    fgB = Math.floor(fgB * 0.5)
  }

  // Apply inverse (avoid array destructuring for performance)
  if (cell.inverse) {
    const tmpR = fgR; fgR = bgR; bgR = tmpR
    const tmpG = fgG; fgG = bgG; bgG = tmpG
    const tmpB = fgB; fgB = bgB; bgB = tmpB
  }

  let fg = getCachedRGBA(fgR, fgG, fgB)
  let bg = getCachedRGBA(bgR, bgG, bgB)

  // Apply styling in priority order: cursor > selection > current match > other matches
  if (isCursor) {
    // Cursor styling (highest priority when visible)
    fg = bg ?? BLACK
    bg = WHITE
  } else if (isSelected) {
    // Selection styling
    fg = SELECTION_FG
    bg = SELECTION_BG
  } else if (isCurrent) {
    // Current search match (bright yellow)
    fg = SEARCH_CURRENT_FG
    bg = SEARCH_CURRENT_BG
  } else if (isMatch) {
    // Other search matches (orange)
    fg = SEARCH_MATCH_FG
    bg = SEARCH_MATCH_BG
  }

  // Calculate attributes
  let attributes = 0
  if (cell.bold) attributes |= ATTR_BOLD
  if (cell.italic) attributes |= ATTR_ITALIC
  if (cell.underline) attributes |= ATTR_UNDERLINE
  if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

  return { fg, bg, attributes }
}

/**
 * Render a row of terminal cells to the buffer
 */
export function renderRow(
  buffer: OptimizedBuffer,
  row: TerminalCell[] | null,
  rowIndex: number,
  cols: number,
  offsetX: number,
  offsetY: number,
  options: CellRenderingOptions,
  deps: CellRenderingDeps,
  fallbackFg: RGBA,
  fallbackBg: RGBA
): void {
  if (!row) {
    buffer.drawText(getSpaceRow(cols), offsetX, rowIndex + offsetY, fallbackFg, fallbackBg, 0)
    return
  }

  const rowY = rowIndex + offsetY

  const {
    scrollbackLength,
    viewportOffset,
    ptyId,
    hasSelection,
    hasSearch,
    isAtBottom,
    isFocused,
    cursorX,
    cursorY,
    cursorVisible,
    currentMatch,
  } = options

  const needsAbsoluteY = hasSelection || hasSearch
  const absoluteY = needsAbsoluteY ? scrollbackLength - viewportOffset + rowIndex : 0

  // Get selected column range for this row ONCE (O(1) instead of O(cols) function calls)
  const selectedRange = hasSelection ? deps.getSelectedColumnsForRow(ptyId, absoluteY, cols) : null
  const matchRanges = hasSearch ? deps.getSearchMatchRanges(ptyId, absoluteY) : null
  const isCurrentRow = hasSearch && currentMatch?.lineIndex === absoluteY
  const currentMatchStart = isCurrentRow ? currentMatch?.startCol ?? -1 : -1
  const currentMatchEnd = isCurrentRow ? currentMatch?.endCol ?? -1 : -1
  const hasCursor = isAtBottom && isFocused && cursorVisible
  const cursorRow = hasCursor ? cursorY : -1
  const cursorCol = hasCursor ? cursorX : -1
  const hasSelectionRange = selectedRange !== null
  const selectedStart = hasSelectionRange ? selectedRange.start : 0
  const selectedEnd = hasSelectionRange ? selectedRange.end : -1
  let matchIndex = 0
  let activeMatch = matchRanges ? matchRanges[0] ?? null : null

  // Track the previous cell to detect spacer cells after wide characters
  let prevCellWasWide = false
  let prevCellBg: RGBA | null = null
  let lastFgKey = -1
  let lastBgKey = -1
  let lastFg = fallbackFg
  let lastBg = fallbackBg

  for (let x = 0; x < cols; x++) {
    const cell = row[x] ?? null

    if (!cell) {
      // No cell data - use fallback
      buffer.setCell(x + offsetX, rowY, ' ', fallbackFg, fallbackBg, 0)
      prevCellWasWide = false
      prevCellBg = null
      continue
    }

    // If previous cell was wide (width=2), this is a spacer cell
    // Use drawChar with codepoint 0 to mark as continuation without overwriting the wide char
    if (prevCellWasWide && prevCellBg) {
      buffer.drawChar(0, x + offsetX, rowY, prevCellBg, prevCellBg, 0)
      prevCellWasWide = false
      prevCellBg = null
      continue
    }

    // Fast in-range check for selection (simple comparison vs function call)
    const isSelected = hasSelectionRange && x >= selectedStart && x <= selectedEnd

    // Only show cursor when at bottom (not scrolled back) and focused
    const isCursor = cursorRow === rowIndex && cursorCol === x

    let isMatch = false
    let isCurrent = false
    if (hasSearch) {
      // Check if cell is a search match (skip function calls if no active search)
      if (activeMatch && x >= activeMatch.endCol) {
        while (matchRanges && matchIndex < matchRanges.length && x >= matchRanges[matchIndex].endCol) {
          matchIndex++;
        }
        activeMatch = matchRanges?.[matchIndex] ?? null
      }
      isMatch = activeMatch !== null &&
        x >= activeMatch.startCol &&
        x < activeMatch.endCol
      isCurrent = currentMatchStart >= 0 && x >= currentMatchStart && x < currentMatchEnd
    }

    let fg: RGBA
    let bg: RGBA

    if (!isCursor && (isSelected || isCurrent || isMatch)) {
      if (isSelected) {
        fg = SELECTION_FG
        bg = SELECTION_BG
      } else if (isCurrent) {
        fg = SEARCH_CURRENT_FG
        bg = SEARCH_CURRENT_BG
      } else {
        fg = SEARCH_MATCH_FG
        bg = SEARCH_MATCH_BG
      }
    } else {
      // Determine cell colors
      let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b
      let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b

      // Apply dim effect
      if (cell.dim) {
        fgR = Math.floor(fgR * 0.5)
        fgG = Math.floor(fgG * 0.5)
        fgB = Math.floor(fgB * 0.5)
      }

      // Apply inverse (avoid array destructuring for performance)
      if (cell.inverse) {
        const tmpR = fgR; fgR = bgR; bgR = tmpR
        const tmpG = fgG; fgG = bgG; bgG = tmpG
        const tmpB = fgB; fgB = bgB; bgB = tmpB
      }

      const fgKey = (fgR << 16) | (fgG << 8) | fgB
      const bgKey = (bgR << 16) | (bgG << 8) | bgB

      if (fgKey === lastFgKey) {
        fg = lastFg
      } else {
        fg = getCachedRGBA(fgR, fgG, fgB)
        lastFgKey = fgKey
        lastFg = fg
      }

      if (bgKey === lastBgKey) {
        bg = lastBg
      } else {
        bg = getCachedRGBA(bgR, bgG, bgB)
        lastBgKey = bgKey
        lastBg = bg
      }

      if (isCursor) {
        // Cursor styling (highest priority when visible)
        fg = bg ?? BLACK
        bg = WHITE
      } else if (isSelected) {
        // Selection styling
        fg = SELECTION_FG
        bg = SELECTION_BG
      } else if (isCurrent) {
        // Current search match (bright yellow)
        fg = SEARCH_CURRENT_FG
        bg = SEARCH_CURRENT_BG
      } else if (isMatch) {
        // Other search matches (orange)
        fg = SEARCH_MATCH_FG
        bg = SEARCH_MATCH_BG
      }
    }

    // Calculate attributes
    let attributes = 0
    if (cell.bold) attributes |= ATTR_BOLD
    if (cell.italic) attributes |= ATTR_ITALIC
    if (cell.underline) attributes |= ATTR_UNDERLINE
    if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

    // Write cell directly to buffer (with offset for pane position)
    // Use fallback space if char is empty to ensure cell is always overwritten
    buffer.setCell(x + offsetX, rowY, cell.char || ' ', fg, bg, attributes)

    // Track if this cell was wide for next iteration
    prevCellWasWide = cell.width === 2
    prevCellBg = prevCellWasWide ? bg : null
  }
}
