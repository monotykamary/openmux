/**
 * Pane component - individual terminal pane with border and focus state
 */

import { useCallback, useRef, type ReactNode } from 'react';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useSelection } from '../contexts/SelectionContext';
import { TerminalView } from './TerminalView';
import { inputHandler } from '../terminal';

interface PaneProps {
  id: string;
  title?: string;
  isFocused: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  ptyId?: string;
  children?: ReactNode;
  onClick?: () => void;
  onMouseInput?: (data: string) => void;
}

export function Pane({
  id,
  title,
  isFocused,
  x,
  y,
  width,
  height,
  ptyId,
  children,
  onClick,
  onMouseInput,
}: PaneProps) {
  const theme = useTheme();
  const { isMouseTrackingEnabled, isAlternateScreen, scrollTerminal, getScrollState, setScrollOffset, getEmulatorSync, getTerminalStateSync } = useTerminal();
  const { startSelection, updateSelection, completeSelection, clearSelection, getSelection } = useSelection();

  // Calculate inner dimensions (account for border)
  const innerWidth = Math.max(1, width - 2);
  const innerHeight = Math.max(1, height - 2);

  // Track if we're dragging the scrollbar
  const scrollbarDragRef = useRef<{ isDragging: boolean; startY: number; startOffset: number }>({
    isDragging: false,
    startY: 0,
    startOffset: 0,
  });

  // Check if a position is on the scrollbar (rightmost column when scrolled)
  const isOnScrollbar = useCallback((relX: number, relY: number): boolean => {
    if (!ptyId) return false;
    const scrollState = getScrollState(ptyId);
    // Scrollbar is shown when not at bottom
    if (!scrollState || scrollState.isAtBottom) return false;
    // Scrollbar is on the rightmost column
    return relX === innerWidth - 1 && relY >= 0 && relY < innerHeight;
  }, [ptyId, getScrollState, innerWidth, innerHeight]);

  // Convert Y position to scroll offset
  const yToScrollOffset = useCallback((relY: number): number => {
    if (!ptyId) return 0;
    const scrollState = getScrollState(ptyId);
    if (!scrollState || scrollState.scrollbackLength === 0) return 0;
    // relY 0 = top = max offset, relY (innerHeight-1) = bottom = 0 offset
    const ratio = 1 - (relY / Math.max(1, innerHeight - 1));
    return Math.round(ratio * scrollState.scrollbackLength);
  }, [ptyId, getScrollState, innerHeight]);

  // Dynamic border color based on focus state
  const borderColor = isFocused
    ? theme.pane.focusedBorderColor
    : theme.pane.borderColor;

  // Title with focus indicator
  const displayTitle = title
    ? isFocused
      ? `● ${title}`
      : title
    : undefined;

  // Map borderStyle to OpenTUI BorderStyle type
  const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
    single: 'single',
    double: 'double',
    rounded: 'rounded',
    bold: 'single', // fallback
  };

  // Convert OpenTUI mouse event to PTY mouse sequence
  const handleMouseEvent = useCallback((event: OpenTUIMouseEvent, type: 'down' | 'up' | 'move' | 'drag' | 'scroll') => {
    if (!onMouseInput) return;

    // Calculate coordinates relative to pane content (subtract border)
    const relX = event.x - x - 1;
    const relY = event.y - y - 1;

    // Only forward if inside the content area
    if (relX < 0 || relY < 0 || relX >= innerWidth || relY >= innerHeight) return;

    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });

    onMouseInput(sequence);
  }, [onMouseInput, x, y, innerWidth, innerHeight]);

  const handleMouseDown = useCallback((event: OpenTUIMouseEvent) => {
    // Prevent default selection behavior
    event.preventDefault();
    onClick?.();

    // Check if clicking on scrollbar
    const relX = event.x - x - 1;
    const relY = event.y - y - 1;
    if (isOnScrollbar(relX, relY) && ptyId) {
      // Start scrollbar drag
      const scrollState = getScrollState(ptyId);
      scrollbarDragRef.current = {
        isDragging: true,
        startY: relY,
        startOffset: scrollState?.viewportOffset ?? 0,
      };
      // Jump to clicked position
      const newOffset = yToScrollOffset(relY);
      setScrollOffset(ptyId, newOffset);
      return;
    }

    // Check if should handle selection vs forward to PTY
    // Shift key overrides app mouse tracking to allow selection
    const appWantsMouse = ptyId && (isMouseTrackingEnabled(ptyId) || isAlternateScreen(ptyId));
    const shiftOverride = event.modifiers?.shift;
    const shouldSelect = !appWantsMouse || shiftOverride;

    if (shouldSelect && ptyId) {
      // Clear any existing selection and start a new one
      clearSelection(ptyId);
      const scrollState = getScrollState(ptyId);
      const scrollbackLength = scrollState?.scrollbackLength ?? 0;
      const scrollOffset = scrollState?.viewportOffset ?? 0;
      startSelection(ptyId, relX, relY, scrollbackLength, scrollOffset);
      return;
    }

    handleMouseEvent(event, 'down');
  }, [onClick, handleMouseEvent, x, y, isOnScrollbar, ptyId, getScrollState, yToScrollOffset, setScrollOffset, isMouseTrackingEnabled, isAlternateScreen, clearSelection, startSelection]);

  const handleMouseUp = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    // End scrollbar drag
    scrollbarDragRef.current.isDragging = false;

    // Check if we're in selection mode - complete selection (auto-copy)
    const selection = ptyId ? getSelection(ptyId) : undefined;
    if (selection?.isSelecting && ptyId) {
      const scrollState = getScrollState(ptyId);
      const scrollbackLength = scrollState?.scrollbackLength ?? 0;

      // Create a line getter that handles both scrollback and live terminal
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
      return;
    }

    handleMouseEvent(event, 'up');
  }, [handleMouseEvent, ptyId, getSelection, getScrollState, getEmulatorSync, getTerminalStateSync, completeSelection]);

  const handleMouseMove = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handleMouseEvent(event, 'move');
  }, [handleMouseEvent]);

  const handleMouseDrag = useCallback((event: OpenTUIMouseEvent) => {
    // Prevent default selection behavior during drag
    event.preventDefault();

    // Handle scrollbar dragging
    if (scrollbarDragRef.current.isDragging && ptyId) {
      const relY = event.y - y - 1;
      const newOffset = yToScrollOffset(relY);
      setScrollOffset(ptyId, newOffset);
      return;
    }

    // Check if we're in selection mode - update selection
    const selection = ptyId ? getSelection(ptyId) : undefined;
    if (selection?.isSelecting && ptyId) {
      const relX = event.x - x - 1;
      const relY = event.y - y - 1;
      const scrollState = getScrollState(ptyId);
      const scrollbackLength = scrollState?.scrollbackLength ?? 0;
      const scrollOffset = scrollState?.viewportOffset ?? 0;
      updateSelection(ptyId, relX, relY, scrollbackLength, scrollOffset);
      return;
    }

    handleMouseEvent(event, 'drag');
  }, [handleMouseEvent, ptyId, x, y, yToScrollOffset, setScrollOffset, getSelection, getScrollState, updateSelection]);

  const handleMouseScroll = useCallback((event: OpenTUIMouseEvent) => {
    if (!ptyId) return;

    // Calculate coordinates relative to pane content
    const relX = event.x - x - 1;
    const relY = event.y - y - 1;

    if (relX < 0 || relY < 0 || relX >= innerWidth || relY >= innerHeight) return;

    // Check if terminal is in alternate screen or has mouse tracking enabled
    // If so, forward scroll events to the PTY (apps like vim, htop need them)
    const shouldForwardToApp = isAlternateScreen(ptyId) || isMouseTrackingEnabled(ptyId);

    if (shouldForwardToApp && onMouseInput) {
      // Forward to PTY as SGR mouse sequences (existing behavior)
      const scrollUp = event.scroll?.delta && event.scroll.delta < 0;
      const button = scrollUp ? 4 : 5; // 4 = scroll up, 5 = scroll down

      const sequence = inputHandler.encodeMouse({
        type: 'scroll',
        button,
        x: relX,
        y: relY,
        shift: event.modifiers?.shift,
        alt: event.modifiers?.alt,
        ctrl: event.modifiers?.ctrl,
      });

      onMouseInput(sequence);
    } else {
      // Handle scroll locally - scroll through scrollback buffer
      // OpenTUI scroll events have direction: "up" | "down" | "left" | "right"
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        // Scroll up = look at older content = increase viewport offset
        scrollTerminal(ptyId, 1);
      } else if (direction === 'down') {
        // Scroll down = look at newer content = decrease viewport offset
        scrollTerminal(ptyId, -1);
      }
    }
  }, [ptyId, x, y, innerWidth, innerHeight, onMouseInput, isAlternateScreen, isMouseTrackingEnabled, scrollTerminal]);

  return (
    <box
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: width,
        height: height,
        border: true,
        borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
        borderColor: borderColor,
      }}
      title={displayTitle}
      titleAlignment="left"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseDrag={handleMouseDrag}
      onMouseScroll={handleMouseScroll}
    >
      {ptyId ? (
        <TerminalView
          ptyId={ptyId}
          width={innerWidth}
          height={innerHeight}
          isFocused={isFocused}
          offsetX={x + 1}
          offsetY={y + 1}
        />
      ) : children ?? (
        <box style={{ flexGrow: 1 }} />
      )}
    </box>
  );
}
