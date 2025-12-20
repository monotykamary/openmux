/**
 * Cell Rendering - utilities for rendering terminal cells with styling
 */
import type { RGBA, OptimizedBuffer } from '@opentui/core'
import { ptr } from 'bun:ffi'
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

const PACKED_CELL_U32_STRIDE = 12
export const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4
const SPACE_CODEPOINT = 32

export interface PackedRowBuffer {
  buffer: ArrayBuffer
  floats: Float32Array
  uints: Uint32Array
  capacity: number
  overlayX: Int32Array
  overlayCodepoint: Uint32Array
  overlayAttributes: Uint8Array
  overlayFg: Array<RGBA | null>
  overlayBg: Array<RGBA | null>
  overlayCount: number
}

export interface PackedRowBatchBuffer {
  buffer: ArrayBuffer
  bytes: Uint8Array
  floats: Float32Array
  uints: Uint32Array
  capacityCols: number
  capacityRows: number
  overlayX: Int32Array
  overlayY: Int32Array
  overlayCodepoint: Uint32Array
  overlayAttributes: Uint8Array
  overlayFg: Array<RGBA | null>
  overlayBg: Array<RGBA | null>
  overlayCount: number
}

export interface RowTextCacheEntry {
  text: string
  fg: RGBA
  bg: RGBA
}

export type RowTextCache = Array<RowTextCacheEntry | null>

