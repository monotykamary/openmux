/**
 * Keyboard handler functions
 */

import type { WorkspaceId } from '../../core/types';
import type { useLayout } from '../LayoutContext';
import { keyToDirection } from '../../core/keyboard-utils';
import type { KeyboardContextValue, LAYOUT_MODES } from './types';

const LAYOUT_MODES_ARRAY: Array<'vertical' | 'horizontal' | 'stacked'> = ['vertical', 'horizontal', 'stacked'];

/**
 * Handle Alt key combinations (prefix-less actions)
 */
export function handleAltKey(
  key: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  onNewPane?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void,
  onToggleAggregateView?: () => void,
  onRequestClosePane?: () => void
): boolean {
  // Alt+hjkl for navigation
  const direction = keyToDirection(key);
  if (direction) {
    layout.navigate(direction);
    return true;
  }

  // Alt+1-9 for workspace switching
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layout.switchWorkspace(workspaceId);
    return true;
  }

  switch (key) {
    // Alt+n or Alt+Enter for new pane
    case 'n':
    case 'Enter':
      if (onNewPane) {
        onNewPane();
      } else {
        layout.newPane();
      }
      return true;

    // Alt+[ to cycle layout mode backward
    case '[':
      {
        const currentIndex = LAYOUT_MODES_ARRAY.indexOf(currentLayoutMode);
        const newIndex = (currentIndex - 1 + LAYOUT_MODES_ARRAY.length) % LAYOUT_MODES_ARRAY.length;
        layout.setLayoutMode(LAYOUT_MODES_ARRAY[newIndex]!);
      }
      return true;

    // Alt+] to cycle layout mode forward
    case ']':
      {
        const currentIndex = LAYOUT_MODES_ARRAY.indexOf(currentLayoutMode);
        const newIndex = (currentIndex + 1) % LAYOUT_MODES_ARRAY.length;
        layout.setLayoutMode(LAYOUT_MODES_ARRAY[newIndex]!);
      }
      return true;

    // Alt+x to close pane (with confirmation)
    case 'x':
      if (onRequestClosePane) {
        onRequestClosePane();
      } else {
        layout.closePane();
      }
      return true;

    // Alt+z to toggle zoom
    case 'z':
      layout.toggleZoom();
      return true;

    // Alt+s to toggle session picker
    case 's':
      onToggleSessionPicker?.();
      return true;

    // Alt+f to open search
    case 'f':
      if (onEnterSearch) {
        keyboard.enterSearchMode();
        onEnterSearch();
        return true;
      }
      return false;

    // Alt+g to toggle aggregate view (global view)
    case 'g':
      if (onToggleAggregateView) {
        keyboard.enterAggregateMode();
        onToggleAggregateView();
        return true;
      }
      return false;

    // Alt+m to enter move mode
    case 'm':
      keyboard.enterMoveMode();
      return true;

    default:
      return false;
  }
}

/**
 * Handle prefix mode key combinations
 */
export function handlePrefixModeKey(
  key: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  onPaste?: () => void,
  onNewPane?: () => void,
  onQuit?: () => void,
  onDetach?: () => void,
  onRequestQuit?: () => void,
  onRequestClosePane?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void,
  onToggleConsole?: () => void,
  onToggleAggregateView?: () => void
): boolean {
  const exitPrefix = () => keyboard.exitPrefixMode();

  // Navigation (hjkl like vim/i3)
  const direction = keyToDirection(key);
  if (direction) {
    layout.navigate(direction);
    exitPrefix();
    return true;
  }

  // Workspace switching (1-9)
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layout.switchWorkspace(workspaceId);
    exitPrefix();
    return true;
  }

  switch (key) {
    // New pane (single key instead of | and -)
    case 'n':
    case 'Enter':
      if (onNewPane) {
        onNewPane();
      } else {
        layout.newPane();
      }
      exitPrefix();
      return true;

    // Close pane (with confirmation)
    case 'x':
      if (onRequestClosePane) {
        onRequestClosePane();
      } else {
        layout.closePane();
      }
      exitPrefix();
      return true;

    // Layout mode: vertical (panes side by side)
    case 'v':
      layout.setLayoutMode('vertical');
      exitPrefix();
      return true;

    // Session picker (prefix + s)
    case 's':
      onToggleSessionPicker?.();
      exitPrefix();
      return true;

    // Layout mode: horizontal (panes stacked top/bottom) - now 'h' instead of 's'
    case 'H':
      layout.setLayoutMode('horizontal');
      exitPrefix();
      return true;

    // Layout mode: stacked (tabs)
    case 't':
      layout.setLayoutMode('stacked');
      exitPrefix();
      return true;

    // Paste from clipboard (like tmux prefix + ])
    case ']':
    case 'p':
      onPaste?.();
      exitPrefix();
      return true;

    // Toggle zoom on focused pane
    case 'z':
      layout.toggleZoom();
      exitPrefix();
      return true;

    // Toggle hints
    case '?':
      keyboard.toggleHints();
      return true;

    // Quit openmux (with confirmation)
    case 'q':
      if (onRequestQuit) {
        onRequestQuit();
      } else {
        onQuit?.();
      }
      return true;

    // Detach (tmux-style)
    case 'd':
      onDetach?.();
      exitPrefix();
      return true;

    // Toggle debug console
    case '`':
      onToggleConsole?.();
      exitPrefix();
      return true;

    // Search mode (vim-style)
    case '/':
      if (onEnterSearch) {
        keyboard.enterSearchMode();
        onEnterSearch();
        // Don't call exitPrefix() here - enterSearchMode already handles the mode transition
        return true;
      }
      exitPrefix();
      return true;

    // Aggregate view (global view)
    case 'g':
      if (onToggleAggregateView) {
        keyboard.enterAggregateMode();
        onToggleAggregateView();
        // Don't call exitPrefix() here - enterAggregateMode already handles the mode transition
        return true;
      }
      exitPrefix();
      return true;

    // Move mode
    case 'm':
      keyboard.enterMoveMode();
      return true;

    default:
      return false;
  }
}
