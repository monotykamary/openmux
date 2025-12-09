/**
 * SelectionContext - manages text selection state for terminal panes
 *
 * Handles mouse-based selection with:
 * - Click-and-drag selection
 * - Auto-copy to clipboard on mouse release
 * - Selection clearing after copy
 * - Shift+click to override app mouse tracking
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TerminalCell } from '../core/types';
import { copyToClipboard } from '../effect/bridge';

// =============================================================================
// Types
// =============================================================================

/**
 * A point in the terminal, with both viewport and absolute coordinates
 */
interface SelectionPoint {
  /** Column (0-indexed) */
  x: number;
  /** Row in viewport (0-indexed) */
  y: number;
  /** Absolute row including scrollback */
  absoluteY: number;
}

/**
 * Normalized selection range (start is always before end)
 */
interface SelectionRange {
  startX: number;
  startY: number;  // Absolute Y
  endX: number;
  endY: number;    // Absolute Y
}

/**
 * Selection state for a single pane
 */
interface PaneSelection {
  /** Whether the mouse is currently down and dragging */
  isSelecting: boolean;
  /** Where the selection started */
  anchor: SelectionPoint | null;
  /** Where the selection currently ends */
  focus: SelectionPoint | null;
  /** Normalized range for efficient cell checking */
  normalizedRange: SelectionRange | null;
}

/**
 * Function to get a line of cells from the terminal
 */
type LineGetter = (absoluteY: number) => TerminalCell[] | null;

/**
 * Copy notification state
 */
interface CopyNotificationState {
  visible: boolean;
  charCount: number;
  /** The ptyId of the pane where copy occurred */
  ptyId: string | null;
}

/**
 * Selection context value
 */
interface SelectionContextValue {
  /**
   * Start a new selection on mouse down
   */
  startSelection(
    ptyId: string,
    x: number,
    y: number,
    scrollbackLength: number,
    scrollOffset: number
  ): void;

  /**
   * Update selection on mouse drag
   */
  updateSelection(
    ptyId: string,
    x: number,
    y: number,
    scrollbackLength: number,
    scrollOffset: number
  ): void;

  /**
   * Complete selection on mouse up (auto-copy and clear)
   */
  completeSelection(
    ptyId: string,
    scrollbackLength: number,
    getLine: LineGetter
  ): Promise<void>;

  /**
   * Clear selection for a pane
   */
  clearSelection(ptyId: string): void;

  /**
   * Clear all selections (for keyboard input)
   */
  clearAllSelections(): void;

  /**
   * Check if a cell is selected
   */
  isCellSelected(ptyId: string, x: number, absoluteY: number): boolean;

  /**
   * Get the current selection for a pane
   */
  getSelection(ptyId: string): PaneSelection | undefined;

  /**
   * Version counter for triggering re-renders
   */
  selectionVersion: number;

  /**
   * Copy notification state (for showing "Copied X chars" toast)
   */
  copyNotification: CopyNotificationState;
}

// =============================================================================
// Context
// =============================================================================

const SelectionContext = createContext<SelectionContextValue | null>(null);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate absolute Y from viewport Y
 */
function toAbsoluteY(y: number, scrollbackLength: number, scrollOffset: number): number {
  return scrollbackLength - scrollOffset + y;
}

/**
 * Normalize selection so start is always before end
 */
function normalizeSelection(
  anchor: SelectionPoint,
  focus: SelectionPoint
): SelectionRange {
  const anchorBefore =
    anchor.absoluteY < focus.absoluteY ||
    (anchor.absoluteY === focus.absoluteY && anchor.x <= focus.x);

  if (anchorBefore) {
    return {
      startX: anchor.x,
      startY: anchor.absoluteY,
      endX: focus.x,
      endY: focus.absoluteY,
    };
  } else {
    return {
      startX: focus.x,
      startY: focus.absoluteY,
      endX: anchor.x,
      endY: anchor.absoluteY,
    };
  }
}

/**
 * Check if a cell at (x, absoluteY) is within the selection range
 */
function isCellInRange(
  x: number,
  absoluteY: number,
  range: SelectionRange
): boolean {
  const { startX, startY, endX, endY } = range;

  // Outside vertical bounds
  if (absoluteY < startY || absoluteY > endY) {
    return false;
  }

  // Single line selection
  if (startY === endY) {
    return x >= startX && x <= endX;
  }

  // Multi-line selection
  if (absoluteY === startY) {
    // First line: from startX to end of line
    return x >= startX;
  }
  if (absoluteY === endY) {
    // Last line: from start of line to endX
    return x <= endX;
  }

  // Middle lines: entire line is selected
  return true;
}

/**
 * Extract text from the selected range
 */