export interface RowRenderCache {
  packedRow: PackedRowBuffer
  rowText: RowTextCache
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

const renderPackedRow = (
  buffer: OptimizedBuffer,
  row: TerminalCell[],
  rowIndex: number,
  cols: number,
  offsetX: number,
  rowY: number,
  fallbackFg: RGBA,
  fallbackBg: RGBA,
  cache: RowRenderCache
): boolean => {
  const packed = cache.packedRow
  if (cols > packed.capacity) {
    return false
  }

  const packedFloats = packed.floats
  const packedU32 = packed.uints
  const overlayX = packed.overlayX
  const overlayCodepoint = packed.overlayCodepoint
  const overlayAttributes = packed.overlayAttributes
  const overlayFg = packed.overlayFg
  const overlayBg = packed.overlayBg
  let overlayCount = 0
  const rowTextCache = cache.rowText
  const canCacheText = rowIndex >= 0 && rowIndex < rowTextCache.length

  const fallbackFgKey = ((Math.round(fallbackFg.r * 255) & 0xff) << 16) |
    ((Math.round(fallbackFg.g * 255) & 0xff) << 8) |
    (Math.round(fallbackFg.b * 255) & 0xff)
  const fallbackBgKey = ((Math.round(fallbackBg.r * 255) & 0xff) << 16) |
    ((Math.round(fallbackBg.g * 255) & 0xff) << 8) |
    (Math.round(fallbackBg.b * 255) & 0xff)

  let lastFgKey = fallbackFgKey
  let lastBgKey = fallbackBgKey
  let lastFg = fallbackFg
  let lastBg = fallbackBg

  let uniformCandidate = canCacheText
  let uniformText = ''
  let uniformFgKey = -1
  let uniformBgKey = -1
  let uniformFg = fallbackFg
  let uniformBg = fallbackBg
  let pendingWide = false
  let pendingWideBg = fallbackBg

  const pushOverlay = (x: number, codepoint: number, fg: RGBA, bg: RGBA, attributes: number) => {
    if (overlayCount >= overlayX.length) {
      return
    }
    overlayX[overlayCount] = x
    overlayCodepoint[overlayCount] = codepoint
    overlayAttributes[overlayCount] = attributes
    overlayFg[overlayCount] = fg
    overlayBg[overlayCount] = bg
    overlayCount++
  }

  for (let x = 0; x < cols; x++) {
    if (pendingWide) {
      const base = x * PACKED_CELL_U32_STRIDE
      packedFloats[base] = pendingWideBg.r
      packedFloats[base + 1] = pendingWideBg.g
      packedFloats[base + 2] = pendingWideBg.b
      packedFloats[base + 3] = pendingWideBg.a
      packedFloats[base + 4] = pendingWideBg.r
      packedFloats[base + 5] = pendingWideBg.g
      packedFloats[base + 6] = pendingWideBg.b
      packedFloats[base + 7] = pendingWideBg.a
      packedU32[base + 8] = SPACE_CODEPOINT
      packedU32[base + 9] = 0
      packedU32[base + 10] = 0
      packedU32[base + 11] = 0
      pushOverlay(x, 0, pendingWideBg, pendingWideBg, 0)
      pendingWide = false
      uniformCandidate = false
      continue
    }

    const cell = row[x] ?? null
    let fg = fallbackFg
    let bg = fallbackBg
    let fgKey = fallbackFgKey
    let bgKey = fallbackBgKey
    let attributes = 0
    let char = ' '

    if (cell) {
      char = cell.char || ' '
      if (cell.bold) attributes |= ATTR_BOLD
      if (cell.italic) attributes |= ATTR_ITALIC
      if (cell.underline) attributes |= ATTR_UNDERLINE
      if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

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

      fgKey = (fgR << 16) | (fgG << 8) | fgB
      bgKey = (bgR << 16) | (bgG << 8) | bgB

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
    }

    const codepoint = char.codePointAt(0) ?? SPACE_CODEPOINT
    let packedCodepoint = codepoint
    const needsOverlay = attributes !== 0 || codepoint > 0x7f || cell?.width === 2
    if (needsOverlay) {
      pushOverlay(x, codepoint, fg, bg, attributes)
      packedCodepoint = SPACE_CODEPOINT
      uniformCandidate = false
      if (cell?.width === 2) {
        pendingWide = true
        pendingWideBg = bg
      }
    }

    const base = x * PACKED_CELL_U32_STRIDE
    packedFloats[base] = bg.r
    packedFloats[base + 1] = bg.g
    packedFloats[base + 2] = bg.b
    packedFloats[base + 3] = bg.a
    packedFloats[base + 4] = fg.r
    packedFloats[base + 5] = fg.g
    packedFloats[base + 6] = fg.b
    packedFloats[base + 7] = fg.a
    packedU32[base + 8] = packedCodepoint
    packedU32[base + 9] = 0
    packedU32[base + 10] = 0
    packedU32[base + 11] = 0

    if (uniformCandidate) {
      if (uniformFgKey === -1) {
        uniformFgKey = fgKey
        uniformBgKey = bgKey
        uniformFg = fg
        uniformBg = bg
      } else if (fgKey !== uniformFgKey || bgKey !== uniformBgKey) {
        uniformCandidate = false
      }

      if (uniformCandidate) {
        uniformText += char
      }
    }
  }

  if (uniformCandidate) {
    const entry = { text: uniformText, fg: uniformFg, bg: uniformBg }
    rowTextCache[rowIndex] = entry
    buffer.drawText(entry.text, offsetX, rowY, entry.fg, entry.bg, 0)
    return true
  }

  buffer.drawPackedBuffer(
    ptr(packed.buffer),
    cols * PACKED_CELL_BYTE_STRIDE,
    offsetX,
    rowY,
    buffer.width,
    buffer.height
  )

  for (let i = 0; i < overlayCount; i++) {
    const fg = overlayFg[i]
    const bg = overlayBg[i]
    if (!fg || !bg) {
      continue
    }
    buffer.drawChar(
      overlayCodepoint[i],
      overlayX[i] + offsetX,
      rowY,
      fg,
      bg,
      overlayAttributes[i]
    )
  }
  packed.overlayCount = overlayCount

  return true
}

export const packRowForBatch = (
  row: TerminalCell[],
  rowIndex: number,
  cols: number,
  fallbackFg: RGBA,
  fallbackBg: RGBA,
  rowTextCache: RowTextCache | null,
  batch: PackedRowBatchBuffer,
  batchRowIndex: number
): boolean => {
  if (cols > batch.capacityCols || batchRowIndex >= batch.capacityRows) {
    return false
  }

  const packedFloats = batch.floats
  const packedU32 = batch.uints
  const overlayX = batch.overlayX
  const overlayY = batch.overlayY
  const overlayCodepoint = batch.overlayCodepoint
  const overlayAttributes = batch.overlayAttributes
  const overlayFg = batch.overlayFg
  const overlayBg = batch.overlayBg
  let overlayCount = batch.overlayCount
  const canCacheText = !!rowTextCache && rowIndex >= 0 && rowIndex < rowTextCache.length

  const fallbackFgKey = ((Math.round(fallbackFg.r * 255) & 0xff) << 16) |
    ((Math.round(fallbackFg.g * 255) & 0xff) << 8) |
    (Math.round(fallbackFg.b * 255) & 0xff)
  const fallbackBgKey = ((Math.round(fallbackBg.r * 255) & 0xff) << 16) |
    ((Math.round(fallbackBg.g * 255) & 0xff) << 8) |
    (Math.round(fallbackBg.b * 255) & 0xff)

  let lastFgKey = fallbackFgKey
  let lastBgKey = fallbackBgKey
  let lastFg = fallbackFg
  let lastBg = fallbackBg

  let uniformCandidate = canCacheText
  let uniformText = ''
  let uniformFgKey = -1
  let uniformBgKey = -1
  let uniformFg = fallbackFg
  let uniformBg = fallbackBg
  let pendingWide = false
  let pendingWideBg = fallbackBg

  const rowBase = batchRowIndex * cols * PACKED_CELL_U32_STRIDE

  const pushOverlay = (x: number, codepoint: number, fg: RGBA, bg: RGBA, attributes: number) => {
    overlayX[overlayCount] = x
    overlayY[overlayCount] = batchRowIndex
    overlayCodepoint[overlayCount] = codepoint
    overlayAttributes[overlayCount] = attributes
    overlayFg[overlayCount] = fg
    overlayBg[overlayCount] = bg
    overlayCount++
  }

  for (let x = 0; x < cols; x++) {
    if (pendingWide) {
      const base = rowBase + x * PACKED_CELL_U32_STRIDE
      packedFloats[base] = pendingWideBg.r
      packedFloats[base + 1] = pendingWideBg.g
      packedFloats[base + 2] = pendingWideBg.b
      packedFloats[base + 3] = pendingWideBg.a
      packedFloats[base + 4] = pendingWideBg.r
      packedFloats[base + 5] = pendingWideBg.g
      packedFloats[base + 6] = pendingWideBg.b
      packedFloats[base + 7] = pendingWideBg.a
      packedU32[base + 8] = SPACE_CODEPOINT
      packedU32[base + 9] = 0
      packedU32[base + 10] = 0
      packedU32[base + 11] = 0
      pushOverlay(x, 0, pendingWideBg, pendingWideBg, 0)
      pendingWide = false
      uniformCandidate = false
      continue
    }

    const cell = row[x] ?? null
    let fg = fallbackFg
    let bg = fallbackBg
    let fgKey = fallbackFgKey
    let bgKey = fallbackBgKey
    let attributes = 0
    let char = ' '

    if (cell) {
      char = cell.char || ' '
      if (cell.bold) attributes |= ATTR_BOLD
      if (cell.italic) attributes |= ATTR_ITALIC
      if (cell.underline) attributes |= ATTR_UNDERLINE
      if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH

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

      fgKey = (fgR << 16) | (fgG << 8) | fgB
      bgKey = (bgR << 16) | (bgG << 8) | bgB

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
    }

    const codepoint = char.codePointAt(0) ?? SPACE_CODEPOINT
    let packedCodepoint = codepoint
    const needsOverlay = attributes !== 0 || codepoint > 0x7f || cell?.width === 2
    if (needsOverlay) {
      pushOverlay(x, codepoint, fg, bg, attributes)
      packedCodepoint = SPACE_CODEPOINT
      uniformCandidate = false
      if (cell?.width === 2) {
        pendingWide = true
        pendingWideBg = bg
      }
    }

    const base = rowBase + x * PACKED_CELL_U32_STRIDE
    packedFloats[base] = bg.r
    packedFloats[base + 1] = bg.g
    packedFloats[base + 2] = bg.b
    packedFloats[base + 3] = bg.a
    packedFloats[base + 4] = fg.r
    packedFloats[base + 5] = fg.g
    packedFloats[base + 6] = fg.b
    packedFloats[base + 7] = fg.a
    packedU32[base + 8] = packedCodepoint
    packedU32[base + 9] = 0
    packedU32[base + 10] = 0
    packedU32[base + 11] = 0

    if (uniformCandidate) {
      if (uniformFgKey === -1) {
        uniformFgKey = fgKey
        uniformBgKey = bgKey
        uniformFg = fg
        uniformBg = bg
      } else if (fgKey !== uniformFgKey || bgKey !== uniformBgKey) {
        uniformCandidate = false
      }

      if (uniformCandidate) {
        uniformText += char
      }
    }
  }

  if (uniformCandidate && rowTextCache) {
    rowTextCache[rowIndex] = { text: uniformText, fg: uniformFg, bg: uniformBg }
  }

  batch.overlayCount = overlayCount
  return true
}

export const drawPackedRowBatch = (
  buffer: OptimizedBuffer,
  batch: PackedRowBatchBuffer,
  cols: number,
  offsetX: number,
  offsetY: number,
  startRow: number,
  rowCount: number,
  resetOverlayCount = true
): void => {
  if (rowCount <= 0) return

  buffer.drawPackedBuffer(
    ptr(batch.buffer),
    rowCount * cols * PACKED_CELL_BYTE_STRIDE,
    offsetX,
    offsetY + startRow,
    buffer.width,
    buffer.height
  )

  const overlayCount = batch.overlayCount
  const overlayX = batch.overlayX
  const overlayY = batch.overlayY
  const overlayCodepoint = batch.overlayCodepoint
  const overlayAttributes = batch.overlayAttributes
  const overlayFg = batch.overlayFg
  const overlayBg = batch.overlayBg

  for (let i = 0; i < overlayCount; i++) {
    const fg = overlayFg[i]
    const bg = overlayBg[i]
    if (!fg || !bg) continue
    buffer.drawChar(
      overlayCodepoint[i],
      overlayX[i] + offsetX,
      overlayY[i] + offsetY + startRow,
      fg,
      bg,
      overlayAttributes[i]
    )
  }
  if (resetOverlayCount) {
    batch.overlayCount = 0
  }
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
    const char = cell.char || ' '
    const codepoint = char.codePointAt(0) ?? 0x20
    if (codepoint > 0x7f) {
      buffer.drawChar(codepoint, x + offsetX, rowY, fg, bg, attributes)
    } else {
      buffer.setCell(x + offsetX, rowY, char, fg, bg, attributes)
    }

    // Track if this cell was wide for next iteration
    prevCellWasWide = cell.width === 2
    prevCellBg = prevCellWasWide ? bg : null
  }
}
