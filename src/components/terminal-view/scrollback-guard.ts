import type { TerminalCell } from '../../core/types'

/**
 * Scrollback render guard
 *
 * Purpose: avoid rendering partial scrollback when some rows are temporarily
 * unavailable from the emulator. This complements the emulator-side LRU cache
 * (performance) by providing view-side consistency during scroll interactions.
 */
export interface ScrollbackGuardOptions {
  desiredViewportOffset: number
  desiredScrollbackLength: number
  rows: number
  desiredRowCache: (TerminalCell[] | null)[]
  recentRows: Map<number, TerminalCell[]>
  lastStableViewportOffset: number
  lastStableScrollbackLength: number
  lastObservedViewportOffset: number
  lastObservedScrollbackLength: number
}

export interface ScrollbackGuardResult {
  shouldDefer: boolean
  isUserScroll: boolean
  renderViewportOffset: number
  renderScrollbackLength: number
  renderRowCache: (TerminalCell[] | null)[]
  hasMissingScrollback: boolean
}

export function guardScrollbackRender(
  options: ScrollbackGuardOptions
): ScrollbackGuardResult {
  const {
    desiredViewportOffset,
    desiredScrollbackLength,
    rows,
    desiredRowCache,
    recentRows,
    lastStableViewportOffset,
    lastStableScrollbackLength,
    lastObservedViewportOffset,
    lastObservedScrollbackLength,
  } = options

  const scrollbackDelta = desiredScrollbackLength - lastObservedScrollbackLength
  const expectedViewportOffset = scrollbackDelta > 0
    ? lastObservedViewportOffset + scrollbackDelta
    : lastObservedViewportOffset
  const isUserScroll = desiredViewportOffset !== expectedViewportOffset

  let hasMissingScrollback = false
  const renderRowCache: (TerminalCell[] | null)[] = new Array(rows)
  for (let y = 0; y < rows; y++) {
    const absoluteY = desiredScrollbackLength - desiredViewportOffset + y
    let row = desiredRowCache[y]
    if (desiredViewportOffset > 0 && row === null && recentRows.size > 0) {
      row = recentRows.get(absoluteY) ?? row
    }
    renderRowCache[y] = row
    if (row === null && absoluteY >= 0 && absoluteY < desiredScrollbackLength) {
      hasMissingScrollback = true
    }
  }

  const shouldDefer = (isUserScroll || desiredViewportOffset > 0) && hasMissingScrollback
  const renderViewportOffset = shouldDefer
    ? Math.min(lastStableViewportOffset, desiredScrollbackLength)
    : desiredViewportOffset
  const renderScrollbackLength = shouldDefer
    ? Math.min(lastStableScrollbackLength, desiredScrollbackLength)
    : desiredScrollbackLength

  return {
    shouldDefer,
    isUserScroll,
    renderViewportOffset,
    renderScrollbackLength,
    renderRowCache,
    hasMissingScrollback,
  }
}
