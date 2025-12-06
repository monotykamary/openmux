/**
 * Pane component - individual terminal pane with border and focus state
 */

import type { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalView } from './TerminalView';

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
      onMouseDown={onClick}
    >
      {ptyId ? (
        <TerminalView
          ptyId={ptyId}
          width={innerWidth}
          height={innerHeight}
          isFocused={isFocused}
        />
      ) : children ?? (
        <box
          style={{
            flexGrow: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <text fg="#666666">
            {isFocused ? '[focused]' : `Pane ${id}`}
          </text>
        </box>
      )}
    </box>
  );
}
