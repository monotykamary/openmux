/**
 * Mouse handlers for AggregateView preview pane
 * Uses shared terminal mouse handling logic
 */

import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { writeToPty } from '../../effect/bridge';
import { inputHandler } from '../../terminal/input-handler';
import { createTerminalMouseHandler, type TerminalMouseDeps } from '../shared/terminal-mouse-handler';

export interface MouseHandlerDeps extends TerminalMouseDeps {
  // State getters
  getPreviewMode: () => boolean;
  getSelectedPtyId: () => string | null;

  // Layout getters
  getListPaneWidth: () => number;
  getPreviewInnerWidth: () => number;
  getPreviewInnerHeight: () => number;
}

/**
 * Creates mouse handlers for AggregateView preview pane
 */
export function createAggregateMouseHandlers(deps: MouseHandlerDeps) {
  const {
    getPreviewMode,
    getSelectedPtyId,
    getListPaneWidth,
    getPreviewInnerWidth,
    getPreviewInnerHeight,
    getScrollState,
    scrollTerminal,
  } = deps;

  // Create shared mouse handler
  const mouseHandler = createTerminalMouseHandler(deps);

  /**
   * Check if terminal is scrolled back (not at bottom)
   */
  const isScrolledBack = (ptyId: string): boolean => {
    const scrollState = getScrollState(ptyId);
    return scrollState ? scrollState.viewportOffset > 0 : false;
  };

  /**
   * Calculate coordinates relative to preview content area
   */
  const getRelativeCoords = (event: OpenTUIMouseEvent) => {
    const previewX = getListPaneWidth();
    const relX = event.x - previewX - 1;
    const relY = event.y - 1; // Account for border
    return { relX, relY };
  };

  /**
   * Check if coordinates are inside the content area
   */
  const isInsideContent = (relX: number, relY: number) => {
    return relX >= 0 && relY >= 0 && relX < getPreviewInnerWidth() && relY < getPreviewInnerHeight();
  };

  /**
   * Forward mouse event to PTY
   */
  const forwardMouseEvent = (
    ptyId: string,
    event: OpenTUIMouseEvent,
    type: 'down' | 'up' | 'move' | 'drag',
    relX: number,
    relY: number
  ) => {
    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });
    writeToPty(ptyId, sequence);
  };

  const handlePreviewMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    // Try selection first
    const handled = mouseHandler.handleSelectionMouseDown(
      ptyId, relX, relY, event.modifiers?.shift ?? false
    );
    if (handled) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward mouse down when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    forwardMouseEvent(ptyId, event, 'down', relX, relY);
  };

  const handlePreviewMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    const ptyId = getSelectedPtyId();

    // Always try to complete selection (handles cleanup)
    if (ptyId && mouseHandler.handleSelectionMouseUp(ptyId)) {
      return;
    }

    if (!getPreviewMode() || !ptyId) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward mouse up when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(ptyId, event, 'up', relX, relY);
  };

  const handlePreviewMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    // Only forward mouse move if app explicitly wants mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(ptyId, event, 'move', relX, relY);
  };

  const handlePreviewMouseDrag = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Try selection drag first
    const handled = mouseHandler.handleSelectionMouseDrag(
      ptyId, relX, relY, getPreviewInnerHeight()
    );
    if (handled) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward drag when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    if (!isInsideContent(relX, relY)) return;
    forwardMouseEvent(ptyId, event, 'drag', relX, relY);
  };

  const handlePreviewMouseScroll = (event: OpenTUIMouseEvent) => {
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Forward scroll to app if it wants mouse input
    if (mouseHandler.appWantsMouse(ptyId)) {
      const scrollUp = event.scroll?.direction === 'up';
      const button = scrollUp ? 4 : 5;
      const sequence = inputHandler.encodeMouse({
        type: 'scroll',
        button,
        x: relX,
        y: relY,
        shift: event.modifiers?.shift,
        alt: event.modifiers?.alt,
        ctrl: event.modifiers?.ctrl,
      });
      writeToPty(ptyId, sequence);
    } else {
      // Handle scroll locally
      const scrollSpeed = 3;
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        scrollTerminal(ptyId, scrollSpeed);
      } else if (direction === 'down') {
        scrollTerminal(ptyId, -scrollSpeed);
      }
    }
  };

  return {
    handlePreviewMouseDown,
    handlePreviewMouseUp,
    handlePreviewMouseMove,
    handlePreviewMouseDrag,
    handlePreviewMouseScroll,
    cleanup: mouseHandler.cleanup,
  };
}
