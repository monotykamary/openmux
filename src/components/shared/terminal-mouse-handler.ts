/**
 * Shared terminal mouse handling logic
 * Used by both Pane.tsx and AggregateView's InteractivePreview
 */

import type { TerminalCell } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { TerminalState } from '../../core/types';

// Selection state type (matching SelectionContext)
export interface SelectionState {
  isSelecting: boolean;
  normalizedRange?: unknown;
}

export interface TerminalMouseDeps {
  // Terminal state checks
  isMouseTrackingEnabled: (ptyId: string) => boolean;

  // Scroll state
  getScrollState: (ptyId: string) => { viewportOffset: number; scrollbackLength: number; isAtBottom: boolean } | undefined;

  // Scroll control
  scrollTerminal: (ptyId: string, delta: number) => void;

  // Selection handlers
  startSelection: (ptyId: string, x: number, y: number, scrollbackLength: number, scrollOffset: number) => void;
  updateSelection: (ptyId: string, x: number, y: number, scrollbackLength: number, scrollOffset: number) => void;
  completeSelection: (ptyId: string, scrollbackLength: number, getLine: (absoluteY: number) => TerminalCell[] | null) => void;
  clearSelection: (ptyId: string) => void;
  getSelection: (ptyId: string) => SelectionState | undefined;

  // For completeSelection's line getter
  getEmulatorSync: (ptyId: string) => ITerminalEmulator | null;
  getTerminalStateSync: (ptyId: string) => TerminalState | null;
}

export interface PendingSelection {
  x: number;
  y: number;
  scrollbackLength: number;
  scrollOffset: number;
}

/**
 * Creates shared terminal mouse handling logic
 */
export function createTerminalMouseHandler(deps: TerminalMouseDeps) {
  const {
    isMouseTrackingEnabled,
    getScrollState,
    scrollTerminal,
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    getSelection,
    getEmulatorSync,
    getTerminalStateSync,
  } = deps;

  // Track pending selection start (set on mouse down, used on first drag)
  let pendingSelection: PendingSelection | null = null;

  // Track auto-scroll during selection drag outside pane bounds
  let autoScroll: {
    direction: 'up' | 'down' | null;
    intervalId: ReturnType<typeof setInterval> | null;
    ptyId: string | null;
  } = {
    direction: null,
    intervalId: null,
    ptyId: null,
  };

  /**
   * Check if app wants mouse input (mouse tracking explicitly enabled)
   * Note: Being in alternate screen alone is not sufficient - the app must
   * have enabled mouse tracking via escape sequences (modes 1000/1002/1003)
   */
  const appWantsMouse = (ptyId: string): boolean => {
    return isMouseTrackingEnabled(ptyId);
  };

  /**
   * Check if we should handle selection (app doesn't want mouse OR shift override)
   */
  const shouldHandleSelection = (ptyId: string, shiftHeld: boolean): boolean => {
    return !appWantsMouse(ptyId) || shiftHeld;
  };

  /**
   * Start auto-scroll in a direction
   */
  const startAutoScroll = (ptyId: string, direction: 'up' | 'down') => {
    if (autoScroll.direction === direction && autoScroll.ptyId === ptyId) return;

    stopAutoScroll();

    autoScroll.direction = direction;
    autoScroll.ptyId = ptyId;
    autoScroll.intervalId = setInterval(() => {
      if (autoScroll.ptyId) {
        scrollTerminal(autoScroll.ptyId, direction === 'up' ? 1 : -1);
      }
    }, 50);
  };

  /**
   * Stop auto-scroll
   */
  const stopAutoScroll = () => {
    if (autoScroll.intervalId) {
      clearInterval(autoScroll.intervalId);
      autoScroll.intervalId = null;
    }
    autoScroll.direction = null;
    autoScroll.ptyId = null;
  };

  /**
   * Handle mouse down for selection
   * Returns true if selection was started (caller should not forward to PTY)
   */
  const handleSelectionMouseDown = (
    ptyId: string,
    relX: number,
    relY: number,
    shiftHeld: boolean
  ): boolean => {
    if (!shouldHandleSelection(ptyId, shiftHeld)) {
      return false;
    }

    // Clear any existing selection and store pending selection start
    clearSelection(ptyId);
    const scrollState = getScrollState(ptyId);
    pendingSelection = {
      x: relX,
      y: relY,
      scrollbackLength: scrollState?.scrollbackLength ?? 0,
      scrollOffset: scrollState?.viewportOffset ?? 0,
    };
    return true;
  };

  /**
   * Handle mouse up - complete selection if active
   * Returns true if selection was completed (caller should not forward to PTY)
   */
  const handleSelectionMouseUp = (ptyId: string): boolean => {
    // Clear pending selection (click without drag)
    pendingSelection = null;
    stopAutoScroll();

    const selection = getSelection(ptyId);
    if (!selection?.isSelecting) {
      return false;
    }

    const scrollState = getScrollState(ptyId);
    const scrollbackLength = scrollState?.scrollbackLength ?? 0;

    // Create line getter for both scrollback and live terminal
    const getLine = (absoluteY: number) => {
      const emulator = getEmulatorSync(ptyId);
      const state = getTerminalStateSync(ptyId);
      if (absoluteY < scrollbackLength) {
        return emulator?.getScrollbackLine(absoluteY) ?? null;
      } else {
        const liveY = absoluteY - scrollbackLength;
        return state?.cells[liveY] ?? null;
      }
    };

    completeSelection(ptyId, scrollbackLength, getLine);
    return true;
  };

  /**
   * Handle mouse drag for selection
   * Returns true if selection is active (caller should not forward to PTY)
   */
  const handleSelectionMouseDrag = (
    ptyId: string,
    relX: number,
    relY: number,
    innerHeight: number
  ): boolean => {
    // Check if we have a pending selection start (first drag after mouse down)
    if (pendingSelection) {
      const pending = pendingSelection;
      startSelection(ptyId, pending.x, pending.y, pending.scrollbackLength, pending.scrollOffset);
      pendingSelection = null;
    }

    const selection = getSelection(ptyId);
    if (!selection?.isSelecting) {
      return false;
    }

    // Auto-scroll when dragging outside pane bounds
    if (relY < 0) {
      startAutoScroll(ptyId, 'up');
    } else if (relY >= innerHeight) {
      startAutoScroll(ptyId, 'down');
    } else {
      stopAutoScroll();
    }

    const scrollState = getScrollState(ptyId);
    const scrollbackLength = scrollState?.scrollbackLength ?? 0;
    const scrollOffset = scrollState?.viewportOffset ?? 0;

    // Clamp relY to valid range
    const clampedY = Math.max(0, Math.min(relY, innerHeight - 1));
    updateSelection(ptyId, relX, clampedY, scrollbackLength, scrollOffset);
    return true;
  };

  /**
   * Check if selection is currently active for a pty
   */
  const isSelecting = (ptyId: string): boolean => {
    return getSelection(ptyId)?.isSelecting ?? false;
  };

  /**
   * Check if there's a pending selection
   */
  const hasPendingSelection = (): boolean => {
    return pendingSelection !== null;
  };

  /**
   * Cleanup all state
   */
  const cleanup = () => {
    stopAutoScroll();
    pendingSelection = null;
  };

  return {
    appWantsMouse,
    shouldHandleSelection,
    handleSelectionMouseDown,
    handleSelectionMouseUp,
    handleSelectionMouseDrag,
    isSelecting,
    hasPendingSelection,
    startAutoScroll,
    stopAutoScroll,
    cleanup,
  };
}
