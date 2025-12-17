/**
 * Layout utilities for AggregateView
 * Provides dimension calculations and style mappings
 */

/**
 * Border style mapping for OpenTUI
 */
export const borderStyleMap: Record<string, 'single' | 'double' | 'rounded'> = {
  single: 'single',
  double: 'double',
  rounded: 'rounded',
  bold: 'single',
};

/**
 * Layout dimension configuration
 */
export interface LayoutConfig {
  width: number;
  height: number;
  listPaneRatio?: number; // Default: 0.35 (35%)
  footerHeight?: number; // Default: 1
}

/**
 * Calculated layout dimensions
 */
export interface LayoutDimensions {
  /** Total content height (minus footer) */
  contentHeight: number;
  /** Width of the list pane (left side) */
  listPaneWidth: number;
  /** Width of the preview pane (right side) */
  previewPaneWidth: number;
  /** Inner width of list pane (minus borders) */
  listInnerWidth: number;
  /** Inner height of list pane (minus borders) */
  listInnerHeight: number;
  /** Inner width of preview pane (minus borders) */
  previewInnerWidth: number;
  /** Inner height of preview pane (minus borders) */
  previewInnerHeight: number;
  /** Maximum number of visible cards in list */
  maxVisibleCards: number;
  /** Footer height */
  footerHeight: number;
}

/**
 * Calculate layout dimensions from config
 */
export function calculateLayoutDimensions(config: LayoutConfig): LayoutDimensions {
  const { width, height, listPaneRatio = 0.35, footerHeight = 1 } = config;

  const contentHeight = height - footerHeight;
  const listPaneWidth = Math.floor(width * listPaneRatio);
  const previewPaneWidth = width - listPaneWidth;

  // Inner dimensions (account for borders: -2 for left/right border)
  const listInnerWidth = Math.max(1, listPaneWidth - 2);
  const listInnerHeight = Math.max(1, contentHeight - 2);
  const previewInnerWidth = Math.max(1, previewPaneWidth - 2);
  const previewInnerHeight = Math.max(1, contentHeight - 2);

  // Each card is 2 lines, calculate max visible cards
  const maxVisibleCards = Math.floor(listInnerHeight / 2);

  return {
    contentHeight,
    listPaneWidth,
    previewPaneWidth,
    listInnerWidth,
    listInnerHeight,
    previewInnerWidth,
    previewInnerHeight,
    maxVisibleCards,
    footerHeight,
  };
}

/**
 * Generate hints text based on current mode
 */
export function getHintsText(inSearchMode: boolean, previewMode: boolean): string {
  if (inSearchMode) {
    return 'Enter: confirm | Esc: cancel | ^n/^p: next/prev';
  }
  return previewMode
    ? 'Alt+Esc: back | Alt+F: search | Alt+X: kill'
    : '↑↓/jk: navigate | Enter: interact | Tab: jump | Alt+X: kill | Alt+Esc: close';
}

/**
 * Generate filter text with cursor
 */
export function getFilterText(filterQuery: string): string {
  return `Filter: ${filterQuery}_`;
}

/**
 * Calculate footer text widths
 */
export function calculateFooterWidths(totalWidth: number, hintsText: string) {
  const hintsWidth = hintsText.length;
  const filterWidth = totalWidth - hintsWidth - 2; // -2 for spacing
  return { hintsWidth, filterWidth };
}