function extractSelectedText(
  range: SelectionRange,
  scrollbackLength: number,
  getLine: LineGetter
): string {
  const lines: string[] = [];

  for (let absY = range.startY; absY <= range.endY; absY++) {
    const row = getLine(absY);
    if (!row) continue;

    // Determine start/end X for this row
    const isFirstRow = absY === range.startY;
    const isLastRow = absY === range.endY;
    const startX = isFirstRow ? range.startX : 0;
    const endX = isLastRow ? range.endX : row.length - 1;

    // Extract text from row
    let rowText = '';
    for (let x = startX; x <= Math.min(endX, row.length - 1); x++) {
      const cell = row[x];
      if (!cell) continue;

      rowText += cell.char;

      // Skip placeholder cell for wide characters
      if (cell.width === 2) {
        x++;
      }
    }

    // Trim trailing whitespace from each line
    lines.push(rowText.trimEnd());
  }

  return lines.join('\n');
}

// =============================================================================
// Provider
// =============================================================================

interface SelectionProviderProps {
  children: ReactNode;
}

export function SelectionProvider({ children }: SelectionProviderProps) {
  // Store selections in a ref for synchronous access
  const selectionsRef = useRef<Map<string, PaneSelection>>(new Map());

  // Version counter to trigger re-renders when selection changes
  const [selectionVersion, setSelectionVersion] = useState(0);

  // Copy notification state
  const [copyNotification, setCopyNotification] = useState<CopyNotificationState>({
    visible: false,
    charCount: 0,
    ptyId: null,
  });

  // Timer ref for auto-hiding notification
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Increment version to trigger re-render
  const notifyChange = useCallback(() => {
    setSelectionVersion((v) => v + 1);
  }, []);

  // Show copy notification briefly
  const showCopyNotification = useCallback((charCount: number, ptyId: string) => {
    // Clear any existing timer
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }

    // Show notification
    setCopyNotification({ visible: true, charCount, ptyId });

    // Auto-hide after 2 seconds
    notificationTimerRef.current = setTimeout(() => {
      setCopyNotification({ visible: false, charCount: 0, ptyId: null });
      notificationTimerRef.current = null;
    }, 2000);
  }, []);

  // Start selection
  const startSelection = useCallback(
    (
      ptyId: string,
      x: number,
      y: number,
      scrollbackLength: number,
      scrollOffset: number
    ) => {
      const absoluteY = toAbsoluteY(y, scrollbackLength, scrollOffset);
      const point: SelectionPoint = { x, y, absoluteY };

      selectionsRef.current.set(ptyId, {
        isSelecting: true,
        anchor: point,
        focus: point,
        normalizedRange: {
          startX: x,
          startY: absoluteY,
          endX: x,
          endY: absoluteY,
        },
      });

      notifyChange();
    },
    [notifyChange]
  );

  // Update selection
  const updateSelection = useCallback(
    (
      ptyId: string,
      x: number,
      y: number,
      scrollbackLength: number,
      scrollOffset: number
    ) => {
      const selection = selectionsRef.current.get(ptyId);
      if (!selection?.isSelecting || !selection.anchor) return;

      const absoluteY = toAbsoluteY(y, scrollbackLength, scrollOffset);
      const focus: SelectionPoint = { x, y, absoluteY };
      const normalizedRange = normalizeSelection(selection.anchor, focus);

      selectionsRef.current.set(ptyId, {
        ...selection,
        focus,
        normalizedRange,
      });

      notifyChange();
    },
    [notifyChange]
  );

  // Complete selection (auto-copy and clear)
  const completeSelection = useCallback(
    async (
      ptyId: string,
      scrollbackLength: number,
      getLine: LineGetter
    ): Promise<void> => {
      const selection = selectionsRef.current.get(ptyId);
      if (!selection?.normalizedRange) {
        // Clear anyway
        selectionsRef.current.delete(ptyId);
        notifyChange();
        return;
      }

      // Extract text
      const text = extractSelectedText(
        selection.normalizedRange,
        scrollbackLength,
        getLine
      );

      // Copy to clipboard if there's text
      if (text.length > 0) {
        await copyToClipboard(text);
        // Show notification
        showCopyNotification(text.length, ptyId);
      }

      // Clear selection
      selectionsRef.current.delete(ptyId);
      notifyChange();
    },
    [notifyChange, showCopyNotification]
  );

  // Clear selection for a pane
  const clearSelection = useCallback(
    (ptyId: string) => {
      if (selectionsRef.current.has(ptyId)) {
        selectionsRef.current.delete(ptyId);
        notifyChange();
      }
    },
    [notifyChange]
  );

  // Clear all selections
  const clearAllSelections = useCallback(() => {
    if (selectionsRef.current.size > 0) {
      selectionsRef.current.clear();
      notifyChange();
    }
  }, [notifyChange]);

  // Check if cell is selected
  const isCellSelected = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const selection = selectionsRef.current.get(ptyId);
      if (!selection?.normalizedRange) return false;
      return isCellInRange(x, absoluteY, selection.normalizedRange);
    },
    []
  );

  // Get selection for a pane
  const getSelection = useCallback((ptyId: string): PaneSelection | undefined => {
    return selectionsRef.current.get(ptyId);
  }, []);

  const value: SelectionContextValue = {
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    clearAllSelections,
    isCellSelected,
    getSelection,
    selectionVersion,
    copyNotification,
  };

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
