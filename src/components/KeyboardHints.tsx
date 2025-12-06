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
  { key: 'Ctrl+b', description: 'Enter prefix mode' },
];

const PREFIX_MODE_HINTS: KeyHint[] = [
  { key: 'h/j/k/l', description: 'Navigate panes' },
  { key: '|', description: 'Split vertical' },
  { key: '-', description: 'Split horizontal' },
  { key: 'x', description: 'Close pane' },
  { key: 'r', description: 'Enter resize mode' },
  { key: '?', description: 'Toggle hints' },
  { key: 'Esc', description: 'Exit prefix mode' },
];

const RESIZE_MODE_HINTS: KeyHint[] = [
  { key: 'h/l', description: 'Resize width' },
  { key: 'j/k', description: 'Resize height' },
  { key: 'Enter/Esc', description: 'Exit resize mode' },
];

interface KeyboardHintsProps {
  width: number;
  height: number;
}

export function KeyboardHints({ width, height }: KeyboardHintsProps) {
  const { state } = useKeyboardState();

  if (!state.showHints) return null;

  const hints =
    state.mode === 'normal'
      ? NORMAL_MODE_HINTS
      : state.mode === 'prefix'
      ? PREFIX_MODE_HINTS
      : RESIZE_MODE_HINTS;

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
