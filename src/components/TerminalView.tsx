/**
 * TerminalView - renders terminal state using direct buffer access for performance
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { RGBA, type OptimizedBuffer } from '@opentui/core';
import type { TerminalState, TerminalCell } from '../core/types';
import { ptyManager } from '../terminal';

interface TerminalViewProps {
  ptyId: string;
  width: number;
  height: number;
  isFocused: boolean;
  /** X offset in the parent buffer (for direct buffer rendering) */
  offsetX?: number;
  /** Y offset in the parent buffer (for direct buffer rendering) */
  offsetY?: number;
}

// Pre-allocate common colors for performance
const TRANSPARENT_BG = RGBA.fromValues(0, 0, 0, 0);
const WHITE = RGBA.fromInts(255, 255, 255);
const BLACK = RGBA.fromInts(0, 0, 0);

/**
 * Check if a cell has the default background marker color (0,0,1)
 * This is a fast inline check - the marker distinguishes default bg from explicit black
 */
const hasDefaultBgMarker = (cell: TerminalCell): boolean =>
  cell.bg.r === 0 && cell.bg.g === 0 && cell.bg.b === 1;

// Text attributes for buffer API
const ATTR_BOLD = 1;
const ATTR_ITALIC = 2;
const ATTR_UNDERLINE = 4;
const ATTR_STRIKETHROUGH = 8;

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export const TerminalView = memo(function TerminalView({
  ptyId,
  width,
  height,
  isFocused,
  offsetX = 0,
  offsetY = 0,
}: TerminalViewProps) {
  // Store terminal state in a ref to avoid React re-renders
  const terminalStateRef = useRef<TerminalState | null>(
    ptyManager.getTerminalState(ptyId) ?? null
  );
  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = ptyManager.subscribe(ptyId, (state) => {
      terminalStateRef.current = state;
      // Increment version to trigger re-render
      setVersion(v => v + 1);
    });

    return () => {
      unsubscribe();
    };
  }, [ptyId]);

  // Render callback that directly writes to buffer
  const renderTerminal = useCallback((buffer: OptimizedBuffer) => {
    const state = terminalStateRef.current;
    if (!state) return;

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);

    for (let y = 0; y < rows; y++) {
      const row = state.cells[y];
      if (!row) continue;

      for (let x = 0; x < cols; x++) {
        const cell = row[x];
        if (!cell) continue;

        // Check if this is the cursor position
        const isCursor = isFocused && state.cursor.visible &&
                         state.cursor.y === y && state.cursor.x === x;

        // Determine cell colors
        let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
        let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

        // Check if background is the default marker (0,0,1) - make transparent
        // This distinguishes default bg from explicit black (0,0,0) set by programs
        const useTransparentBg = hasDefaultBgMarker(cell);

        // Apply dim effect
        if (cell.dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }

        // Apply inverse
        if (cell.inverse) {
          [fgR, bgR] = [bgR, fgR];
          [fgG, bgG] = [bgG, fgG];
          [fgB, bgB] = [bgB, fgB];
        }

        let fg = RGBA.fromInts(fgR, fgG, fgB);
        let bg = useTransparentBg
          ? TRANSPARENT_BG
          : RGBA.fromInts(bgR, bgG, bgB);

        // Apply cursor styling
        if (isCursor) {
          fg = bg !== TRANSPARENT_BG ? bg : BLACK;
          bg = WHITE;
        }

        // Calculate attributes
        let attributes = 0;
        if (cell.bold) attributes |= ATTR_BOLD;
        if (cell.italic) attributes |= ATTR_ITALIC;
        if (cell.underline) attributes |= ATTR_UNDERLINE;
        if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

        // Write cell directly to buffer (with offset for pane position)
        buffer.setCell(x + offsetX, y + offsetY, cell.char, fg, bg, attributes);
      }
    }
  }, [width, height, isFocused, offsetX, offsetY]);

  const terminalState = terminalStateRef.current;

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

  return (
    <box
      style={{
        width,
        height,
      }}
      renderAfter={renderTerminal}
    />
  );
});

export default TerminalView;
