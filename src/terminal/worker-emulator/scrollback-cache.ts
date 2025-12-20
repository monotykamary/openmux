/**
 * Scrollback Cache - LRU cache for scrollback lines
 */
import type { TerminalScrollState, DirtyTerminalUpdate } from '../../core/types'
import type { TerminalModes } from '../emulator-interface'

/**
 * ScrollbackCache manages cached scrollback lines with LRU eviction
 */
export class ScrollbackCache<T> {
  private cache = new Map<number, T>()
  private maxSize: number
  private lastScrollbackLength = 0
  private onEvict: ((value: T) => void) | null

  constructor(maxSize = 1000, onEvict?: (value: T) => void) {
    this.maxSize = maxSize
    this.onEvict = onEvict ?? null
  }

  get(offset: number): T | null {
    return this.cache.get(offset) ?? null
  }

  set(offset: number, value: T): void {
    const existing = this.cache.get(offset)
    if (existing && existing !== value) {
      this.onEvict?.(existing)
    }
    this.cache.set(offset, value)
    this.prune()
  }

  setMany(lines: Map<number, T>): void {
    for (const [offset, value] of lines) {
      const existing = this.cache.get(offset)
      if (existing && existing !== value) {
        this.onEvict?.(existing)
      }
      this.cache.set(offset, value)
    }
    this.prune()
  }

  clear(): void {
    if (this.onEvict) {
      for (const cells of this.cache.values()) {
        this.onEvict(cells)
      }
    }
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  /**
   * Handle scrollback changes and determine if cache should be cleared
   * Returns true if cache was cleared
   */
  handleScrollbackChange(
    newScrollbackLength: number,
    isAtScrollbackLimit: boolean
  ): boolean {
    const scrollbackDelta = newScrollbackLength - this.lastScrollbackLength

    // Smart cache invalidation to prevent flicker when scrolled back:
    // - When scrollback GROWS (delta > 0): existing cached lines at their absolute
    //   offsets are still valid, no need to clear cache
    // - When scrollback stays same (delta == 0) AND at scrollback limit: old lines
    //   are being evicted as new ones arrive, content shifts, must clear cache
    // - When scrollback stays same (delta == 0) but NOT at limit: just in-place
    //   updates (animations, cursor moves), cache is still valid, don't clear
    // - When scrollback shrinks (delta < 0): reset occurred, must clear
    const contentShifted = scrollbackDelta < 0 ||
      (scrollbackDelta === 0 && isAtScrollbackLimit && this.lastScrollbackLength > 0)

    if (contentShifted) {
      this.clear()
    }

    this.lastScrollbackLength = newScrollbackLength
    return contentShifted
  }

  private prune(): void {
    // Simple LRU eviction by removing oldest entries
    if (this.cache.size > this.maxSize) {
      const excess = this.cache.size - this.maxSize
      const iterator = this.cache.keys()
      for (let i = 0; i < excess; i++) {
        const key = iterator.next().value
        if (key !== undefined) {
          const existing = this.cache.get(key)
          if (existing) {
            this.onEvict?.(existing)
          }
          this.cache.delete(key)
        }
      }
    }
  }
}

/**
 * Handle update and determine cache invalidation based on modes
 */
export function shouldClearCacheOnUpdate(
  update: DirtyTerminalUpdate,
  currentModes: TerminalModes
): boolean {
  // Clear scrollback cache when alternate screen mode changes
  // (entering/exiting vim, htop, etc.) - not on resize, to prevent flash
  return currentModes.alternateScreen !== update.alternateScreen
}
