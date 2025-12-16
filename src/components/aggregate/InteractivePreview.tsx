/**
 * Interactive terminal preview component for aggregate view
 * Renders terminal using direct buffer access for performance
 * Uses the same approach as the main TerminalView (renderAfter callback)
 */

import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { type OptimizedBuffer } from '@opentui/core';
import { resizePty, subscribeUnifiedToPty } from '../../effect/bridge';
import {
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
} from '../../terminal/rendering';
import type { TerminalState, TerminalCell, UnifiedTerminalUpdate } from '../../core/types';

interface InteractivePreviewProps {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}

export function InteractivePreview(props: InteractivePreviewProps) {
  // Plain variables (in Solid, no stale closure issues)
  let lastResize: { ptyId: string; width: number; height: number } | null = null;
  let terminalState: TerminalState | null = null;
  let renderRequested = false;
  let unsubscribe: (() => void) | null = null;
  let cachedRows: TerminalCell[][] = [];

  const [version, setVersion] = createSignal(0);

  // Resize PTY when previewing to match preview dimensions
  createEffect(() => {
    const ptyId = props.ptyId;
    if (!ptyId) return;

    // Only resize if dimensions actually changed
    if (lastResize && lastResize.ptyId === ptyId && lastResize.width === props.width && lastResize.height === props.height) {
      return;
    }

    // Resize the PTY to match the preview dimensions
    // When aggregate view closes, App.tsx will restore the original pane dimensions
    resizePty(ptyId, props.width, props.height);
    lastResize = { ptyId, width: props.width, height: props.height };
  });

  // Subscribe to terminal updates
  createEffect(() => {
    // Clean up previous subscription first
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    const ptyId = props.ptyId;
    if (!ptyId) {
      terminalState = null;
      setVersion(v => v + 1);
      return;
    }

    let mounted = true;
    cachedRows = [];

    // Batched render request
    const requestRender = () => {
      if (!renderRequested && mounted) {
        renderRequested = true;
        queueMicrotask(() => {
          if (mounted) {
            renderRequested = false;
            setVersion(v => v + 1);
          }
        });
      }
    };

    const init = async () => {
      const unsub = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
        if (!mounted) return;

        const { terminalUpdate } = update;

        if (terminalUpdate.isFull && terminalUpdate.fullState) {
          terminalState = terminalUpdate.fullState;
          cachedRows = [...terminalUpdate.fullState.cells];
        } else {
          const existingState = terminalState;
          if (existingState) {
            for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
              cachedRows[rowIdx] = newRow;
            }
            terminalState = {
              ...existingState,
              cells: cachedRows,
              cursor: terminalUpdate.cursor,
              alternateScreen: terminalUpdate.alternateScreen,
              mouseTracking: terminalUpdate.mouseTracking,
              cursorKeyMode: terminalUpdate.cursorKeyMode,
            };
          }
        }

        requestRender();
      });

      if (mounted) {
        unsubscribe = unsub;
      } else {
        unsub();
      }

      if (mounted) {
        requestRender();
      }
    };

    init();

    onCleanup(() => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      terminalState = null;
      cachedRows = [];
    });
  });

  // Direct buffer render callback (same approach as TerminalView)
  const renderTerminal = (buffer: OptimizedBuffer) => {
    const state = terminalState;
    const width = props.width;
    const height = props.height;
    const offsetX = props.offsetX ?? 0;
    const offsetY = props.offsetY ?? 0;
    const isInteractive = props.isInteractive;

    if (!state) {
      // Clear buffer when no state
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, BLACK, 0);
        }
      }
      return;
    }

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    const cursor = state.cursor;

    // Get fallback colors from top-left cell
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);

    for (let y = 0; y < rows; y++) {
      const row = state.cells[y];

      for (let x = 0; x < cols; x++) {
        const cell = row?.[x];

        if (!cell) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
          continue;
        }

        // Check cursor position (show cursor in interactive mode)
        const isCursor = isInteractive && cursor.visible && cursor.y === y && cursor.x === x;

        let fgR = cell.fg.r, fgG = cell.fg.g, fgB = cell.fg.b;
        let bgR = cell.bg.r, bgG = cell.bg.g, bgB = cell.bg.b;

        // Apply dim
        if (cell.dim) {
          fgR = Math.floor(fgR * 0.5);
          fgG = Math.floor(fgG * 0.5);
          fgB = Math.floor(fgB * 0.5);
        }

        // Apply inverse
        if (cell.inverse) {
          const tmpR = fgR; fgR = bgR; bgR = tmpR;
          const tmpG = fgG; fgG = bgG; bgG = tmpG;
          const tmpB = fgB; fgB = bgB; bgB = tmpB;
        }

        let fg = getCachedRGBA(fgR, fgG, fgB);
        let bg = getCachedRGBA(bgR, bgG, bgB);

        // Cursor styling
        if (isCursor) {
          fg = bg ?? BLACK;
          bg = WHITE;
        }

        // Calculate attributes
        let attributes = 0;
        if (cell.bold) attributes |= ATTR_BOLD;
        if (cell.italic) attributes |= ATTR_ITALIC;
        if (cell.underline) attributes |= ATTR_UNDERLINE;
        if (cell.strikethrough) attributes |= ATTR_STRIKETHROUGH;

        buffer.setCell(x + offsetX, y + offsetY, cell.char || ' ', fg, bg, attributes);
      }
    }

    // Fill unused area
    if (cols < width || rows < height) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
        }
      }
    }
  };

  // For Solid reactivity - version() triggers re-render
  const _v = () => version();

  return (
    <Show
      when={props.ptyId}
      fallback={
        <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
          <text fg="#666666">No terminal selected</text>
        </box>
      }
    >
      <Show
        when={terminalState || _v() >= 0}
        fallback={
          <box style={{ width: props.width, height: props.height, alignItems: 'center', justifyContent: 'center' }}>
            <text fg="#666666">Loading...</text>
          </box>
        }
      >
        <box style={{ width: props.width, height: props.height }} renderAfter={renderTerminal} />
      </Show>
    </Show>
  );
}
