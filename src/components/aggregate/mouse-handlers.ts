/**
 * Mouse handlers for AggregateView preview pane
 * Handles mouse events and forwards them to the PTY
 */

import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { writeToPty } from '../../effect/bridge';
import { inputHandler } from '../../terminal/input-handler';

export interface MouseHandlerDeps {
  // State getters
  getPreviewMode: () => boolean;
  getSelectedPtyId: () => string | null;

  // Layout getters
  getListPaneWidth: () => number;
  getPreviewInnerWidth: () => number;
  getPreviewInnerHeight: () => number;

  // Terminal state checks
  isMouseTrackingEnabled: (ptyId: string) => boolean;
  isAlternateScreen: (ptyId: string) => boolean;

  // Scroll handler
  scrollTerminal: (ptyId: string, delta: number) => void;
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
    isMouseTrackingEnabled,
    isAlternateScreen,
    scrollTerminal,
  } = deps;

  /**
   * Calculate coordinates relative to preview content area
   */
  const getRelativeCoords = (event: OpenTUIMouseEvent) => {
    const previewX = getListPaneWidth();
    const previewY = 0; // Panes start at top
    const relX = event.x - previewX - 1;
    const relY = event.y - previewY - 1;
    return { relX, relY };
  };

  /**
   * Check if coordinates are inside the content area
   */
  const isInsideContent = (relX: number, relY: number) => {
    return relX >= 0 && relY >= 0 && relX < getPreviewInnerWidth() && relY < getPreviewInnerHeight();
  };

  /**
   * Core mouse event handler - forwards events to PTY
   */
  const handlePreviewMouseEvent = (
    event: OpenTUIMouseEvent,
    type: 'down' | 'up' | 'move' | 'drag' | 'scroll'
  ) => {
    if (!getPreviewMode()) return;
    const selectedPtyId = getSelectedPtyId();
    if (!selectedPtyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Only forward if inside the content area
    if (!isInsideContent(relX, relY)) return;

    // Handle scroll specially
    if (type === 'scroll') {
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
      writeToPty(selectedPtyId, sequence);
      return;
    }

    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });
    writeToPty(selectedPtyId, sequence);
  };

  const handlePreviewMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'down');
  };

  const handlePreviewMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'up');
  };

  const handlePreviewMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'move');
  };

  const handlePreviewMouseDrag = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'drag');
  };

  /**
   * Handle scroll events - forwards to PTY or uses local scrollback
   */
  const handlePreviewMouseScroll = (event: OpenTUIMouseEvent) => {
    if (!getPreviewMode()) return;
    const selectedPtyId = getSelectedPtyId();
    if (!selectedPtyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Check if the app has mouse tracking enabled - if so, forward scroll to it
    const shouldForwardToApp = isAlternateScreen(selectedPtyId) || isMouseTrackingEnabled(selectedPtyId);

    if (shouldForwardToApp) {
      // Forward scroll event to the PTY
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
      writeToPty(selectedPtyId, sequence);
    } else {
      // Handle scroll locally - scroll through scrollback buffer
      const scrollSpeed = 3;
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        // Scroll up = look at older content = increase viewport offset
        scrollTerminal(selectedPtyId, scrollSpeed);
      } else if (direction === 'down') {
        // Scroll down = look at newer content = decrease viewport offset
        scrollTerminal(selectedPtyId, -scrollSpeed);
      }
    }
  };

  return {
    handlePreviewMouseDown,
    handlePreviewMouseUp,
    handlePreviewMouseMove,
    handlePreviewMouseDrag,
    handlePreviewMouseScroll,
  };
}
