/**
 * TerminalView - renders terminal state using OpenTUI
 */

import { useState, useEffect, memo, type ReactNode } from 'react';
import type { TerminalState, TerminalCell } from '../core/types';
import { ptyManager } from '../terminal';

interface TerminalViewProps {
  ptyId: string;
  width: number;
  height: number;
  isFocused: boolean;
}

/**
 * Convert RGB to hex color string
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Check if color is default/transparent background
 * Includes pure black and ghostty's default background #1D1F21
 */
function isDefaultBackground(r: number, g: number, b: number): boolean {
  // Pure black
  if (r === 0 && g === 0 && b === 0) return true;
  // Ghostty default background #1D1F21 (29, 31, 33)
  if (r === 29 && g === 31 && b === 33) return true;
  return false;
}

/**
 * Adjust color for dim effect
 */
function dimColor(r: number, g: number, b: number): { r: number; g: number; b: number } {
  return {
    r: Math.floor(r * 0.5),
    g: Math.floor(g * 0.5),
    b: Math.floor(b * 0.5),
  };
}

/**
 * TerminalView component
 */
export const TerminalView = memo(function TerminalView({
  ptyId,
  width,
  height,
  isFocused,
}: TerminalViewProps) {
  // Initialize with current state to avoid flicker during layout changes
  const [terminalState, setTerminalState] = useState<TerminalState | null>(
    () => ptyManager.getTerminalState(ptyId) ?? null
  );

  useEffect(() => {
    // Subscribe to terminal state updates
    const unsubscribe = ptyManager.subscribe(ptyId, (state) => {
      setTerminalState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [ptyId]);

  if (!terminalState) {
    return (
      <box
        style={{
          width,
          height,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg="#666666">Loading terminal...</text>
      </box>
    );
  }

  // Render terminal content
  return (
    <box
      style={{
        width,
        height,
        flexDirection: 'column',
      }}
    >
      {terminalState.cells.slice(0, height).map((row, y) => (
        <TerminalRow
          key={y}
          row={row}
          y={y}
          width={width}
          cursor={terminalState.cursor}
          isFocused={isFocused}
        />
      ))}
    </box>
  );
});

interface TerminalRowProps {
  row: TerminalCell[];
  y: number;
  width: number;
  cursor: TerminalState['cursor'];
  isFocused: boolean;
}

interface SpanData {
  text: string;
  fg: string;
  bg: string | undefined;
}

/**
 * Render a single terminal row
 */
const TerminalRow = memo(function TerminalRow({
  row,
  y,
  width,
  cursor,
  isFocused,
}: TerminalRowProps) {
  // Build the row content with styled spans
  const spans: ReactNode[] = [];
  let currentSpan: SpanData | null = null;

  const flushSpan = (key: number) => {
    if (currentSpan && currentSpan.text.length > 0) {
      const { text, fg, bg } = currentSpan;

      spans.push(
        <text
          key={key}
          fg={fg}
          bg={bg}
        >
          {text}
        </text>
      );
    }
    currentSpan = null;
  };

  for (let x = 0; x < Math.min(row.length, width); x++) {
    const cell = row[x];
    if (!cell) continue;

    // Check if this is the cursor position
    const isCursor = isFocused && cursor.visible && cursor.y === y && cursor.x === x;

    // Determine cell colors
    let fgColor = cell.fg;
    let bgColor = cell.bg;

    // Apply dim effect by reducing brightness
    if (cell.dim) {
      fgColor = dimColor(fgColor.r, fgColor.g, fgColor.b);
    }

    // Apply inverse (swap fg/bg)
    if (cell.inverse) {
      const temp = fgColor;
      fgColor = bgColor;
      bgColor = temp;
    }

    let fg = rgbToHex(fgColor.r, fgColor.g, fgColor.b);
    let bg: string | undefined = undefined;

    // Only set bg if it's explicitly non-default (let terminal bg be transparent)
    if (!isDefaultBackground(bgColor.r, bgColor.g, bgColor.b)) {
      bg = rgbToHex(bgColor.r, bgColor.g, bgColor.b);
    }

    // Apply cursor styling (invert colors)
    if (isCursor) {
      const tempFg = fg;
      fg = bg ?? '#FFFFFF';
      bg = '#FFFFFF';
    }

    // Check if we can extend the current span
    const canExtend = currentSpan &&
      currentSpan.fg === fg &&
      currentSpan.bg === bg;

    if (canExtend) {
      currentSpan!.text += cell.char;
    } else {
      flushSpan(spans.length);
      currentSpan = {
        text: cell.char,
        fg,
        bg,
      };
    }
  }

  flushSpan(spans.length);

  // Pad remaining width with spaces if needed
  const renderedChars = row.slice(0, width).length;
  if (renderedChars < width) {
    spans.push(
      <text key="padding" fg="#FFFFFF">
        {' '.repeat(width - renderedChars)}
      </text>
    );
  }

  return (
    <box style={{ flexDirection: 'row', height: 1 }}>
      {spans}
    </box>
  );
});

export default TerminalView;
