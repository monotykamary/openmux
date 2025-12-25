/**
 * Keyboard handler functions
 */

import type { Direction, WorkspaceId } from '../../core/types';
import type { useLayout } from '../LayoutContext';
import type { KeyboardContextValue, KeyboardHandlerOptions } from './types';

const LAYOUT_MODES_ARRAY: Array<'vertical' | 'horizontal' | 'stacked'> = ['vertical', 'horizontal', 'stacked'];

function parseDirection(action: string, prefix: string): Direction | null {
  if (!action.startsWith(prefix)) return null;
  const dir = action.slice(prefix.length);
  if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west') {
    return dir;
  }
  return null;
}

function parseWorkspaceSwitch(action: string): WorkspaceId | null {
  if (!action.startsWith('workspace.switch.')) return null;
  const raw = action.slice('workspace.switch.'.length);
  const id = Number(raw);
  if (Number.isInteger(id) && id >= 1 && id <= 9) {
    return id as WorkspaceId;
  }
  return null;
}

function cycleLayout(
  layout: ReturnType<typeof useLayout>,
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  direction: 'prev' | 'next'
) {
  const currentIndex = LAYOUT_MODES_ARRAY.indexOf(currentLayoutMode);
  const offset = direction === 'prev' ? -1 : 1;
  const newIndex = (currentIndex + offset + LAYOUT_MODES_ARRAY.length) % LAYOUT_MODES_ARRAY.length;
  layout.setLayoutMode(LAYOUT_MODES_ARRAY[newIndex]!);
}

export function handleNormalModeAction(
  action: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  options: KeyboardHandlerOptions
): boolean {
  const direction = parseDirection(action, 'pane.focus.');
  if (direction) {
    layout.navigate(direction);
    return true;
  }

  const workspaceId = parseWorkspaceSwitch(action);
  if (workspaceId) {
    layout.switchWorkspace(workspaceId);
    return true;
  }

  switch (action) {
    case 'pane.new':
      options.onNewPane ? options.onNewPane() : layout.newPane();
      return true;
    case 'pane.close':
      options.onRequestClosePane ? options.onRequestClosePane() : layout.closePane();
      return true;
    case 'pane.zoom':
      layout.toggleZoom();
      return true;
    case 'layout.cycle.prev':
      cycleLayout(layout, currentLayoutMode, 'prev');
      return true;
    case 'layout.cycle.next':
      cycleLayout(layout, currentLayoutMode, 'next');
      return true;
    case 'layout.mode.vertical':
      layout.setLayoutMode('vertical');
      return true;
    case 'layout.mode.horizontal':
      layout.setLayoutMode('horizontal');
      return true;
    case 'layout.mode.stacked':
      layout.setLayoutMode('stacked');
      return true;
    case 'session.picker.toggle':
      options.onToggleSessionPicker?.();
      return true;
    case 'search.open':
      if (options.onEnterSearch) {
        keyboard.enterSearchMode();
        options.onEnterSearch();
        return true;
      }
      return false;
    case 'aggregate.toggle':
      if (options.onToggleAggregateView) {
        keyboard.enterAggregateMode();
        options.onToggleAggregateView();
        return true;
      }
      return false;
    case 'mode.move':
      keyboard.enterMoveMode();
      return true;
    case 'hints.toggle':
      keyboard.toggleHints();
      return true;
    case 'app.quit':
      options.onRequestQuit ? options.onRequestQuit() : options.onQuit?.();
      return true;
    case 'app.detach':
      options.onDetach?.();
      return true;
    case 'console.toggle':
      options.onToggleConsole?.();
      return true;
    case 'clipboard.paste':
      options.onPaste?.();
      return true;
    default:
      return false;
  }
}

export function handlePrefixModeAction(
  action: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  options: KeyboardHandlerOptions
): boolean {
  const exitPrefix = () => keyboard.exitPrefixMode();

  if (action === 'mode.cancel') {
    exitPrefix();
    return true;
  }

  const direction = parseDirection(action, 'pane.focus.');
  if (direction) {
    layout.navigate(direction);
    exitPrefix();
    return true;
  }

  const workspaceId = parseWorkspaceSwitch(action);
  if (workspaceId) {
    layout.switchWorkspace(workspaceId);
    exitPrefix();
    return true;
  }

  switch (action) {
    case 'pane.new':
      options.onNewPane ? options.onNewPane() : layout.newPane();
      exitPrefix();
      return true;
    case 'pane.close':
      options.onRequestClosePane ? options.onRequestClosePane() : layout.closePane();
      exitPrefix();
      return true;
    case 'pane.zoom':
      layout.toggleZoom();
      exitPrefix();
      return true;
    case 'layout.cycle.prev':
      cycleLayout(layout, currentLayoutMode, 'prev');
      exitPrefix();
      return true;
    case 'layout.cycle.next':
      cycleLayout(layout, currentLayoutMode, 'next');
      exitPrefix();
      return true;
    case 'layout.mode.vertical':
      layout.setLayoutMode('vertical');
      exitPrefix();
      return true;
    case 'layout.mode.horizontal':
      layout.setLayoutMode('horizontal');
      exitPrefix();
      return true;
    case 'layout.mode.stacked':
      layout.setLayoutMode('stacked');
      exitPrefix();
      return true;
    case 'session.picker.toggle':
      options.onToggleSessionPicker?.();
      exitPrefix();
      return true;
    case 'clipboard.paste':
      options.onPaste?.();
      exitPrefix();
      return true;
    case 'search.open':
      if (options.onEnterSearch) {
        keyboard.enterSearchMode();
        options.onEnterSearch();
        return true;
      }
      exitPrefix();
      return true;
    case 'aggregate.toggle':
      if (options.onToggleAggregateView) {
        keyboard.enterAggregateMode();
        options.onToggleAggregateView();
        return true;
      }
      exitPrefix();
      return true;
    case 'mode.move':
      keyboard.enterMoveMode();
      return true;
    case 'console.toggle':
      options.onToggleConsole?.();
      exitPrefix();
      return true;
    case 'hints.toggle':
      keyboard.toggleHints();
      return true;
    case 'app.quit':
      options.onRequestQuit ? options.onRequestQuit() : options.onQuit?.();
      return true;
    case 'app.detach':
      options.onDetach?.();
      exitPrefix();
      return true;
    default:
      return false;
  }
}

export function handleMoveModeAction(
  action: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>
): boolean {
  if (action === 'mode.cancel') {
    keyboard.exitMoveMode();
    return true;
  }

  const direction = parseDirection(action, 'pane.move.');
  if (!direction) {
    return false;
  }

  layout.movePane(direction);
  keyboard.exitMoveMode();
  return true;
}
