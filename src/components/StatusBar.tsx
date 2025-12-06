/**
 * StatusBar - bottom status bar showing workspaces and mode
 */

import { useTheme } from '../contexts/ThemeContext';
import { useLayout } from '../contexts/LayoutContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import type { KeyMode, WorkspaceId, LayoutMode } from '../core/types';

interface StatusBarProps {
  width: number;
}

export function StatusBar({ width }: StatusBarProps) {
  const theme = useTheme();
  const { state, activeWorkspace, populatedWorkspaces, paneCount } = useLayout();
  const { state: kbState } = useKeyboardState();

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
      {/* Left section: Mode indicator and app name */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <ModeIndicator mode={kbState.mode} />
        <text fg={theme.statusBar.foregroundColor}>
          [openmux]
        </text>
        <LayoutModeIndicator mode={activeWorkspace.layoutMode} />
      </box>

      {/* Center section: Workspace tabs */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <WorkspaceTabs
          populatedWorkspaces={populatedWorkspaces}
          activeWorkspaceId={state.activeWorkspaceId}
          paneCount={paneCount}
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

interface LayoutModeIndicatorProps {
  mode: LayoutMode;
}

function LayoutModeIndicator({ mode }: LayoutModeIndicatorProps) {
  const modeSymbols: Record<LayoutMode, string> = {
    vertical: '│',
    horizontal: '─',
    stacked: '▣',
  };

  return (
    <text fg="#666666">
      {modeSymbols[mode]}
    </text>
  );
}

interface WorkspaceTabsProps {
  populatedWorkspaces: WorkspaceId[];
  activeWorkspaceId: WorkspaceId;
  paneCount: number;
}

function WorkspaceTabs({ populatedWorkspaces, activeWorkspaceId, paneCount }: WorkspaceTabsProps) {
  const theme = useTheme();

  if (populatedWorkspaces.length === 0) {
    return <text fg="#666666">No workspaces</text>;
  }

  return (
    <>
      {populatedWorkspaces.map((id) => {
        const isActive = id === activeWorkspaceId;

        return (
          <text
            key={id}
            fg={isActive
              ? theme.statusBar.activeTabColor
              : theme.statusBar.inactiveTabColor}
          >
            {isActive ? `[${id}:${paneCount}]` : ` ${id} `}
          </text>
        );
      })}
    </>
  );
}
