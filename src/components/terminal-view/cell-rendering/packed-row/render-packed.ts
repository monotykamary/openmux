import type { RGBA, OptimizedBuffer } from '@opentui/core'
import { ptr } from 'bun:ffi'
import type { TerminalCell } from '../../../../core/types'
import {
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
} from '../../../../terminal/rendering'
import {
  PACKED_CELL_BYTE_STRIDE,
  PACKED_CELL_STRIDE_U32,
  SPACE_CODEPOINT,
  type RowRenderCache,
} from './types'

export const renderPackedRow = (
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

  for (let x = 0; x < cols; x++) {
    if (pendingWide) {
      const base = x * PACKED_CELL_STRIDE_U32
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
      overlayX[overlayCount] = x
      overlayCodepoint[overlayCount] = 0
      overlayAttributes[overlayCount] = 0
      overlayFg[overlayCount] = pendingWideBg
      overlayBg[overlayCount] = pendingWideBg
      overlayCount++
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
      overlayX[overlayCount] = x
      overlayCodepoint[overlayCount] = codepoint
      overlayAttributes[overlayCount] = attributes
      overlayFg[overlayCount] = fg
      overlayBg[overlayCount] = bg
      overlayCount++
      packedCodepoint = SPACE_CODEPOINT
      uniformCandidate = false
      if (cell?.width === 2) {
        pendingWide = true
        pendingWideBg = bg
      }
    }

    const base = x * PACKED_CELL_STRIDE_U32
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
