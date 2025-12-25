/**
 * KeyboardHints - overlay showing available keyboard shortcuts
 */

import { Show, For } from 'solid-js';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useConfig } from '../contexts/ConfigContext';
import { formatComboSet, formatKeyCombo, type ResolvedKeybindingMap } from '../core/keybindings';

interface KeyHint {
  key: string;
  description: string;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

interface KeyboardHintsProps {
  width: number;
  height: number;
}

export function KeyboardHints(props: KeyboardHintsProps) {
  const { state } = useKeyboardState();
  const config = useConfig();

  const normalHints = () => {
    const bindings = config.keybindings().normal;
    const navigationCombos = [
      ...getCombos(bindings, 'pane.focus.west'),
      ...getCombos(bindings, 'pane.focus.south'),
      ...getCombos(bindings, 'pane.focus.north'),
      ...getCombos(bindings, 'pane.focus.east'),
    ];
    const workspaceCombos = Array.from({ length: 9 }, (_, i) =>
      getCombos(bindings, `workspace.switch.${i + 1}`)
    ).flat();
    const cycleCombos = [
      ...getCombos(bindings, 'layout.cycle.prev'),
      ...getCombos(bindings, 'layout.cycle.next'),
    ];

    return [
      { key: formatComboSet(navigationCombos), description: 'Navigate panes' },
      { key: formatComboSet(getCombos(bindings, 'mode.move')), description: 'Move pane' },
      { key: formatComboSet(getCombos(bindings, 'pane.new')), description: 'New pane' },
      { key: formatComboSet(workspaceCombos), description: 'Switch workspace' },
      { key: formatComboSet(getCombos(bindings, 'session.picker.toggle')), description: 'Session picker' },
      { key: formatComboSet(getCombos(bindings, 'aggregate.toggle')), description: 'Aggregate view' },
      { key: formatComboSet(getCombos(bindings, 'search.open')), description: 'Search in scrollback' },
      { key: formatComboSet(getCombos(bindings, 'command.palette.toggle')), description: 'Command palette' },
      { key: formatComboSet(cycleCombos), description: 'Cycle layout mode' },
      { key: formatComboSet(getCombos(bindings, 'pane.zoom')), description: 'Toggle zoom' },
      { key: formatComboSet(getCombos(bindings, 'pane.close')), description: 'Close pane' },
      { key: 'Ctrl/Cmd+V', description: 'Paste' },
      { key: 'Click', description: 'Focus pane' },
      { key: formatKeyCombo(config.keybindings().prefixKey), description: 'Enter prefix mode' },
    ];
  };

  const prefixHints = () => {
    const bindings = config.keybindings().prefix;
    const navigationCombos = [
      ...getCombos(bindings, 'pane.focus.west'),
      ...getCombos(bindings, 'pane.focus.south'),
      ...getCombos(bindings, 'pane.focus.north'),
      ...getCombos(bindings, 'pane.focus.east'),
    ];
    const workspaceCombos = Array.from({ length: 9 }, (_, i) =>
      getCombos(bindings, `workspace.switch.${i + 1}`)
    ).flat();
    const layoutModeCombos = [
      ...getCombos(bindings, 'layout.mode.vertical'),
      ...getCombos(bindings, 'layout.mode.horizontal'),
      ...getCombos(bindings, 'layout.mode.stacked'),
    ];

    return [
      { key: formatComboSet(getCombos(bindings, 'pane.new')), description: 'New pane' },
      { key: formatComboSet(navigationCombos), description: 'Navigate panes' },
      { key: formatComboSet(getCombos(bindings, 'mode.move')), description: 'Move pane' },
      { key: formatComboSet(workspaceCombos), description: 'Switch workspace' },
      { key: formatComboSet(getCombos(bindings, 'session.picker.toggle')), description: 'Session picker' },
      { key: formatComboSet(getCombos(bindings, 'aggregate.toggle')), description: 'Aggregate view' },
      { key: formatComboSet(getCombos(bindings, 'search.open')), description: 'Search in scrollback' },
      { key: formatComboSet(getCombos(bindings, 'command.palette.toggle')), description: 'Command palette' },
      { key: formatComboSet(layoutModeCombos), description: 'Layout: vert/horiz/stack' },
      { key: formatComboSet(getCombos(bindings, 'pane.zoom')), description: 'Toggle zoom' },
      { key: formatComboSet(getCombos(bindings, 'pane.close')), description: 'Close pane' },
      { key: formatComboSet(getCombos(bindings, 'clipboard.paste')), description: 'Paste' },
      { key: formatComboSet(getCombos(bindings, 'console.toggle')), description: 'Toggle debug console' },
      { key: formatComboSet(getCombos(bindings, 'app.quit')), description: 'Quit openmux' },
      { key: formatComboSet(getCombos(bindings, 'app.detach')), description: 'Detach' },
      { key: formatComboSet(getCombos(bindings, 'hints.toggle')), description: 'Toggle hints' },
      { key: formatComboSet(getCombos(bindings, 'mode.cancel')), description: 'Exit prefix mode' },
    ];
  };

  const moveHints = () => {
    const bindings = config.keybindings().move;
    const verticalCombos = [
      ...getCombos(bindings, 'pane.move.south'),
      ...getCombos(bindings, 'pane.move.north'),
    ];
    return [
      { key: formatComboSet(getCombos(bindings, 'pane.move.west')), description: 'Move to master' },
      { key: formatComboSet(getCombos(bindings, 'pane.move.east')), description: 'Move to stack' },
      { key: formatComboSet(verticalCombos), description: 'Move down/up' },
      { key: formatComboSet(getCombos(bindings, 'mode.cancel')), description: 'Cancel' },
    ];
  };

  const searchHints = () => {
    const bindings = config.keybindings().search;
    return [
      { key: 'Type', description: 'Enter search query' },
      { key: formatComboSet(getCombos(bindings, 'search.next')), description: 'Next match' },
      { key: formatComboSet(getCombos(bindings, 'search.prev')), description: 'Previous match' },
      { key: formatComboSet(getCombos(bindings, 'search.confirm')), description: 'Confirm and exit' },
      { key: formatComboSet(getCombos(bindings, 'search.cancel')), description: 'Cancel and restore' },
      { key: formatComboSet(getCombos(bindings, 'search.delete')), description: 'Delete character' },
    ];
  };

  const hints = () => {
    const mode = state.mode;
    return mode === 'normal'
      ? normalHints()
      : mode === 'search'
        ? searchHints()
        : mode === 'move'
          ? moveHints()
        : prefixHints();
  };

  // Center the hints overlay
  const overlayWidth = 40;
  const overlayHeight = () => hints().length + 4;
  const overlayX = () => Math.floor((props.width - overlayWidth) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight()) / 2);

  return (
    <Show when={state.showHints}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth,
          height: overlayHeight(),
          border: true,
          borderStyle: 'rounded',
          borderColor: '#FFD700',
          padding: 1,
        }}
        backgroundColor="#1a1a1a"
        title={` ${state.mode.toUpperCase()} Mode `}
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          <For each={hints()}>
            {(hint) => (
              <box style={{ flexDirection: 'row' }}>
                <text fg="#FFD700" style={{ width: 12 }}>
                  {hint.key}
                </text>
                <text fg="#CCCCCC">
                  {hint.description}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </Show>
  );
}
