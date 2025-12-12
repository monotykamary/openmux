/**
 * KeyboardHints - overlay showing available keyboard shortcuts
 */

import { useKeyboardState } from '../contexts/KeyboardContext';
import type { KeyMode } from '../core/types';

interface KeyHint {
  key: string;
  description: string;
}

const NORMAL_MODE_HINTS: KeyHint[] = [
  { key: 'Alt+hjkl', description: 'Navigate panes' },
  { key: 'Alt+n', description: 'New pane' },
  { key: 'Alt+1-9', description: 'Switch workspace' },
  { key: 'Alt+s', description: 'Session picker' },
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
  { key: '1-9', description: 'Switch workspace' },
  { key: 's', description: 'Session picker' },
  { key: '/', description: 'Search in scrollback' },
  { key: 'v/H/t', description: 'Layout: vert/horiz/stack' },
  { key: 'z', description: 'Toggle zoom' },
  { key: 'x', description: 'Close pane' },
  { key: '] or p', description: 'Paste' },
  { key: 'q', description: 'Quit openmux' },
  { key: '?', description: 'Toggle hints' },
  { key: 'Esc', description: 'Exit prefix mode' },
];

interface KeyboardHintsProps {
  width: number;
  height: number;
}

export function KeyboardHints({ width, height }: KeyboardHintsProps) {
  const { state } = useKeyboardState();

  if (!state.showHints) return null;

  const hints = state.mode === 'normal' ? NORMAL_MODE_HINTS : PREFIX_MODE_HINTS;

  // Center the hints overlay
  const overlayWidth = 40;
  const overlayHeight = hints.length + 4;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = Math.floor((height - overlayHeight) / 2);

  return (
    <box
      style={{
        position: 'absolute',
        left: overlayX,
        top: overlayY,
        width: overlayWidth,
        height: overlayHeight,
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
        {hints.map((hint, i) => (
          <box key={i} style={{ flexDirection: 'row' }}>
            <text fg="#FFD700" style={{ width: 12 }}>
              {hint.key}
            </text>
            <text fg="#CCCCCC">
              {hint.description}
            </text>
          </box>
        ))}
      </box>
    </box>
  );
}
