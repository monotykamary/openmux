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
import type { TerminalCell, SelectionBounds } from '../core/types';
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
 * The focus cell is excluded from selection (Zellij-style)
 */
interface SelectionRange {
  startX: number;
  startY: number;  // Absolute Y
  endX: number;
  endY: number;    // Absolute Y
  /** True if focus is at end position (forward selection), false if at start (backward) */
  focusAtEnd: boolean;
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
  /** Bounding box for O(1) spatial rejection in isCellSelected */
  bounds: SelectionBounds | null;
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
 * Tracks whether focus is at end (forward) or start (backward) for exclusion
 */
function normalizeSelection(
  anchor: SelectionPoint,
  focus: SelectionPoint
): SelectionRange {
  const anchorBefore =
    anchor.absoluteY < focus.absoluteY ||
    (anchor.absoluteY === focus.absoluteY && anchor.x <= focus.x);

  if (anchorBefore) {
    // Forward selection: focus is at end
    return {
      startX: anchor.x,
      startY: anchor.absoluteY,
      endX: focus.x,
      endY: focus.absoluteY,
      focusAtEnd: true,
    };
  } else {
    // Backward selection: focus is at start
    return {
      startX: focus.x,
      startY: focus.absoluteY,
      endX: anchor.x,
      endY: anchor.absoluteY,
      focusAtEnd: false,
    };
  }
}

/**
 * Calculate bounding box from normalized selection range
 * Enables O(1) spatial rejection in isCellSelected instead of per-cell checks
 */
function calculateBounds(range: SelectionRange): SelectionBounds {
  return {
    minX: Math.min(range.startX, range.endX),
    maxX: Math.max(range.startX, range.endX),
    minY: range.startY,
    maxY: range.endY,
  };
}

/**
 * Check if a cell at (x, absoluteY) is within the selection range
 * The focus cell is excluded (Zellij-style selection)
 */
function isCellInRange(
  x: number,
  absoluteY: number,
  range: SelectionRange
): boolean {
  const { startX, startY, endX, endY, focusAtEnd } = range;

  // Outside vertical bounds
  if (absoluteY < startY || absoluteY > endY) {
    return false;
  }

  // Single line selection
  if (startY === endY) {
    // Exclude the focus cell
    if (focusAtEnd) {
      // Forward: exclude end (focus), so x < endX
      return x >= startX && x < endX;
    } else {
      // Backward: exclude start (focus), so x > startX
      return x > startX && x <= endX;
    }
  }

  // Multi-line selection
  if (absoluteY === startY) {
    // First line
    if (!focusAtEnd) {
      // Backward selection: focus is at start, exclude startX
      return x > startX;
    }
    // Forward selection: include from startX to end of line
    return x >= startX;
  }
  if (absoluteY === endY) {
    // Last line
    if (focusAtEnd) {
      // Forward selection: focus is at end, exclude endX
      return x < endX;
    }
    // Backward selection: include from start of line to endX
    return x <= endX;
  }

  // Middle lines: entire line is selected
  return true;
}

/**
 * Extract text from the selected range
 * Respects focusAtEnd to exclude the focus cell (Zellij-style)
 */
function extractSelectedText(
  range: SelectionRange,
  scrollbackLength: number,
  getLine: LineGetter
): string {
  const { startX, startY, endX, endY, focusAtEnd } = range;
  const lines: string[] = [];

  for (let absY = startY; absY <= endY; absY++) {
    const row = getLine(absY);
    if (!row) continue;

    const isFirstRow = absY === startY;
    const isLastRow = absY === endY;
    const isSingleLine = startY === endY;

    // Determine start/end X for this row, respecting focus exclusion
    let rowStartX: number;
    let rowEndX: number;

    if (isSingleLine) {
      // Single line: exclude focus cell
      if (focusAtEnd) {
        rowStartX = startX;
        rowEndX = endX - 1;  // Exclude focus at end
      } else {
        rowStartX = startX + 1;  // Exclude focus at start
        rowEndX = endX;
      }
    } else if (isFirstRow) {
      // First row of multi-line
      if (!focusAtEnd) {
        // Backward: focus at start, exclude it
        rowStartX = startX + 1;
      } else {
        rowStartX = startX;
      }
      rowEndX = row.length - 1;
    } else if (isLastRow) {
      // Last row of multi-line
      rowStartX = 0;
      if (focusAtEnd) {
        // Forward: focus at end, exclude it
        rowEndX = endX - 1;
      } else {
        rowEndX = endX;
      }
    } else {
      // Middle row: entire line
      rowStartX = 0;
      rowEndX = row.length - 1;
    }

    // Skip if invalid range (can happen when focus == anchor)
    if (rowStartX > rowEndX) continue;

    // Extract text from row
    let rowText = '';
    for (let x = rowStartX; x <= Math.min(rowEndX, row.length - 1); x++) {
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
      const normalizedRange: SelectionRange = {
        startX: x,
        startY: absoluteY,
        endX: x,
        endY: absoluteY,
        focusAtEnd: true,  // Default to forward
      };

      selectionsRef.current.set(ptyId, {
        isSelecting: true,
        anchor: point,
        focus: point,
        normalizedRange,
        bounds: calculateBounds(normalizedRange),
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
        bounds: calculateBounds(normalizedRange),
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

      // Extract text (focus cell is already excluded by extractSelectedText)
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

  // Check if cell is selected (optimized with bounding box)
  const isCellSelected = useCallback(
    (ptyId: string, x: number, absoluteY: number): boolean => {
      const selection = selectionsRef.current.get(ptyId);
      if (!selection?.normalizedRange || !selection.bounds) return false;

      // Fast O(1) spatial rejection using bounding box
      const { bounds } = selection;
      if (absoluteY < bounds.minY || absoluteY > bounds.maxY) return false;
      if (absoluteY === bounds.minY && absoluteY === bounds.maxY) {
        // Single line: check X bounds
        if (x < bounds.minX || x > bounds.maxX) return false;
      }

      // Full check only for cells within bounds
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
