/**
 * Pane component - individual terminal pane with border and focus state
 */

import { onCleanup, type JSX } from 'solid-js';
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
  children?: JSX.Element;
  onClick?: () => void;
  onMouseInput?: (data: string) => void;
}

export function Pane(props: PaneProps) {
  const theme = useTheme();
  const { isMouseTrackingEnabled, isAlternateScreen, scrollTerminal, getScrollState, setScrollOffset, getEmulatorSync, getTerminalStateSync } = useTerminal();
  const { startSelection, updateSelection, completeSelection, clearSelection, getSelection } = useSelection();

  // Calculate inner dimensions (account for border)
  const innerWidth = () => Math.max(1, props.width - 2);
  const innerHeight = () => Math.max(1, props.height - 2);

  // Track if we're dragging the scrollbar (plain variable in Solid)
  let scrollbarDrag = {
    isDragging: false,
    startY: 0,
    startOffset: 0,
  };

  // Track auto-scroll during selection drag outside pane bounds
  let autoScroll: {
    direction: 'up' | 'down' | null;
    intervalId: ReturnType<typeof setInterval> | null;
  } = {
    direction: null,
    intervalId: null,
  };

  // Track pending selection start (set on mouse down, used on first drag)
  let pendingSelection: {
    x: number;
    y: number;
    scrollbackLength: number;
    scrollOffset: number;
  } | null = null;

  // Track scroll direction with hysteresis to prevent jitter from trackpad micro-movements
  let committedDirection: 'up' | 'down' | null = null;
  let pendingDirection: 'up' | 'down' | null = null;
  let consecutiveCount = 0;

  // Cleanup auto-scroll interval on unmount
  onCleanup(() => {
    if (autoScroll.intervalId) {
      clearInterval(autoScroll.intervalId);
    }
  });

  // Start or update auto-scroll
  const startAutoScroll = (direction: 'up' | 'down') => {
    if (autoScroll.direction === direction) return; // Already scrolling this direction

    // Clear existing interval
    if (autoScroll.intervalId) {
      clearInterval(autoScroll.intervalId);
    }

    autoScroll.direction = direction;
    autoScroll.intervalId = setInterval(() => {
      if (props.ptyId) {
        // Scroll up = increase offset (older content), scroll down = decrease offset (newer content)
        scrollTerminal(props.ptyId, direction === 'up' ? 1 : -1);
      }
    }, 50); // Scroll every 50ms for smooth scrolling
  };

  // Stop auto-scroll
  const stopAutoScroll = () => {
    if (autoScroll.intervalId) {
      clearInterval(autoScroll.intervalId);
      autoScroll.intervalId = null;
    }
    autoScroll.direction = null;
  };

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
  const displayTitle = () => props.title
    ? props.isFocused
      ? `● ${props.title}`
      : props.title
    : undefined;

  // Map borderStyle to OpenTUI BorderStyle type
  const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
    single: 'single',
    double: 'double',
    rounded: 'rounded',
    bold: 'single', // fallback
  };

  // Convert OpenTUI mouse event to PTY mouse sequence
  const handleMouseEvent = (event: OpenTUIMouseEvent, type: 'down' | 'up' | 'move' | 'drag' | 'scroll') => {
    if (!props.onMouseInput) return;

    // Calculate coordinates relative to pane content (subtract border)
    const relX = event.x - props.x - 1;
    const relY = event.y - props.y - 1;

    // Only forward if inside the content area
    if (relX < 0 || relY < 0 || relX >= innerWidth() || relY >= innerHeight()) return;

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
    // Prevent default selection behavior
    event.preventDefault();
    props.onClick?.();

    // Check if clicking on scrollbar
    const relX = event.x - props.x - 1;
    const relY = event.y - props.y - 1;
    if (isOnScrollbar(relX, relY) && props.ptyId) {
      // Start scrollbar drag
      const scrollState = getScrollState(props.ptyId);
      scrollbarDrag = {
        isDragging: true,
        startY: relY,
        startOffset: scrollState?.viewportOffset ?? 0,
      };
      // Jump to clicked position
      const newOffset = yToScrollOffset(relY);
      setScrollOffset(props.ptyId, newOffset);
      return;
    }

    // Check if should handle selection vs forward to PTY
    // Shift key overrides app mouse tracking to allow selection
    const appWantsMouse = props.ptyId && (isMouseTrackingEnabled(props.ptyId) || isAlternateScreen(props.ptyId));
    const shiftOverride = event.modifiers?.shift;
    const shouldSelect = !appWantsMouse || shiftOverride;

    if (shouldSelect && props.ptyId) {
      // Clear any existing selection and store pending selection start
      // Actual selection begins on drag, not on click (Zellij-style)
      clearSelection(props.ptyId);
      const scrollState = getScrollState(props.ptyId);
      pendingSelection = {
        x: relX,
        y: relY,
        scrollbackLength: scrollState?.scrollbackLength ?? 0,
        scrollOffset: scrollState?.viewportOffset ?? 0,
      };
      return;
    }

    handleMouseEvent(event, 'down');
  };

  const handleMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    // End scrollbar drag
    scrollbarDrag.isDragging = false;
    // Clear any pending selection (click without drag)
    pendingSelection = null;
    // Stop any auto-scrolling
    stopAutoScroll();

    // Check if we're in selection mode - complete selection (auto-copy)
    const selection = props.ptyId ? getSelection(props.ptyId) : undefined;
    if (selection?.isSelecting && props.ptyId) {
      const scrollState = getScrollState(props.ptyId);
      const scrollbackLength = scrollState?.scrollbackLength ?? 0;

      // Create a line getter that handles both scrollback and live terminal
      const getLine = (absoluteY: number) => {
        const emulator = getEmulatorSync(props.ptyId!);
        const state = getTerminalStateSync(props.ptyId!);
        if (absoluteY < scrollbackLength) {
          return emulator?.getScrollbackLine(absoluteY) ?? null;
        } else {
          const liveY = absoluteY - scrollbackLength;
          return state?.cells[liveY] ?? null;
        }
      };

      completeSelection(props.ptyId, scrollbackLength, getLine);
      return;
    }

    handleMouseEvent(event, 'up');
  };

  const handleMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handleMouseEvent(event, 'move');
  };

  const handleMouseDrag = (event: OpenTUIMouseEvent) => {
    // Prevent default selection behavior during drag
    event.preventDefault();

    // Handle scrollbar dragging
    if (scrollbarDrag.isDragging && props.ptyId) {
      const relY = event.y - props.y - 1;
      const newOffset = yToScrollOffset(relY);
      setScrollOffset(props.ptyId, newOffset);
      return;
    }

    const relX = event.x - props.x - 1;
    const relY = event.y - props.y - 1;

    // Check if we have a pending selection start (first drag after mouse down)
    if (pendingSelection && props.ptyId) {
      const pending = pendingSelection;
      // Start the actual selection from the original mouse down position
      startSelection(props.ptyId, pending.x, pending.y, pending.scrollbackLength, pending.scrollOffset);
      pendingSelection = null;
      // Continue to update selection below
    }

    // Check if we're in selection mode - update selection
    const selection = props.ptyId ? getSelection(props.ptyId) : undefined;
    if (selection?.isSelecting && props.ptyId) {
      // Auto-scroll when dragging outside pane bounds
      if (relY < 0) {
        // Dragging above the pane - scroll up (show older content)
        startAutoScroll('up');
      } else if (relY >= innerHeight()) {
        // Dragging below the pane - scroll down (show newer content)
        startAutoScroll('down');
      } else {
        // Inside pane bounds - stop auto-scrolling
        stopAutoScroll();
      }

      const scrollState = getScrollState(props.ptyId);
      const scrollbackLength = scrollState?.scrollbackLength ?? 0;
      const scrollOffset = scrollState?.viewportOffset ?? 0;

      // Clamp relY to valid range for selection update
      const clampedY = Math.max(0, Math.min(relY, innerHeight() - 1));
      updateSelection(props.ptyId, relX, clampedY, scrollbackLength, scrollOffset);
      return;
    }

    handleMouseEvent(event, 'drag');
  };

  const handleMouseScroll = (event: OpenTUIMouseEvent) => {
    if (!props.ptyId) return;

    // Calculate coordinates relative to pane content
    const relX = event.x - props.x - 1;
    const relY = event.y - props.y - 1;

    if (relX < 0 || relY < 0 || relX >= innerWidth() || relY >= innerHeight()) return;

    // Check if terminal is in alternate screen or has mouse tracking enabled
    // If so, forward scroll events to the PTY (apps like vim, htop need them)
    const shouldForwardToApp = isAlternateScreen(props.ptyId) || isMouseTrackingEnabled(props.ptyId);

    if (shouldForwardToApp && props.onMouseInput) {
      const eventDir = event.scroll?.direction === 'up' ? 'up' : 'down' as const;
      const threshold = 2; // Consecutive events needed to commit/change direction

      // Track consecutive events in the same direction
      if (eventDir === pendingDirection) {
        consecutiveCount++;
      } else {
        // Direction changed - reset and require re-confirmation
        pendingDirection = eventDir;
        consecutiveCount = 1;
        // Uncommit direction when we see a different direction
        // This prevents sending stale direction events during slow direction changes
        if (committedDirection !== null && eventDir !== committedDirection) {
          committedDirection = null;
        }
      }

      // Commit direction once threshold reached
      if (consecutiveCount >= threshold) {
        committedDirection = eventDir;
      }

      // Only send if direction is committed and matches current event
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
      // Handle scroll locally - scroll through scrollback buffer
      // OpenTUI scroll events have direction: "up" | "down" | "left" | "right"
      // Scroll by 3 lines per event for comfortable scrolling speed
      const scrollSpeed = 3;
      const direction = event.scroll?.direction;
      if (direction === 'up') {
        // Scroll up = look at older content = increase viewport offset
        scrollTerminal(props.ptyId, scrollSpeed);
      } else if (direction === 'down') {
        // Scroll down = look at newer content = decrease viewport offset
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
