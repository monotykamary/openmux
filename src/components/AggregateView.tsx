/**
 * AggregateView - fullscreen overlay for viewing PTYs across all workspaces.
 * Shows a filterable card-style list of PTYs on the left and interactive terminal on the right.
 *
 * Modes:
 * - List mode: Navigate PTY list with j/k, Enter to enter preview mode
 * - Preview mode: Interact with the terminal, Prefix+Esc to return to list
 */

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { type MouseEvent as OpenTUIMouseEvent, type OptimizedBuffer } from '@opentui/core';
import { useAggregateView, type PtyInfo } from '../contexts/AggregateViewContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useLayout } from '../contexts/LayoutContext';
import { useSession } from '../contexts/SessionContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useTheme } from '../contexts/ThemeContext';
import { getHostBackgroundColor, resizePty, subscribeUnifiedToPty, writeToPty, registerKeyboardHandler } from '../effect/bridge';
import { inputHandler } from '../terminal/input-handler';
import {
  WHITE,
  BLACK,
  getCachedRGBA,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_STRIKETHROUGH,
} from '../terminal/rendering';
import { getDirectoryName, findPtyLocation, findPaneLocation } from './aggregate/utils';
import type { TerminalState, TerminalCell, UnifiedTerminalUpdate } from '../core/types';

interface AggregateViewProps {
  width: number;
  height: number;
}

/**
 * Single PTY card in the list (2 lines: dir name + process, git branch)
 */
function PtyCard({
  pty,
  isSelected,
  maxWidth,
}: {
  pty: PtyInfo;
  isSelected: boolean;
  maxWidth: number;
}) {
  const selectMarker = isSelected ? '>' : ' ';
  const dirName = getDirectoryName(pty.cwd);
  const process = pty.foregroundProcess ?? 'shell';
  const gitBranch = pty.gitBranch;

  // First line: dirName (process)
  const line1 = `${selectMarker} ${dirName} (${process})`;

  // Second line: git branch (if available)
  const line2 = gitBranch ? `    ${gitBranch}` : '';

  // Use background color for selection, keep foreground neutral
  const fgColor = isSelected ? '#FFFFFF' : '#CCCCCC';
  const bgColor = isSelected ? '#3b82f6' : undefined;
  // Dim color needs to be readable - lighter on blue, darker otherwise
  const dimColor = isSelected ? '#93c5fd' : '#666666';

  return (
    <box style={{ flexDirection: 'column', height: 2 }} backgroundColor={bgColor}>
      <box style={{ height: 1 }}>
        <text fg={fgColor}>{line1.slice(0, maxWidth)}</text>
      </box>
      <box style={{ height: 1 }}>
        <text fg={dimColor}>{line2.slice(0, maxWidth)}</text>
      </box>
    </box>
  );
}

/**
 * Interactive terminal preview - renders terminal using direct buffer access for performance
 * Uses the same approach as the main TerminalView (renderAfter callback)
 */
