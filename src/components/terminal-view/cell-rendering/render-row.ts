import type { RGBA, OptimizedBuffer } from '@opentui/core'
import type { TerminalCell } from '../../../core/types'
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
} from '../../../terminal/rendering'
import { renderPackedRow, type RowRenderCache } from './packed-row'
import type { CellRenderingDeps, CellRenderingOptions } from './types'

const spaceRowCache = new Map<number, string>()

const getSpaceRow = (cols: number): string => {
  let cached = spaceRowCache.get(cols)
  if (!cached) {
    cached = ' '.repeat(cols)
    spaceRowCache.set(cols, cached)
  }
  return cached
}

export function getCellColors(
  cell: TerminalCell,
  x: number,
  absoluteY: number,
  screenY: number,
  options: CellRenderingOptions,
  deps: CellRenderingDeps
): { fg: RGBA; bg: RGBA; attributes: number } {
  const { ptyId, hasSelection, hasSearch, isAtBottom, isFocused, cursorX, cursorY, cursorVisible } = options

  const isCursor = isAtBottom && isFocused && cursorVisible &&
                   cursorY === screenY && cursorX === x

  const isSelected = hasSelection && deps.isCellSelected(ptyId, x, absoluteY)
  const isMatch = hasSearch && deps.isSearchMatch(ptyId, x, absoluteY)
  const isCurrent = hasSearch && deps.isCurrentMatch(ptyId, x, absoluteY)

  let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b
  let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b

  if (cell.dim) {
    fgR = Math.floor(fgR * 0.5)
    fgG = Math.floor(fgG * 0.5)
    fgB = Math.floor(fgB * 0.5)
  }

  if (cell.inverse) {
    const tmpR = fgR; fgR = bgR; bgR = tmpR
    const tmpG = fgG; fgG = bgG; bgG = tmpG
    const tmpB = fgB; fgB = bgB; bgB = tmpB
  }

  let fg = getCachedRGBA(fgR, fgG, fgB)
  let bg = getCachedRGBA(bgR, bgG, bgB)

  if (isCursor) {
    fg = bg ?? BLACK
    bg = WHITE
  } else if (isSelected) {
    fg = SELECTION_FG
    bg = SELECTION_BG
  } else if (isCurrent) {
    fg = SEARCH_CURRENT_FG
    bg = SEARCH_CURRENT_BG
  } else if (isMatch) {
    fg = SEARCH_MATCH_FG
    bg = SEARCH_MATCH_BG
  }

  let attributes = 0
  if (cell.bold) attributes |= ATTR_BOLD
  if (cell.italic) attributes |= ATTR_ITALIC
  if (cell.underline) attributes |= ATTR_UNDERLINE
  if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

  return { fg, bg, attributes }
}

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
  fallbackBg: RGBA,
  cache?: RowRenderCache
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
  const hasMatchRanges = matchRanges ? matchRanges.length > 0 : false
  const rowHasHighlights = cursorRow === rowIndex ||
    hasSelectionRange ||
    hasMatchRanges ||
    (isCurrentRow && currentMatchStart >= 0)
  let matchIndex = 0
  let activeMatch = matchRanges ? matchRanges[0] ?? null : null

  const rowTextCache = cache?.rowText
  if (rowTextCache && !rowHasHighlights) {
    const cached = rowTextCache[rowIndex]
    if (cached) {
      buffer.drawText(cached.text, offsetX, rowY, cached.fg, cached.bg, 0)
      return
    }
  }

  if (cache && !rowHasHighlights) {
    if (renderPackedRow(buffer, row, rowIndex, cols, offsetX, rowY, fallbackFg, fallbackBg, cache)) {
      return
    }
  }

  let prevCellWasWide = false
  let prevCellBg: RGBA | null = null
  let lastFgKey = -1
  let lastBgKey = -1
  let lastFg = fallbackFg
  let lastBg = fallbackBg

  for (let x = 0; x < cols; x++) {
    const cell = row[x] ?? null

    if (!cell) {
      buffer.setCell(x + offsetX, rowY, ' ', fallbackFg, fallbackBg, 0)
      prevCellWasWide = false
      prevCellBg = null
      continue
    }

    if (prevCellWasWide && prevCellBg) {
      buffer.drawChar(0, x + offsetX, rowY, prevCellBg, prevCellBg, 0)
      prevCellWasWide = false
      prevCellBg = null
      continue
    }

    const isSelected = hasSelectionRange && x >= selectedStart && x <= selectedEnd
    const isCursor = cursorRow === rowIndex && cursorCol === x

    let isMatch = false
    let isCurrent = false
    if (hasSearch) {
      if (activeMatch && x >= activeMatch.endCol) {
        while (matchRanges && matchIndex < matchRanges.length && x >= matchRanges[matchIndex].endCol) {
          matchIndex++
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
      let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b
      let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b

      if (cell.dim) {
        fgR = Math.floor(fgR * 0.5)
        fgG = Math.floor(fgG * 0.5)
        fgB = Math.floor(fgB * 0.5)
      }

      if (cell.inverse) {
        const tmpR = fgR; fgR = bgR; bgR = tmpR
        const tmpG = fgG; fgG = bgG; bgG = tmpG
        const tmpB = fgB; fgB = bgB; bgB = tmpB
      }

      const fgKey = (fgR << 16) | (fgG << 8) | fgB
      if (fgKey === lastFgKey) {
        fg = lastFg
      } else {
        fg = getCachedRGBA(fgR, fgG, fgB)
        lastFgKey = fgKey
        lastFg = fg
      }

      const bgKey = (bgR << 16) | (bgG << 8) | bgB
      if (bgKey === lastBgKey) {
        bg = lastBg
      } else {
        bg = getCachedRGBA(bgR, bgG, bgB)
        lastBgKey = bgKey
        lastBg = bg
      }
    }

    let attributes = 0
    if (cell.bold) attributes |= ATTR_BOLD
    if (cell.italic) attributes |= ATTR_ITALIC
    if (cell.underline) attributes |= ATTR_UNDERLINE
    if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

    const char = cell.char || ' '
    const codepoint = char.codePointAt(0) ?? 0x20
    if (codepoint > 0x7f) {
      buffer.drawChar(codepoint, x + offsetX, rowY, fg, bg, attributes)
    } else {
      buffer.setCell(x + offsetX, rowY, char, fg, bg, attributes)
    }

    if (cell.width === 2) {
      prevCellWasWide = true
      prevCellBg = bg
    } else {
      prevCellWasWide = false
      prevCellBg = null
    }
  }
}
