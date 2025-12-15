/**
 * LRU cache for scrollback lines.
 * Caches converted terminal cells to avoid repeated conversions during scrolling.
 */

import type { TerminalCell } from '../../core/types';

/**
 * Options for ScrollbackCache
 */
export interface ScrollbackCacheOptions {
  /** Maximum number of lines to cache before trimming */
  maxSize?: number;
  /** Number of lines to keep after trimming */
  trimSize?: number;
}

/**
 * LRU cache for scrollback line data.
 * Stores converted TerminalCell arrays indexed by scrollback offset.
 */
export class ScrollbackCache {
  private cache: Map<number, TerminalCell[]> = new Map();
  private order: number[] = [];
  private readonly maxSize: number;
  private readonly trimSize: number;

  /**
   * Create a new scrollback cache.
   *
   * @param options - Cache configuration options
   */
  constructor(options: ScrollbackCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.trimSize = options.trimSize ?? 500;
  }

  /**
   * Get a cached line by scrollback offset.
   *
   * @param offset - Line offset from top of scrollback (0 = oldest line)
   * @returns Cached cells array, or null if not cached
   */
  get(offset: number): TerminalCell[] | null {
    return this.cache.get(offset) ?? null;
  }

  /**
   * Cache a converted line.
   *
   * @param offset - Line offset from top of scrollback
   * @param cells - Converted cells array
   */
  set(offset: number, cells: TerminalCell[]): void {
    this.cache.set(offset, cells);
    this.order.push(offset);
  }

  /**
   * Trim the cache using LRU eviction when it exceeds max size.
   * This removes the oldest entries (earliest in order array).
   */
  trim(): void {
    if (this.cache.size > this.maxSize) {
      // Remove oldest entries (first N entries in order array)
      const toRemove = this.cache.size - this.trimSize;
      const keysToRemove = this.order.splice(0, toRemove);
      for (const key of keysToRemove) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached entries.
   * Call this after resize or other events that may reflow lines.
   */
  clear(): void {
    this.cache.clear();
    this.order = [];
  }

  /**
   * Get the current number of cached lines.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Check if a line is cached.
   *
   * @param offset - Line offset to check
   * @returns true if the line is cached
   */
  has(offset: number): boolean {
    return this.cache.has(offset);
  }
}
