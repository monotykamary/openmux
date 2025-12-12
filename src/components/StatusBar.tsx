/**
 * StatusBar - bottom status bar showing sessions, workspaces and mode
 */

import { useTheme } from '../contexts/ThemeContext';
import { useLayout } from '../contexts/LayoutContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useSessionState } from '../contexts/SessionContext';
import type { KeyMode, WorkspaceId, LayoutMode } from '../core/types';

interface StatusBarProps {
  width: number;
}

export function StatusBar({ width }: StatusBarProps) {
  const theme = useTheme();
  const { state, activeWorkspace, populatedWorkspaces } = useLayout();
  const { state: kbState } = useKeyboardState();
  const sessionState = useSessionState();

  // Truncate session name if too long
  const sessionName = sessionState.activeSession?.name ?? 'default';
  const maxSessionNameLen = 15;
  const displaySessionName = sessionName.length > maxSessionNameLen
    ? sessionName.slice(0, maxSessionNameLen - 1) + '…'
    : sessionName;

  return (
    <box
      style={{
        height: 1,
        width: width,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      {/* Left section: app name, session name and workspace tabs */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg="#00AAFF">[{displaySessionName}]</text>
        <WorkspaceTabs
          populatedWorkspaces={populatedWorkspaces}
          activeWorkspaceId={state.activeWorkspaceId}
        />
      </box>

      {/* Right section: Mode and layout mode */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <ModeIndicator mode={kbState.mode} />
        {sessionState.showSessionPicker && <text fg="#00AAFF">[SESSIONS]</text>}
        {activeWorkspace.zoomed && <text fg="#666666">[ZOOMED]</text>}
        <LayoutModeIndicator mode={activeWorkspace.layoutMode} />
      </box>
    </box>
  );
}

interface ModeIndicatorProps {
  mode: KeyMode;
}

function ModeIndicator({ mode }: ModeIndicatorProps) {
  if (mode === 'normal') return null;

  const modeLabels: Record<KeyMode, string> = {
    normal: '',
    prefix: '[PREFIX]',
    search: '[SEARCH]',
  };

  return (
    <text fg="#666666">
      {modeLabels[mode]}
    </text>
  );
}

interface LayoutModeIndicatorProps {
  mode: LayoutMode;
}

function LayoutModeIndicator({ mode }: LayoutModeIndicatorProps) {
  const modeLabels: Record<LayoutMode, string> = {
    vertical: '[VERTICAL]',
    horizontal: '[HORIZONTAL]',
    stacked: '[STACKED]',
  };

  return (
    <text fg="#666666">
      {modeLabels[mode]}
    </text>
  );
}

interface WorkspaceTabsProps {
  populatedWorkspaces: WorkspaceId[];
  activeWorkspaceId: WorkspaceId;
}

function WorkspaceTabs({ populatedWorkspaces, activeWorkspaceId }: WorkspaceTabsProps) {
  const theme = useTheme();

  if (populatedWorkspaces.length === 0) {
    return <text fg="#666666">No workspaces</text>;
  }

  const tabs = populatedWorkspaces.map((id) => {
    const isActive = id === activeWorkspaceId;
    return isActive ? `[${id}]` : ` ${id} `;
  }).join('');

  return (
    <text fg={theme.statusBar.activeTabColor}>
      {tabs}
    </text>
  );
}
