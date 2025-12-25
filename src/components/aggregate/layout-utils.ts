/**
 * Layout utilities for AggregateView
 * Provides dimension calculations for the aggregate layout
 */

import { formatComboSet, type ResolvedKeybindingMap, type ResolvedKeybindings } from '../../core/keybindings';

// Re-export borderStyleMap from Pane for convenience
export { borderStyleMap } from '../Pane';

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

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function getHintsText(
  inSearchMode: boolean,
  previewMode: boolean,
  keybindings: ResolvedKeybindings
): string {
  const aggregateBindings = keybindings.aggregate;

  if (inSearchMode) {
    const confirm = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.confirm'));
    const cancel = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.cancel'));
    const next = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.next'));
    const prev = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.prev'));
    return `${confirm}: confirm | ${cancel}: cancel | ${next}/${prev}: next/prev`;
  }

  if (previewMode) {
    const back = formatComboSet(getCombos(aggregateBindings.preview, 'aggregate.preview.exit'));
    const search = formatComboSet(getCombos(aggregateBindings.preview, 'aggregate.preview.search'));
    const kill = formatComboSet(getCombos(aggregateBindings.preview, 'aggregate.kill'));
    return `${back}: back | ${search}: search | ${kill}: kill`;
  }

  const navCombos = [
    ...getCombos(aggregateBindings.list, 'aggregate.list.up'),
    ...getCombos(aggregateBindings.list, 'aggregate.list.down'),
  ];
  const navigate = formatComboSet(navCombos);
  const interact = formatComboSet(getCombos(aggregateBindings.list, 'aggregate.list.preview'));
  const jump = formatComboSet(getCombos(aggregateBindings.list, 'aggregate.list.jump'));
  const kill = formatComboSet(getCombos(aggregateBindings.list, 'aggregate.kill'));
  const close = formatComboSet(getCombos(aggregateBindings.list, 'aggregate.list.close'));
  return `${navigate}: navigate | ${interact}: interact | ${jump}: jump | ${kill}: kill | ${close}: close`;
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
