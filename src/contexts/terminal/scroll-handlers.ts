/**
 * Scroll handlers for TerminalContext
 * Handles scroll operations with optimistic cache updates
 */

import type { TerminalScrollState } from '../../core/types';
import { clampScrollOffset, calculateScrollDelta } from '../../core/scroll-utils';
import {
  getScrollState as getScrollStateFromBridge,
  setScrollOffset as setScrollOffsetBridge,
  scrollToBottom as scrollToBottomBridge,
} from '../../effect/bridge';

export interface ScrollHandlerDeps {
  /** Scroll state cache */
  scrollStates: Map<string, TerminalScrollState>;
}

/**
 * Caches structure expected by scroll handlers
 */
interface PtyCachesLike {
  scrollStates: Map<string, TerminalScrollState>;
}

/**
 * Creates scroll handlers for TerminalContext
 */
export function createScrollHandlers(ptyCaches: PtyCachesLike) {
  /**
   * Get scroll state for a PTY (sync - uses cache only for performance)
   * Cache is kept fresh by: optimistic updates in scrollTerminal/setScrollOffset,
   * and PTY subscription updates when terminal state changes
   */
  const handleGetScrollState = (ptyId: string): TerminalScrollState | undefined => {
    return ptyCaches.scrollStates.get(ptyId);
  };

  /**
   * Scroll terminal by delta lines
   */
  const scrollTerminal = (ptyId: string, delta: number): void => {
    const cached = ptyCaches.scrollStates.get(ptyId);
    if (cached) {
      // Use utility for clamped scroll calculation
      const clampedOffset = calculateScrollDelta(
        cached.viewportOffset,
        delta,
        cached.scrollbackLength
      );
      setScrollOffsetBridge(ptyId, clampedOffset);
    } else {
      // Fallback: fetch state and then scroll (handles edge cases where cache isn't populated)
      getScrollStateFromBridge(ptyId).then((state) => {
        if (state) {
          // Use utility for clamped scroll calculation
          const clampedOffset = calculateScrollDelta(
            state.viewportOffset,
            delta,
            state.scrollbackLength
          );
          setScrollOffsetBridge(ptyId, clampedOffset);
        }
      });
    }
  };

  /**
   * Set absolute scroll offset
   */
  const handleSetScrollOffset = (ptyId: string, offset: number): void => {
    const cached = ptyCaches.scrollStates.get(ptyId);
    // Use utility for clamping to valid range
    const clampedOffset = cached
      ? clampScrollOffset(offset, cached.scrollbackLength)
      : Math.max(0, offset);
    setScrollOffsetBridge(ptyId, clampedOffset);
  };

  /**
   * Scroll terminal to bottom
   */
  const handleScrollToBottom = (ptyId: string): void => {
    scrollToBottomBridge(ptyId);
  };

  return {
    handleGetScrollState,
    scrollTerminal,
    handleSetScrollOffset,
    handleScrollToBottom,
  };
}
