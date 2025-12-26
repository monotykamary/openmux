/**
 * KeyboardHints - overlay showing available keyboard shortcuts
 */

import { Show, For } from 'solid-js';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useConfig } from '../contexts/ConfigContext';
import { formatComboSet, formatKeyCombo, type ResolvedKeybindingMap } from '../core/keybindings';

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
      { key: formatComboSet(navigationCombos), description: 'navigate panes' },
      { key: formatComboSet(getCombos(bindings, 'mode.move')), description: 'move pane' },
      { key: formatComboSet(getCombos(bindings, 'pane.new')), description: 'new pane' },
      { key: formatComboSet(workspaceCombos), description: 'switch workspace' },
      { key: formatComboSet(getCombos(bindings, 'session.picker.toggle')), description: 'session picker' },
      { key: formatComboSet(getCombos(bindings, 'aggregate.toggle')), description: 'aggregate view' },
      { key: formatComboSet(getCombos(bindings, 'search.open')), description: 'search in scrollback' },
      { key: formatComboSet(getCombos(bindings, 'command.palette.toggle')), description: 'command palette' },
      { key: formatComboSet(cycleCombos), description: 'cycle layout mode' },
      { key: formatComboSet(getCombos(bindings, 'pane.zoom')), description: 'toggle zoom' },
      { key: formatComboSet(getCombos(bindings, 'pane.close')), description: 'close pane' },
      { key: '^v/\u2318v', description: 'paste' },
      { key: 'click', description: 'focus pane' },
      { key: formatKeyCombo(config.keybindings().prefixKey), description: 'enter prefix mode' },
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
      { key: formatComboSet(getCombos(bindings, 'pane.new')), description: 'new pane' },
      { key: formatComboSet(navigationCombos), description: 'navigate panes' },
      { key: formatComboSet(getCombos(bindings, 'mode.move')), description: 'move pane' },
      { key: formatComboSet(workspaceCombos), description: 'switch workspace' },
      { key: formatComboSet(getCombos(bindings, 'session.picker.toggle')), description: 'session picker' },
      { key: formatComboSet(getCombos(bindings, 'aggregate.toggle')), description: 'aggregate view' },
      { key: formatComboSet(getCombos(bindings, 'search.open')), description: 'search in scrollback' },
      { key: formatComboSet(getCombos(bindings, 'command.palette.toggle')), description: 'command palette' },
      { key: formatComboSet(layoutModeCombos), description: 'layout: vert/horiz/stack' },
      { key: formatComboSet(getCombos(bindings, 'pane.zoom')), description: 'toggle zoom' },
      { key: formatComboSet(getCombos(bindings, 'pane.close')), description: 'close pane' },
      { key: formatComboSet(getCombos(bindings, 'clipboard.paste')), description: 'paste' },
      { key: formatComboSet(getCombos(bindings, 'console.toggle')), description: 'toggle debug console' },
      { key: formatComboSet(getCombos(bindings, 'app.quit')), description: 'quit openmux' },
      { key: formatComboSet(getCombos(bindings, 'app.detach')), description: 'detach' },
      { key: formatComboSet(getCombos(bindings, 'hints.toggle')), description: 'toggle hints' },
      { key: formatComboSet(getCombos(bindings, 'mode.cancel')), description: 'exit prefix mode' },
    ];
  };

  const moveHints = () => {
    const bindings = config.keybindings().move;
    const verticalCombos = [
      ...getCombos(bindings, 'pane.move.south'),
      ...getCombos(bindings, 'pane.move.north'),
    ];
    return [
      { key: formatComboSet(getCombos(bindings, 'pane.move.west')), description: 'move to master' },
      { key: formatComboSet(getCombos(bindings, 'pane.move.east')), description: 'move to stack' },
      { key: formatComboSet(verticalCombos), description: 'move down/up' },
      { key: formatComboSet(getCombos(bindings, 'mode.cancel')), description: 'cancel' },
    ];
  };

  const searchHints = () => {
    const bindings = config.keybindings().search;
    return [
      { key: 'type', description: 'enter search query' },
      { key: formatComboSet(getCombos(bindings, 'search.next')), description: 'next match' },
      { key: formatComboSet(getCombos(bindings, 'search.prev')), description: 'previous match' },
      { key: formatComboSet(getCombos(bindings, 'search.confirm')), description: 'confirm and exit' },
      { key: formatComboSet(getCombos(bindings, 'search.cancel')), description: 'cancel and restore' },
      { key: formatComboSet(getCombos(bindings, 'search.delete')), description: 'delete character' },
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
