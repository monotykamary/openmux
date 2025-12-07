/**
 * Pane component - individual terminal pane with border and focus state
 */

import { useCallback, type ReactNode } from 'react';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { useTheme } from '../contexts/ThemeContext';
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

  // Calculate inner dimensions (account for border)
  const innerWidth = Math.max(1, width - 2);
  const innerHeight = Math.max(1, height - 2);

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
    handleMouseEvent(event, 'down');
  }, [onClick, handleMouseEvent]);

  const handleMouseUp = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handleMouseEvent(event, 'up');
  }, [handleMouseEvent]);

  const handleMouseMove = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handleMouseEvent(event, 'move');
  }, [handleMouseEvent]);

  const handleMouseDrag = useCallback((event: OpenTUIMouseEvent) => {
    // Prevent default selection behavior during drag
    event.preventDefault();
    handleMouseEvent(event, 'drag');
  }, [handleMouseEvent]);

  const handleMouseScroll = useCallback((event: OpenTUIMouseEvent) => {
    if (!onMouseInput) return;

    // Calculate coordinates relative to pane content
    const relX = event.x - x - 1;
    const relY = event.y - y - 1;

    if (relX < 0 || relY < 0 || relX >= innerWidth || relY >= innerHeight) return;

    // Scroll direction from event.scroll
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
  }, [onMouseInput, x, y, innerWidth, innerHeight]);

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
