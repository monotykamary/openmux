/**
 * SelectionContext - manages text selection state for terminal panes
 *
 * Handles mouse-based selection with:
 * - Click-and-drag selection
 * - Auto-copy to clipboard on mouse release
 * - Selection clearing after copy
 * - Shift+click to override app mouse tracking
 */

import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import type { SelectionBounds } from '../core/types';
import { copyToClipboard } from '../effect/bridge';
import {
  type SelectionPoint,
  type SelectionRange,
  type LineGetter,
  toAbsoluteY,
  normalizeSelection,
  calculateBounds,
  isCellInRange,
  extractSelectedText,
} from '../core/coordinates';

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
// Provider
// =============================================================================

interface SelectionProviderProps extends ParentProps {}

export function SelectionProvider(props: SelectionProviderProps) {
  // Store selections in a Map - plain variable since we use signals for reactivity
  const selections = new Map<string, PaneSelection>();

  // Version counter to trigger re-renders when selection changes
  const [selectionVersion, setSelectionVersion] = createSignal(0);

  // Copy notification state
  const [copyNotification, setCopyNotification] = createSignal<CopyNotificationState>({
    visible: false,
    charCount: 0,
    ptyId: null,
  });

  // Timer for auto-hiding notification
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;

  // Cleanup on unmount
  onCleanup(() => {
    if (notificationTimer) {
      clearTimeout(notificationTimer);
    }
  });

  // Increment version to trigger re-render
  const notifyChange = () => {
    setSelectionVersion((v) => v + 1);
  };

  // Show copy notification briefly
  const showCopyNotification = (charCount: number, ptyId: string) => {
    // Clear any existing timer
    if (notificationTimer) {
      clearTimeout(notificationTimer);
    }

    // Show notification
    setCopyNotification({ visible: true, charCount, ptyId });

    // Auto-hide after 2 seconds
    notificationTimer = setTimeout(() => {
      setCopyNotification({ visible: false, charCount: 0, ptyId: null });
      notificationTimer = null;
    }, 2000);
  };

  // Start selection
  const startSelection = (
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

    selections.set(ptyId, {
      isSelecting: true,
      anchor: point,
      focus: point,
      normalizedRange,
      bounds: calculateBounds(normalizedRange),
    });

    notifyChange();
  };

  // Update selection
  const updateSelection = (
    ptyId: string,
    x: number,
    y: number,
    scrollbackLength: number,
    scrollOffset: number
  ) => {
    const selection = selections.get(ptyId);
    if (!selection?.isSelecting || !selection.anchor) return;

    const absoluteY = toAbsoluteY(y, scrollbackLength, scrollOffset);
    const focus: SelectionPoint = { x, y, absoluteY };
    const normalizedRange = normalizeSelection(selection.anchor, focus);

    selections.set(ptyId, {
      ...selection,
      focus,
      normalizedRange,
      bounds: calculateBounds(normalizedRange),
    });

    notifyChange();
  };

  // Complete selection (auto-copy and clear)
  const completeSelection = async (
    ptyId: string,
    scrollbackLength: number,
    getLine: LineGetter
  ): Promise<void> => {
    const selection = selections.get(ptyId);
    if (!selection?.normalizedRange) {
      // Clear anyway
      selections.delete(ptyId);
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
    selections.delete(ptyId);
    notifyChange();
  };

  // Clear selection for a pane
  const clearSelection = (ptyId: string) => {
    if (selections.has(ptyId)) {
      selections.delete(ptyId);
      notifyChange();
    }
  };

  // Clear all selections
  const clearAllSelections = () => {
    if (selections.size > 0) {
      selections.clear();
      notifyChange();
    }
  };

  // Check if cell is selected (optimized with bounding box)
  // Note: In Solid, this is synchronous access - no stale closure issues
  const isCellSelected = (ptyId: string, x: number, absoluteY: number): boolean => {
    const selection = selections.get(ptyId);
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
  };

  // Get selection for a pane
  const getSelection = (ptyId: string): PaneSelection | undefined => {
    return selections.get(ptyId);
  };

  const value: SelectionContextValue = {
    startSelection,
    updateSelection,
    completeSelection,
    clearSelection,
    clearAllSelections,
    isCellSelected,
    getSelection,
    get selectionVersion() { return selectionVersion(); },
    get copyNotification() { return copyNotification(); },
  };

  return (
    <SelectionContext.Provider value={value}>
      {props.children}
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
