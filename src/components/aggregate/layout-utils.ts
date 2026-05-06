/**
 * Layout utilities for AggregateView
 * Provides dimension calculations for the aggregate layout
 */

import {
  formatComboSet,
  formatKeyCombo,
  type ResolvedKeybindingMap,
  type ResolvedKeybindings,
} from '../../core/keybindings';
import type { VimInputMode } from '../../core/vim-sequences';

export { borderStyleMap } from '../Pane';

/**
 * Layout dimension configuration
 */
export interface LayoutConfig {
  width: number;
  height: number;
  listPaneRatio?: number; // Default: 0.20 (20%)
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
  /** Maximum number of visible rows in list */
  maxVisibleCards: number;
  /** Footer height */
  footerHeight: number;
}

/**
 * Calculate layout dimensions from config
 */
export function calculateLayoutDimensions(config: LayoutConfig): LayoutDimensions {
  const { width, height, listPaneRatio = 0.2, footerHeight = 1 } = config;

  const contentHeight = height - footerHeight;
  const listPaneWidth = Math.floor(width * listPaneRatio);
  const previewPaneWidth = width - listPaneWidth;

  // Inner dimensions (account for borders: -2 for left/right border)
  const listInnerWidth = Math.max(1, listPaneWidth - 2);
  const listInnerHeight = Math.max(1, contentHeight - 2);
  const previewInnerWidth = Math.max(1, previewPaneWidth - 2);
  const previewInnerHeight = Math.max(1, contentHeight - 2);

  // Aggregate rows are single-line entries
  const maxVisibleCards = listInnerHeight;

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

function formatHintComboSet(combos: string[]): string {
  return formatComboSet(combos).replace(/ctrl\+([a-z])/gi, '^$1');
}

function formatGlobalActionHint(keybindings: ResolvedKeybindings, action: string): string {
  const direct = getCombos(keybindings.normal, action).map(formatKeyCombo);
  const prefixed = getCombos(keybindings.prefix, action).map(
    (combo) => `${formatKeyCombo(keybindings.prefixKey)} ${formatKeyCombo(combo)}`
  );
  return [...direct, ...prefixed].join('/') || '--';
}

export function getHintsText(
  inSearchMode: boolean,
  previewMode: boolean,
  previewZoomed: boolean,
  copyModeActive: boolean,
  keybindings: ResolvedKeybindings,
  showInactive: boolean,
  vimEnabled: boolean,
  vimMode: VimInputMode
): string {
  const aggregateBindings = keybindings.aggregate;

  if (vimEnabled && inSearchMode) {
    return 'n/N:next/prev enter:confirm q:cancel';
  }

  if (inSearchMode) {
    const confirm = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.confirm'));
    const cancel = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.cancel'));
    const next = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.next'));
    const prev = formatComboSet(getCombos(aggregateBindings.search, 'aggregate.search.prev'));
    return `${confirm}:confirm ${cancel}:cancel ${next}/${prev}:next/prev`;
  }

  if (copyModeActive) {
    return 'esc/q:exit enter/y:copy v/V/C-v:select';
  }

  if (previewMode) {
    const close = formatHintComboSet(
      getCombos(aggregateBindings.preview, 'aggregate.preview.exit')
    );
    const search = formatHintComboSet(
      getCombos(aggregateBindings.preview, 'aggregate.preview.search')
    );
    const zoom = formatGlobalActionHint(keybindings, 'pane.zoom');
    const kill = formatHintComboSet(getCombos(aggregateBindings.preview, 'aggregate.kill'));
    const newPane = formatHintComboSet(
      getCombos(aggregateBindings.preview, 'aggregate.preview.new.pane')
    );
    const ptyPicker = formatGlobalActionHint(keybindings, 'session.picker.toggle');
    const navCombos = [
      ...getCombos(aggregateBindings.preview, 'aggregate.preview.up'),
      ...getCombos(aggregateBindings.preview, 'aggregate.preview.down'),
    ];
    const navigate = formatHintComboSet(navCombos);
    const zoomLabel = previewZoomed ? 'unzoom' : 'zoom';
    return `${navigate}:nav ${search}:search ${ptyPicker}:ptys ${newPane}:new ${zoom}:${zoomLabel} ${kill}:kill ${close}:close`;
  }

  if (vimEnabled) {
    const jump = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.list.jump'));
    const newPane = formatHintComboSet(
      getCombos(aggregateBindings.list, 'aggregate.list.new.pane')
    );
    const toggleScope = formatHintComboSet(
      getCombos(aggregateBindings.list, 'aggregate.list.toggle.scope')
    );
    const kill = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.kill'));
    const ptyPicker = formatGlobalActionHint(keybindings, 'session.picker.toggle');
    const scopeLabel = showInactive ? 'all' : 'active';
    const modeHint = vimMode === 'insert' ? 'esc:normal' : 'i:filter';
    return `j/k:nav gg/G:jump enter:open/toggle ${newPane}:new ${jump}:jump ${toggleScope}:scope(${scopeLabel}) ${kill}:kill ${ptyPicker}:ptys q:close ${modeHint}`;
  }

  const navCombos = [
    ...getCombos(aggregateBindings.list, 'aggregate.list.up'),
    ...getCombos(aggregateBindings.list, 'aggregate.list.down'),
  ];
  const navigate = formatHintComboSet(navCombos);
  const interact = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.list.preview'));
  const jump = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.list.jump'));
  const newPane = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.list.new.pane'));
  const toggleScope = formatHintComboSet(
    getCombos(aggregateBindings.list, 'aggregate.list.toggle.scope')
  );
  const kill = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.kill'));
  const close = formatHintComboSet(getCombos(aggregateBindings.list, 'aggregate.list.close'));
  const ptyPicker = formatGlobalActionHint(keybindings, 'session.picker.toggle');
  const scopeLabel = showInactive ? 'all' : 'active';
  return `${navigate}:nav ${interact}:open/toggle ${newPane}:new ${jump}:jump ${toggleScope}:scope(${scopeLabel}) ${kill}:kill ${ptyPicker}:ptys ${close}:close`;
}
