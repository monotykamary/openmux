/**
 * StatusBar - bottom status bar like tmux
 */

import { useTheme } from '../contexts/ThemeContext';
import { useLayout } from '../contexts/LayoutContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { getPaneIndex } from '../core/bsp-tree';
import type { KeyMode } from '../core/types';

interface StatusBarProps {
  width: number;
}

export function StatusBar({ width }: StatusBarProps) {
  const theme = useTheme();
  const { state, paneCount } = useLayout();
  const { state: kbState } = useKeyboardState();

  const focusedIndex = state.focusedPaneId
    ? getPaneIndex(state.root, state.focusedPaneId) + 1
    : 0;

  return (
    <box
      style={{
        height: 1,
        width: width,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
      backgroundColor={theme.statusBar.backgroundColor}
    >
      {/* Left section: Mode indicator */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <ModeIndicator mode={kbState.mode} />
        <text fg={theme.statusBar.foregroundColor}>
          [openmux]
        </text>
      </box>

      {/* Center section: Pane tabs */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <PaneTabs
          paneCount={paneCount}
          focusedIndex={focusedIndex}
        />
      </box>

      {/* Right section: Time and hints */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        {kbState.mode === 'normal' && (
          <text fg="#666666">
            Ctrl+b ?
          </text>
        )}
        <text fg={theme.statusBar.foregroundColor}>
          {new Date().toLocaleTimeString()}
        </text>
      </box>
    </box>
  );
}

interface ModeIndicatorProps {
  mode: KeyMode;
}

function ModeIndicator({ mode }: ModeIndicatorProps) {
  if (mode === 'normal') return null;

  const modeColors: Record<KeyMode, string> = {
    normal: '#888888',
    prefix: '#FFD700',
    resize: '#00FF00',
  };

  const modeLabels: Record<KeyMode, string> = {
    normal: '',
    prefix: '[PREFIX]',
    resize: '[RESIZE]',
  };

  return (
    <text
      fg="#000000"
      bg={modeColors[mode]}
    >
      {modeLabels[mode]}
    </text>
  );
}

interface PaneTabsProps {
  paneCount: number;
  focusedIndex: number;
}

function PaneTabs({ paneCount, focusedIndex }: PaneTabsProps) {
  const theme = useTheme();

  if (paneCount === 0) {
    return <text fg="#666666">No panes</text>;
  }

  return (
    <>
      {Array.from({ length: paneCount }, (_, i) => {
        const idx = i + 1;
        const isFocused = idx === focusedIndex;

        return (
          <text
            key={i}
            fg={isFocused
              ? theme.statusBar.activeTabColor
              : theme.statusBar.inactiveTabColor}
          >
            {isFocused ? `[${idx}]` : ` ${idx} `}
          </text>
        );
      })}
    </>
  );
}