function InteractivePreview({
  ptyId,
  width,
  height,
  isInteractive,
  offsetX = 0,
  offsetY = 0,
}: {
  ptyId: string | null;
  width: number;
  height: number;
  isInteractive: boolean;
  offsetX?: number;
  offsetY?: number;
}) {
  const lastResizeRef = useRef<{ ptyId: string; width: number; height: number } | null>(null);
  const terminalStateRef = useRef<TerminalState | null>(null);
  const renderRequestedRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const [version, setVersion] = useState(0);

  // Resize PTY when previewing to match preview dimensions
  useEffect(() => {
    if (!ptyId) return;

    // Only resize if dimensions actually changed
    const lastResize = lastResizeRef.current;
    if (lastResize && lastResize.ptyId === ptyId && lastResize.width === width && lastResize.height === height) {
      return;
    }

    // Resize the PTY to match the preview dimensions
    // When aggregate view closes, App.tsx will restore the original pane dimensions
    resizePty(ptyId, width, height);
    lastResizeRef.current = { ptyId, width, height };
  }, [ptyId, width, height]);

  // Subscribe to terminal updates
  useEffect(() => {
    // Clean up previous subscription first
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!ptyId) {
      terminalStateRef.current = null;
      setVersion(v => v + 1);
      return;
    }

    let mounted = true;
    let cachedRows: TerminalCell[][] = [];

    // Batched render request
    const requestRender = () => {
      if (!renderRequestedRef.current && mounted) {
        renderRequestedRef.current = true;
        queueMicrotask(() => {
          if (mounted) {
            renderRequestedRef.current = false;
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
          terminalStateRef.current = terminalUpdate.fullState;
          cachedRows = [...terminalUpdate.fullState.cells];
        } else {
          const existingState = terminalStateRef.current;
          if (existingState) {
            for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
              cachedRows[rowIdx] = newRow;
            }
            terminalStateRef.current = {
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
        unsubscribeRef.current = unsub;
      } else {
        unsub();
      }

      if (mounted) {
        requestRender();
      }
    };

    init();

    return () => {
      mounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      terminalStateRef.current = null;
      cachedRows = [];
    };
  }, [ptyId]);

  // Direct buffer render callback (same approach as TerminalView)
  const renderTerminal = useCallback((buffer: OptimizedBuffer) => {
    const state = terminalStateRef.current;
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
  }, [width, height, isInteractive, offsetX, offsetY]);

  if (!ptyId) {
    return (
      <box style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <text fg="#666666">No terminal selected</text>
      </box>
    );
  }

  if (!terminalStateRef.current) {
    return (
      <box style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <text fg="#666666">Loading...</text>
      </box>
    );
  }

  return (
    <box style={{ width, height }} renderAfter={renderTerminal} />
  );
}

export function AggregateView({ width, height }: AggregateViewProps) {
  const {
    state,
    closeAggregateView,
    setFilterQuery,
    navigateUp,
    navigateDown,
    enterPreviewMode,
    exitPreviewMode,
  } = useAggregateView();
  const { dispatch: kbDispatch } = useKeyboardState();
  const { state: layoutState, dispatch: layoutDispatch } = useLayout();
  const { state: sessionState, switchSession } = useSession();
  const { findSessionForPty } = useTerminal();
  const theme = useTheme();

  const {
    showAggregateView,
    filterQuery,
    matchedPtys,
    selectedIndex,
    selectedPtyId,
    previewMode,
  } = state;

  // Track prefix mode for prefix+esc to exit interactive mode
  const [prefixActive, setPrefixActive] = useState(false);
  const prefixTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track pending navigation after session switch
  const pendingPaneNavigationRef = useRef<string | null>(null);

  // Clear prefix timeout on unmount
  useEffect(() => {
    return () => {
      if (prefixTimeoutRef.current) {
        clearTimeout(prefixTimeoutRef.current);
      }
    };
  }, []);

  // Handle pending navigation after session switch
  useEffect(() => {
    const pendingPaneId = pendingPaneNavigationRef.current;
    if (!pendingPaneId) return;

    // Clear the pending navigation
    pendingPaneNavigationRef.current = null;

    // Find the workspace containing this pane in the current (newly loaded) workspaces
    const paneLocation = findPaneLocation(pendingPaneId, layoutState.workspaces);
    if (paneLocation) {
      layoutDispatch({ type: 'SWITCH_WORKSPACE', workspaceId: paneLocation.workspaceId });
    }
    layoutDispatch({ type: 'FOCUS_PANE', paneId: pendingPaneId });
  }, [sessionState.activeSessionId, layoutState.workspaces, layoutDispatch]);

  // Jump to the selected PTY's workspace and pane (supports cross-session jumps)
  const handleJumpToPty = useCallback(async () => {
    if (!selectedPtyId) return false;

    // Close aggregate view first
    closeAggregateView();
    kbDispatch({ type: 'EXIT_AGGREGATE_MODE' });

    // First, check if PTY is in the current session
    const location = findPtyLocation(selectedPtyId, layoutState.workspaces);
    if (location) {
      // PTY is in current session - navigate to it
      if (layoutState.activeWorkspaceId !== location.workspaceId) {
        layoutDispatch({ type: 'SWITCH_WORKSPACE', workspaceId: location.workspaceId });
      }
      layoutDispatch({ type: 'FOCUS_PANE', paneId: location.paneId });
      return true;
    }

    // PTY not in current session - check if it's in another session
    const sessionLocation = findSessionForPty(selectedPtyId);
    if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
      // Store the target pane ID for navigation after session loads
      pendingPaneNavigationRef.current = sessionLocation.paneId;

      // Switch to the other session - the effect will handle navigation after load
      await switchSession(sessionLocation.sessionId);

      return true;
    }

    return false;
  }, [selectedPtyId, layoutState.workspaces, layoutState.activeWorkspaceId, sessionState.activeSessionId, closeAggregateView, kbDispatch, layoutDispatch, findSessionForPty, switchSession]);

  // Handle keyboard input when aggregate view is open
  const handleKeyDown = useCallback(
    (event: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; sequence?: string }) => {
      if (!showAggregateView) return false;

      const { key } = event;
      const normalizedKey = key.toLowerCase();

      // In preview mode, most keys go to the PTY
      if (previewMode) {
        // Check for prefix key (Ctrl+B) to enter prefix mode
        if (event.ctrl && normalizedKey === 'b') {
          setPrefixActive(true);
          // Set timeout to clear prefix mode after 2 seconds
          if (prefixTimeoutRef.current) {
            clearTimeout(prefixTimeoutRef.current);
          }
          prefixTimeoutRef.current = setTimeout(() => {
            setPrefixActive(false);
          }, 2000);
          return true;
        }

        // Prefix+Escape exits preview mode (allows programs to use plain Esc)
        if (prefixActive && normalizedKey === 'escape') {
          setPrefixActive(false);
          if (prefixTimeoutRef.current) {
            clearTimeout(prefixTimeoutRef.current);
          }
          exitPreviewMode();
          return true;
        }

        // Clear prefix mode on any other key after prefix
        if (prefixActive) {
          setPrefixActive(false);
          if (prefixTimeoutRef.current) {
            clearTimeout(prefixTimeoutRef.current);
          }
        }

        // Forward key to PTY using inputHandler for proper encoding
        if (selectedPtyId) {
          const inputStr = inputHandler.encodeKey({
            key,
            ctrl: event.ctrl,
            alt: event.alt,
            shift: event.shift,
          });
          if (inputStr) {
            writeToPty(selectedPtyId, inputStr);
          }
        }
        return true;
      }

      // List mode keyboard handling
      if (normalizedKey === 'escape') {
        closeAggregateView();
        kbDispatch({ type: 'EXIT_AGGREGATE_MODE' });
        return true;
      }

      if (normalizedKey === 'down' || (normalizedKey === 'j' && !event.ctrl)) {
        navigateDown();
        return true;
      }

      if (normalizedKey === 'up' || (normalizedKey === 'k' && !event.ctrl)) {
        navigateUp();
        return true;
      }

      if (normalizedKey === 'return' || normalizedKey === 'enter') {
        // Enter preview mode (interactive terminal)
        if (selectedPtyId) {
          enterPreviewMode();
        }
        return true;
      }

      // Tab jumps to the PTY's workspace/pane
      if (normalizedKey === 'tab') {
        handleJumpToPty();
        return true;
      }

      if (normalizedKey === 'backspace') {
        setFilterQuery(filterQuery.slice(0, -1));
        return true;
      }

      // Single printable character - add to filter
      if (key.length === 1 && !event.ctrl && !event.alt) {
        setFilterQuery(filterQuery + key);
        return true;
      }

      return true; // Consume all keys while in aggregate view
    },
    [
      showAggregateView,
      filterQuery,
      selectedPtyId,
      previewMode,
      prefixActive,
      closeAggregateView,
      setFilterQuery,
      navigateUp,
      navigateDown,
      enterPreviewMode,
      exitPreviewMode,
      handleJumpToPty,
      kbDispatch,
    ]
  );

  // Register keyboard handler with KeyboardRouter
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    registerKeyboardHandler('aggregateView', handleKeyDown).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [handleKeyDown]);

  // Get host terminal background color to match user's theme
  const hostBgColor = useMemo(() => getHostBackgroundColor(), []);

  // Map borderStyle to OpenTUI BorderStyle type
  const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
    single: 'single',
    double: 'double',
    rounded: 'rounded',
    bold: 'single',
  };

  // Layout calculations
  // Reserve 1 row for footer (status bar with search + hints)
  const footerHeight = 1;
  const contentHeight = height - footerHeight;

  // Split width: list pane (35%) and preview pane (65%)
  const listPaneWidth = Math.floor(width * 0.35);
  const previewPaneWidth = width - listPaneWidth;

  // Inner dimensions (account for borders: -2 for left/right border)
  const listInnerWidth = Math.max(1, listPaneWidth - 2);
  const listInnerHeight = Math.max(1, contentHeight - 2);
  const previewInnerWidth = Math.max(1, previewPaneWidth - 2);
  const previewInnerHeight = Math.max(1, contentHeight - 2);

  // Each card is 2 lines, calculate max visible cards
  const maxVisibleCards = Math.floor(listInnerHeight / 2);

  // Mouse handler for preview pane
  const handlePreviewMouseEvent = useCallback((event: OpenTUIMouseEvent, type: 'down' | 'up' | 'move' | 'drag' | 'scroll') => {
    if (!previewMode || !selectedPtyId) return;

    // Calculate coordinates relative to preview content (subtract border and pane position)
    const previewX = listPaneWidth;
    const previewY = 0; // No header now, panes start at top
    const relX = event.x - previewX - 1;
    const relY = event.y - previewY - 1;

    // Only forward if inside the content area
    if (relX < 0 || relY < 0 || relX >= previewInnerWidth || relY >= previewInnerHeight) return;

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
  }, [previewMode, selectedPtyId, listPaneWidth, previewInnerWidth, previewInnerHeight]);

  const handlePreviewMouseDown = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'down');
  }, [handlePreviewMouseEvent]);

  const handlePreviewMouseUp = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'up');
  }, [handlePreviewMouseEvent]);

  const handlePreviewMouseMove = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'move');
  }, [handlePreviewMouseEvent]);

  const handlePreviewMouseDrag = useCallback((event: OpenTUIMouseEvent) => {
    event.preventDefault();
    handlePreviewMouseEvent(event, 'drag');
  }, [handlePreviewMouseEvent]);

  const handlePreviewMouseScroll = useCallback((event: OpenTUIMouseEvent) => {
    handlePreviewMouseEvent(event, 'scroll');
  }, [handlePreviewMouseEvent]);

  if (!showAggregateView) return null;

  // Build hints text based on mode
  const hintsText = previewMode
    ? 'Prefix+Esc: back to list'
    : '↑↓/jk: navigate | Enter: interact | Tab: jump | Esc: close';

  // Build search/filter text
  const filterText = `Filter: ${filterQuery}_`;

  // Calculate how much space hints need (right-aligned)
  const hintsWidth = hintsText.length;
  const filterWidth = width - hintsWidth - 2; // -2 for spacing

  // Use host terminal's background color to match user's theme
  return (
    <box
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: width,
        height: height,
        flexDirection: 'column',
      }}
      backgroundColor={hostBgColor}
    >
      {/* Main content - two panes side by side */}
      <box style={{ flexDirection: 'row', height: contentHeight }}>
        {/* Left pane - PTY list (bordered, highlighted when in list mode) */}
        <box
          style={{
            width: listPaneWidth,
            height: contentHeight,
            border: true,
            borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
            borderColor: previewMode ? theme.pane.borderColor : theme.pane.focusedBorderColor,
          }}
          title={`PTYs (${matchedPtys.length})`}
          titleAlignment="left"
        >
          <box style={{ flexDirection: 'column' }}>
            {matchedPtys.length > 0 ? (
              matchedPtys.slice(0, maxVisibleCards).map((pty, index) => (
                <PtyCard
                  key={pty.ptyId}
                  pty={pty}
                  isSelected={index === selectedIndex}
                  maxWidth={listInnerWidth}
                />
              ))
            ) : (
              <box style={{ height: 1 }}>
                <text fg="#666666">No PTYs match filter</text>
              </box>
            )}
          </box>
        </box>

        {/* Right pane - Terminal preview (bordered, with mouse support) */}
        <box
          style={{
            width: previewPaneWidth,
            height: contentHeight,
            border: true,
            borderStyle: borderStyleMap[theme.pane.borderStyle] ?? 'single',
            borderColor: previewMode ? theme.pane.focusedBorderColor : theme.pane.borderColor,
          }}
          onMouseDown={handlePreviewMouseDown}
          onMouseUp={handlePreviewMouseUp}
          onMouseMove={handlePreviewMouseMove}
          onMouseDrag={handlePreviewMouseDrag}
          onMouseScroll={handlePreviewMouseScroll}
        >
          <InteractivePreview
            ptyId={selectedPtyId}
            width={previewInnerWidth}
            height={previewInnerHeight}
            isInteractive={previewMode}
            offsetX={listPaneWidth + 1}
            offsetY={1}
          />
        </box>
      </box>

      {/* Footer status bar - search on left, hints on right */}
      <box style={{ height: 1, flexDirection: 'row' }}>
        <box style={{ width: filterWidth }}>
          <text fg="#CCCCCC">{filterText.slice(0, filterWidth)}</text>
        </box>
        <box style={{ width: hintsWidth + 2, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <text fg="#666666">{hintsText}</text>
        </box>
      </box>
    </box>
  );
}
