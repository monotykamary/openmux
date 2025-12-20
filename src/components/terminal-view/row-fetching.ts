/**
 * Row Fetching - handles fetching rows for terminal rendering with scrollback
 */
import type { TerminalCell, TerminalState } from '../../core/types'
import type { ITerminalEmulator } from '../../terminal/emulator-interface'

export interface RowFetchingOptions {
  viewportOffset: number
  scrollbackLength: number
  rows: number
  getScrollbackLinePacked?: (offset: number) => boolean
}

export interface RowFetchResult {
  rowCache: (TerminalCell[] | null)[]
  firstMissingOffset: number
  lastMissingOffset: number
}

export interface MissingRowBuffer {
  rowIndices: Int32Array
  offsets: Int32Array
  count: number
}

/**
 * Fetch all rows needed for rendering (optimized: fetch once per row, not per cell)
 * Returns the row cache and any missing scrollback line offsets for prefetching
 */
export function fetchRowsForRendering(
  state: TerminalState,
  emulator: ITerminalEmulator | null,
  transitionCache: Map<number, TerminalCell[]>,
  options: RowFetchingOptions,
  rowCache?: (TerminalCell[] | null)[],
  missingRows?: MissingRowBuffer
): RowFetchResult {
  const { viewportOffset, scrollbackLength, rows } = options

  const currentEmulator = viewportOffset > 0 ? emulator : null
  const hasTransitionCache = transitionCache.size > 0
  const baseY = scrollbackLength - viewportOffset
  const cache = rowCache ?? []
  if (cache.length !== rows) {
    cache.length = rows
  }

  // Track missing scrollback lines for prefetching
  let firstMissingOffset = -1
  let lastMissingOffset = -1
  if (missingRows) {
    missingRows.count = 0
  }

  for (let y = 0; y < rows; y++) {
    if (viewportOffset === 0) {
      // Normal case: use live terminal rows
      cache[y] = state.cells[y] ?? null
    } else {
      // Scrolled back: calculate which row to fetch
      const absoluteY = baseY + y

      if (absoluteY < 0) {
        // Before scrollback
        cache[y] = null
      } else if (absoluteY < scrollbackLength) {
        // In scrollback buffer - try emulator cache first, then transition cache
        const packedAvailable = options.getScrollbackLinePacked?.(absoluteY) ?? false
        if (packedAvailable) {
          cache[y] = null
        } else {
          let line = currentEmulator?.getScrollbackLine(absoluteY) ?? null
          // Fall back to transition cache for lines that just moved from live terminal
          if (line === null && hasTransitionCache) {
            line = transitionCache.get(absoluteY) ?? null
          }
          cache[y] = line
          // Track missing scrollback lines (null when should have data)
          if (line === null && currentEmulator) {
            if (firstMissingOffset === -1) {
              firstMissingOffset = absoluteY
            }
            lastMissingOffset = absoluteY
            if (missingRows && missingRows.count < missingRows.rowIndices.length) {
              const idx = missingRows.count
              missingRows.rowIndices[idx] = y
              missingRows.offsets[idx] = absoluteY
              missingRows.count = idx + 1
            }
          }
        }
      } else {
        // In live terminal area
        const liveY = absoluteY - scrollbackLength
        cache[y] = state.cells[liveY] ?? null
      }
    }
  }

  return { rowCache: cache, firstMissingOffset, lastMissingOffset }
}

export interface PrefetchRequest {
  ptyId: string
  start: number
  count: number
}

/**
 * Calculate prefetch request for missing scrollback lines
 * Returns null if no prefetch is needed
 */
export function calculatePrefetchRequest(
  ptyId: string,
  firstMissingOffset: number,
  lastMissingOffset: number,
  scrollbackLength: number,
  rows: number
): PrefetchRequest | null {
  if (firstMissingOffset === -1) {
    return null
  }

  // Prefetch buffer: 2x viewport height above current position
  const bufferSize = rows * 2
  const prefetchStart = Math.max(0, firstMissingOffset - bufferSize)
  const prefetchEnd = Math.min(scrollbackLength - 1, lastMissingOffset + rows)
  const count = prefetchEnd - prefetchStart + 1

  return { ptyId, start: prefetchStart, count }
}

/**
 * Update transition cache when scrollback grows
 * Captures lines transitioning from live terminal to scrollback
 */
export function updateTransitionCache(
  transitionCache: Map<number, TerminalCell[]>,
  terminalState: TerminalState | null,
  oldScrollbackLength: number,
  newScrollbackLength: number,
  viewportOffset: number,
  isAtScrollbackLimit: boolean
): void {
  const scrollbackDelta = newScrollbackLength - oldScrollbackLength

  if (scrollbackDelta > 0 && terminalState && viewportOffset > 0) {
    // Capture lines transitioning from live terminal to scrollback BEFORE updating state.
    // We capture them so we can render them immediately without waiting for async prefetch.
    for (let i = 0; i < scrollbackDelta; i++) {
      const row = terminalState.cells[i]
      if (row) {
        transitionCache.set(oldScrollbackLength + i, row)
      }
    }
  } else if (scrollbackDelta < 0 ||
             (scrollbackDelta === 0 && isAtScrollbackLimit && oldScrollbackLength > 0)) {
    // Content shifted (at scrollback limit) or reset - clear stale transition cache entries
    // to prevent returning wrong data for offsets that now have different content
    transitionCache.clear()
  }
}
