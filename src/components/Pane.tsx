/**
 * Pane component - individual terminal pane with border and focus state
 * Uses shared terminal-mouse-handler for selection logic
 */

import { onCleanup, createMemo, type JSX } from 'solid-js';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useSelection } from '../contexts/SelectionContext';
import { useTitle } from '../contexts/TitleContext';
import { TerminalView } from './TerminalView';
import { inputHandler } from '../terminal';
import { createTerminalMouseHandler } from './shared/terminal-mouse-handler';

/**
 * Border style mapping for OpenTUI
 * Maps theme border style names to OpenTUI BorderStyle type
 */
export const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
  single: 'single',
  double: 'double',
  rounded: 'rounded',
  bold: 'single', // fallback
};

interface PaneProps {
  id: string;
  title?: string;
  isFocused: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  ptyId?: string;
  hideTitle?: boolean;
  children?: JSX.Element;
  onClick?: () => void;
  onMouseInput?: (data: string) => void;
}

export function Pane(props: PaneProps) {
  const theme = useTheme();
  const terminal = useTerminal();
  const { isMouseTrackingEnabled, scrollTerminal, getScrollState, setScrollOffset, getEmulatorSync, getTerminalStateSync } = terminal;
  const selection = useSelection();
  const { startSelection, updateSelection, completeSelection, clearSelection, getSelection } = selection;
  const titleCtx = useTitle();

  // Calculate inner dimensions (account for border)
  const innerWidth = () => Math.max(1, props.width - 2);
  const innerHeight = () => Math.max(1, props.height - 2);

  // Create shared mouse handler for selection logic
  const mouseHandler = createTerminalMouseHandler({
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
  });

  // Track if we're dragging the scrollbar (pane-specific feature)
  let scrollbarDrag = {
    isDragging: false,
    startY: 0,
    startOffset: 0,
  };

  // Track scroll direction with hysteresis to prevent jitter from trackpad micro-movements
  // (pane-specific optimization)
  let committedDirection: 'up' | 'down' | null = null;
  let pendingDirection: 'up' | 'down' | null = null;
  let consecutiveCount = 0;

  // Cleanup on unmount
  onCleanup(() => {
    mouseHandler.cleanup();
  });

  // Check if a position is on the scrollbar (rightmost column when scrolled)
  const isOnScrollbar = (relX: number, relY: number): boolean => {
    if (!props.ptyId) return false;
    const scrollState = getScrollState(props.ptyId);
    // Scrollbar is shown when not at bottom
    if (!scrollState || scrollState.isAtBottom) return false;
    // Scrollbar is on the rightmost column
    return relX === innerWidth() - 1 && relY >= 0 && relY < innerHeight();
  };

  // Convert Y position to scroll offset
  const yToScrollOffset = (relY: number): number => {
    if (!props.ptyId) return 0;
    const scrollState = getScrollState(props.ptyId);
    if (!scrollState || scrollState.scrollbackLength === 0) return 0;
    // relY 0 = top = max offset, relY (innerHeight-1) = bottom = 0 offset
    const ratio = 1 - (relY / Math.max(1, innerHeight() - 1));
    return Math.round(ratio * scrollState.scrollbackLength);
  };

  // Dynamic border color based on focus state
  const borderColor = () => props.isFocused
    ? theme.pane.focusedBorderColor
    : theme.pane.borderColor;

  // Title with focus indicator
  // Read from TitleContext (non-reactive Map + version signal) to avoid layout store re-renders
  const displayTitle = createMemo(() => {
    // Hide title when rendering as a stacked tab (title shown in tab bar instead)
    if (props.hideTitle) return undefined;
    // Access titleVersion to create reactive dependency on title changes
    titleCtx.titleVersion();
    // Get title from TitleContext, fall back to prop for backwards compatibility
    const title = titleCtx.getTitle(props.id) ?? props.title;
    if (!title) return undefined;
    return ` ${title} `;
  });

  // Calculate relative coordinates
  const getRelativeCoords = (event: OpenTUIMouseEvent) => {
    const relX = event.x - props.x - 1;
    const relY = event.y - props.y - 1;
    return { relX, relY };
  };

  // Check if inside content area
  const isInsideContent = (relX: number, relY: number) => {
    return relX >= 0 && relY >= 0 && relX < innerWidth() && relY < innerHeight();
  };

  // Forward mouse event to PTY
  const forwardMouseEvent = (
    event: OpenTUIMouseEvent,
    type: 'down' | 'up' | 'move' | 'drag',
    relX: number,
    relY: number
  ) => {
    if (!props.onMouseInput) return;

    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });

    props.onMouseInput(sequence);
  };

  const handleMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    props.onClick?.();

    const { relX, relY } = getRelativeCoords(event);

    // Check if clicking on scrollbar (pane-specific)
    if (isOnScrollbar(relX, relY) && props.ptyId) {
      const scrollState = getScrollState(props.ptyId);
      scrollbarDrag = {
        isDragging: true,
        startY: relY,
        startOffset: scrollState?.viewportOffset ?? 0,
      };
      // Jump to clicked position
      setScrollOffset(props.ptyId, yToScrollOffset(relY));
      return;
    }

    if (!props.ptyId) return;
    if (!isInsideContent(relX, relY)) return;

    // Try selection first (shared logic)
    const handled = mouseHandler.handleSelectionMouseDown(
      props.ptyId, relX, relY, event.modifiers?.shift ?? false
    );
    if (handled) return;

    // Don't forward mouse down when scrolled back - we're in "history viewing" mode
    const scrollState = getScrollState(props.ptyId);
    if (scrollState && scrollState.viewportOffset > 0) return;

    forwardMouseEvent(event, 'down', relX, relY);
  };

  const handleMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    // End scrollbar drag (pane-specific)
    scrollbarDrag.isDragging = false;

    // Try to complete selection (shared logic, handles cleanup)
    if (props.ptyId && mouseHandler.handleSelectionMouseUp(props.ptyId)) {
      return;
    }

    if (!props.ptyId) return;

    // Don't forward mouse up when scrolled back - we're in "history viewing" mode
    const scrollState = getScrollState(props.ptyId);
    if (scrollState && scrollState.viewportOffset > 0) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(event, 'up', relX, relY);
  };

  const handleMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    if (!props.ptyId) return;

    // Only forward mouse move if app explicitly wants mouse input
    // (has mouse tracking enabled or is in alternate screen)
    if (!mouseHandler.appWantsMouse(props.ptyId)) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(event, 'move', relX, relY);
  };

  const handleMouseDrag = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    // Handle scrollbar dragging (pane-specific)
    if (scrollbarDrag.isDragging && props.ptyId) {
      const { relY } = getRelativeCoords(event);
      setScrollOffset(props.ptyId, yToScrollOffset(relY));
      return;
    }

    if (!props.ptyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Try selection drag (shared logic)
    const handled = mouseHandler.handleSelectionMouseDrag(
      props.ptyId, relX, relY, innerHeight()
    );
    if (handled) return;

    // Don't forward drag when scrolled back - we're in "history viewing" mode
    const scrollState = getScrollState(props.ptyId);
    if (scrollState && scrollState.viewportOffset > 0) return;

    if (!isInsideContent(relX, relY)) return;
    forwardMouseEvent(event, 'drag', relX, relY);
  };

  const handleMouseScroll = (event: OpenTUIMouseEvent) => {
    if (!props.ptyId) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    // Forward scroll to app if it wants mouse input
    if (mouseHandler.appWantsMouse(props.ptyId) && props.onMouseInput) {
      // Hysteresis to prevent jitter from trackpad micro-movements (pane-specific)
      const eventDir = event.scroll?.direction === 'up' ? 'up' : 'down' as const;
      const threshold = 2;

      if (eventDir === pendingDirection) {
        consecutiveCount++;
      } else {
        pendingDirection = eventDir;
        consecutiveCount = 1;
        if (committedDirection !== null && eventDir !== committedDirection) {
          committedDirection = null;
        }
      }

      if (consecutiveCount >= threshold) {
        committedDirection = eventDir;
      }

      if (committedDirection !== null && eventDir === committedDirection) {
        const button = committedDirection === 'up' ? 4 : 5;
        const sequence = inputHandler.encodeMouse({
          type: 'scroll',
          button,
          x: relX,
          y: relY,
          shift: event.modifiers?.shift,
          alt: event.modifiers?.alt,
          ctrl: event.modifiers?.ctrl,
        });
        props.onMouseInput(sequence);
      }
    } else {
      // Handle scroll locally
      const scrollSpeed = 3;
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        scrollTerminal(props.ptyId, scrollSpeed);
      } else if (direction === 'down') {
        scrollTerminal(props.ptyId, -scrollSpeed);
      }
    }
  };

  return (
    <box
      style={{
        position: 'absolute',
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        border: true,
        borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
        borderColor: borderColor(),
      }}
      title={displayTitle()}
      titleAlignment="left"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseDrag={handleMouseDrag}
      onMouseScroll={handleMouseScroll}
    >
      {props.ptyId ? (
        <TerminalView
          ptyId={props.ptyId}
          width={innerWidth()}
          height={innerHeight()}
          isFocused={props.isFocused}
          offsetX={props.x + 1}
          offsetY={props.y + 1}
        />
      ) : props.children ?? (
        <box style={{ flexGrow: 1 }} />
      )}
    </box>
  );
}
