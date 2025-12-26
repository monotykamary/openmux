/**
 * StatusBar - bottom status bar showing sessions, workspaces and mode
 */

import { Show, createMemo } from 'solid-js';
import { useTheme } from '../contexts/ThemeContext';
import { useLayout } from '../contexts/LayoutContext';
import { useKeyboardState } from '../contexts/KeyboardContext';
import { useSession, useSessionState } from '../contexts/SessionContext';
import type { KeyMode, WorkspaceId, LayoutMode } from '../core/types';

interface StatusBarProps {
  width: number;
  showCommandPalette?: boolean;
}

export function StatusBar(props: StatusBarProps) {
  const theme = useTheme();
  const layout = useLayout();
  const { state: kbState } = useKeyboardState();
  const session = useSession();
  const sessionState = useSessionState();
  const commandColor = () => theme.searchAccentColor;
  const sessionColor = () => theme.pane.focusedBorderColor;

  // Truncate session name if too long
  const displaySessionName = () => {
    const sessionName = sessionState.activeSession?.name ?? 'default';
    const maxSessionNameLen = 15;
    return sessionName.length > maxSessionNameLen
      ? sessionName.slice(0, maxSessionNameLen - 1) + '…'
      : sessionName;
  };

  return (
    <box
      style={{
        height: 1,
        width: props.width,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      {/* Left section: app name, session name and workspace tabs */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg="#00AAFF">[{displaySessionName()}]</text>
        <WorkspaceTabs
          populatedWorkspaces={layout.populatedWorkspaces}
          activeWorkspaceId={layout.state.activeWorkspaceId}
        />
      </box>

      {/* Right section: Mode and layout mode */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <ModeIndicator mode={kbState.mode} />
        <Show when={props.showCommandPalette}>
          <text fg={commandColor()}>[COMMAND]</text>
        </Show>
        <Show when={sessionState.showSessionPicker}>
          <text fg={sessionColor()}>[SESSIONS]</text>
        </Show>
        <Show when={session.showTemplateOverlay}>
          <text fg={sessionColor()}>[TEMPLATES]</text>
        </Show>
        <Show when={layout.activeWorkspace.zoomed}>
          <text fg="#666666">[ZOOMED]</text>
        </Show>
        <LayoutModeIndicator mode={layout.activeWorkspace.layoutMode} />
      </box>
    </box>
  );
}

interface ModeIndicatorProps {
  mode: KeyMode;
}

function ModeIndicator(props: ModeIndicatorProps) {
  const theme = useTheme();
  const modeLabels: Record<KeyMode, string> = {
    normal: '',
    prefix: '[PREFIX]',
    search: '[SEARCH]',
    aggregate: '[GLOBAL]',
    confirm: '[CONFIRM]',
    move: '[MOVE]',
  };
  const modeColor = () => {
    switch (props.mode) {
      case 'search':
        return theme.searchAccentColor;
      case 'confirm':
        return theme.pane.urgentBorderColor;
      default:
        return '#666666';
    }
  };

  return (
    <Show when={props.mode !== 'normal'}>
      <text fg={modeColor()}>
        {modeLabels[props.mode]}
      </text>
    </Show>
  );
}

interface LayoutModeIndicatorProps {
  mode: LayoutMode;
}

function LayoutModeIndicator(props: LayoutModeIndicatorProps) {
  const modeLabels: Record<LayoutMode, string> = {
    vertical: '[VERTICAL]',
    horizontal: '[HORIZONTAL]',
    stacked: '[STACKED]',
  };

  return (
    <text fg="#666666">
      {modeLabels[props.mode]}
    </text>
  );
}

interface WorkspaceTabsProps {
  populatedWorkspaces: WorkspaceId[];
  activeWorkspaceId: WorkspaceId;
}

function WorkspaceTabs(props: WorkspaceTabsProps) {
  const theme = useTheme();

  // Memoize tabs string to avoid recomputation on unrelated re-renders
  const tabs = createMemo(() => {
    if (props.populatedWorkspaces.length === 0) return null;
    return props.populatedWorkspaces.map((id) => {
      const isActive = id === props.activeWorkspaceId;
      return isActive ? `[${id}]` : ` ${id} `;
    }).join('');
  });

  return (
    <Show when={tabs()} fallback={<text fg="#666666">No workspaces</text>}>
      <text fg={theme.statusBar.activeTabColor}>
        {tabs()}
      </text>
    </Show>
  );
}
