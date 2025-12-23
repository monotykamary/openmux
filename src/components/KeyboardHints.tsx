/**
 * KeyboardHints - overlay showing available keyboard shortcuts
 */

import { Show, For } from 'solid-js';
import { useKeyboardState } from '../contexts/KeyboardContext';
import type { KeyMode } from '../core/types';

interface KeyHint {
  key: string;
  description: string;
}

const NORMAL_MODE_HINTS: KeyHint[] = [
  { key: 'Alt+hjkl', description: 'Navigate panes' },
  { key: 'Alt+m', description: 'Move pane' },
  { key: 'Alt+n', description: 'New pane' },
  { key: 'Alt+1-9', description: 'Switch workspace' },
  { key: 'Alt+s', description: 'Session picker' },
  { key: 'Alt+g', description: 'Aggregate view' },
  { key: 'Alt+f', description: 'Search in scrollback' },
  { key: 'Alt+[/]', description: 'Cycle layout mode' },
  { key: 'Alt+z', description: 'Toggle zoom' },
  { key: 'Alt+x', description: 'Close pane' },
  { key: 'Ctrl/Cmd+V', description: 'Paste' },
  { key: 'Click', description: 'Focus pane' },
  { key: 'Ctrl+b', description: 'Enter prefix mode' },
];

const PREFIX_MODE_HINTS: KeyHint[] = [
  { key: 'n/Enter', description: 'New pane' },
  { key: 'h/j/k/l', description: 'Navigate panes' },
  { key: 'm', description: 'Move pane' },
  { key: '1-9', description: 'Switch workspace' },
  { key: 's', description: 'Session picker' },
  { key: 'g', description: 'Aggregate view' },
  { key: '/', description: 'Search in scrollback' },
  { key: 'v/H/t', description: 'Layout: vert/horiz/stack' },
  { key: 'z', description: 'Toggle zoom' },
  { key: 'x', description: 'Close pane' },
  { key: '] or p', description: 'Paste' },
  { key: '`', description: 'Toggle debug console' },
  { key: 'q', description: 'Quit openmux' },
  { key: 'd', description: 'Detach' },
  { key: '?', description: 'Toggle hints' },
  { key: 'Esc', description: 'Exit prefix mode' },
];

const MOVE_MODE_HINTS: KeyHint[] = [
  { key: 'h', description: 'Move to master' },
  { key: 'l', description: 'Move to stack' },
  { key: 'j/k', description: 'Move down/up' },
  { key: 'Esc', description: 'Cancel' },
];

const SEARCH_MODE_HINTS: KeyHint[] = [
  { key: 'Type', description: 'Enter search query' },
  { key: 'Ctrl+n', description: 'Next match' },
  { key: 'Ctrl+p', description: 'Previous match' },
  { key: 'Enter', description: 'Confirm and exit' },
  { key: 'Esc', description: 'Cancel and restore' },
  { key: 'Backspace', description: 'Delete character' },
];

interface KeyboardHintsProps {
  width: number;
  height: number;
}

export function KeyboardHints(props: KeyboardHintsProps) {
  const { state } = useKeyboardState();

  const hints = () => {
    const mode = state.mode;
    return mode === 'normal'
      ? NORMAL_MODE_HINTS
      : mode === 'search'
        ? SEARCH_MODE_HINTS
        : mode === 'move'
          ? MOVE_MODE_HINTS
        : PREFIX_MODE_HINTS;
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
