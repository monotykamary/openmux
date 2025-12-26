/**
 * SessionPicker - modal overlay for session selection and management
 */

import { Show, For } from 'solid-js';
import { useSession, type SessionSummary } from '../contexts/SessionContext';
import type { SessionMetadata } from '../core/types';
import { useTheme } from '../contexts/ThemeContext';
import { useConfig } from '../contexts/ConfigContext';
import { formatComboSet, matchKeybinding, type ResolvedKeybindingMap } from '../core/keybindings';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import type { KeyboardEvent } from '../effect/bridge';

interface SessionPickerProps {
  width: number;
  height: number;
}

/**
 * Format relative time (e.g., "2m ago", "1h ago", "yesterday")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function SessionPicker(props: SessionPickerProps) {
  const theme = useTheme();
  const config = useConfig();
  const accentColor = () => theme.pane.focusedBorderColor;
  // Keep session context to access filteredSessions reactively (it's a getter)
  const session = useSession();
  const {
    state,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
  } = session;

  // Handle keyboard input when picker is open
  const handleKeyDown = (event: KeyboardEvent) => {
    const { key } = event;
    const bindings = config.keybindings().sessionPicker;
    const action = matchKeybinding(state.isRenaming ? bindings.rename : bindings.list, {
      key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    // If renaming, handle rename-specific keys
    if (state.isRenaming) {
      if (action === 'session.picker.rename.cancel') {
        cancelRename();
        return true;
      }
      if (action === 'session.picker.rename.confirm') {
        if (state.renamingSessionId && state.renameValue.trim()) {
          renameSession(state.renamingSessionId, state.renameValue.trim());
        }
        return true;
      }
      if (action === 'session.picker.rename.delete') {
        updateRenameValue(state.renameValue.slice(0, -1));
        return true;
      }
      // Single printable character
      if (key.length === 1 && !event.ctrl && !event.alt && !action) {
        updateRenameValue(state.renameValue + key);
        return true;
      }
      return true; // Consume all keys while renaming
    }

    switch (action) {
      case 'session.picker.close':
        closePicker();
        // Save session when closing picker
        saveSession();
        return true;

      case 'session.picker.down':
        navigateDown();
        return true;

      case 'session.picker.up':
        navigateUp();
        return true;

      case 'session.picker.select': {
        const selected = session.filteredSessions[state.selectedIndex];
        if (selected) {
          // If selecting the already-active session, just close the picker
          if (selected.id === state.activeSessionId) {
            closePicker();
          } else {
            switchSession(selected.id);
          }
        }
        return true;
      }

      case 'session.picker.filter.delete':
        // Remove last character from search
        setSearchQuery(state.searchQuery.slice(0, -1));
        return true;

      case 'session.picker.create':
        createSession();
        return true;

      case 'session.picker.rename': {
        const selected = session.filteredSessions[state.selectedIndex];
        if (selected) {
          startRename(selected.id, selected.name);
        }
        return true;
      }

      case 'session.picker.delete': {
        const selected = session.filteredSessions[state.selectedIndex];
        if (selected && session.filteredSessions.length > 1) {
          deleteSession(selected.id);
        }
        return true;
      }

      default:
        break;
    }

    // Single printable character - add to search
    if (key.length === 1 && !event.ctrl && !event.alt) {
      setSearchQuery(state.searchQuery + key);
      return true;
    }
    return false;
  };

  const buildHintText = () => {
    if (state.isRenaming) {
      const bindings = config.keybindings().sessionPicker.rename;
      const confirm = formatComboSet(getCombos(bindings, 'session.picker.rename.confirm'));
      const cancel = formatComboSet(getCombos(bindings, 'session.picker.rename.cancel'));
      const remove = formatComboSet(getCombos(bindings, 'session.picker.rename.delete'));
      return `type:rename ${confirm}:confirm ${cancel}:cancel ${remove}:delete`;
    }

    const bindings = config.keybindings().sessionPicker.list;
    const nav = formatComboSet([
      ...getCombos(bindings, 'session.picker.up'),
      ...getCombos(bindings, 'session.picker.down'),
    ]);
    const select = formatComboSet(getCombos(bindings, 'session.picker.select'));
    const create = formatComboSet(getCombos(bindings, 'session.picker.create'));
    const rename = formatComboSet(getCombos(bindings, 'session.picker.rename'));
    const remove = formatComboSet(getCombos(bindings, 'session.picker.delete'));
    const close = formatComboSet(getCombos(bindings, 'session.picker.close'));
    return `${nav}:nav ${select}:select ${create}:new ${rename}:rename ${remove}:del ${close}:close`;
  };

  useOverlayKeyboardHandler({
    overlay: 'sessionPicker',
    isActive: () => state.showSessionPicker,
    handler: handleKeyDown,
  });

  // Calculate overlay dimensions
  const overlayWidth = () => Math.min(60, props.width - 4);
  // Height: search(1) + separator(1) + sessions/empty(max 1) + separator(1) + footer(1) + gap(1) + border(2) + padding(2) = 10 minimum
  const sessionRowCount = () => Math.max(1, session.filteredSessions.length); // At least 1 for "No sessions found"
  const overlayHeight = () => Math.min(sessionRowCount() + 8, props.height - 4);
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight()) / 2);

  return (
    <Show when={state.showSessionPicker}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth(),
          height: overlayHeight(),
          border: true,
          borderStyle: 'rounded',
          borderColor: accentColor(),
          padding: 1,
          zIndex: 100,
        }}
        backgroundColor="#1a1a1a"
        title=" Sessions "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          {/* Search bar */}
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg="#888888">{state.isRenaming ? 'Rename: ' : 'Search: '}</text>
            <text fg="#FFFFFF">
              {(state.isRenaming ? state.renameValue : state.searchQuery) + '_'}
            </text>
          </box>

          {/* Separator */}
          <box style={{ height: 1 }}>
            <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
          </box>

          {/* Session list */}
          <Show
            when={session.filteredSessions.length > 0}
            fallback={
              <box style={{ height: 1 }}>
                <text fg="#666666">  No sessions found</text>
              </box>
            }
          >
            <For each={session.filteredSessions}>
              {(sess, index) => (
                <box style={{ height: 1 }}>
                  <SessionRow
                    session={sess}
                    isSelected={index() === state.selectedIndex}
                    isActive={sess.id === state.activeSessionId}
                    isRenaming={state.isRenaming && sess.id === state.renamingSessionId}
                    renameValue={state.renameValue}
                    summary={state.summaries.get(sess.id)}
                    maxWidth={overlayWidth() - 4}
                  />
                </box>
              )}
            </For>
          </Show>

          {/* Footer with hints */}
          <box style={{ height: 1 }}>
            <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
          </box>
          <box style={{ height: 1 }}>
            <text fg="#666666">{buildHintText()}</text>
          </box>
          <box style={{ height: 1 }}>
            <text>{' '.repeat(overlayWidth() - 4)}</text>
          </box>
        </box>
      </box>
    </Show>
  );
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

interface SessionRowProps {
  session: SessionMetadata;
  isSelected: boolean;
  isActive: boolean;
  isRenaming: boolean;
  renameValue: string;
  summary?: SessionSummary;
  maxWidth: number;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) {
    return text.slice(0, width);
  }
  return text.padEnd(width);
}

function SessionRow(props: SessionRowProps) {
  // Build the row content
  const activeMarker = () => props.isActive ? '*' : ' ';

  // Name (possibly being renamed)
  const displayName = () => props.isRenaming ? props.renameValue : props.session.name;
  const nameWidth = () => Math.min(20, props.maxWidth - 30);
  const truncatedName = () => {
    const name = displayName();
    const width = nameWidth();
    return name.length > width
      ? name.slice(0, width - 1) + '…'
      : name.padEnd(width);
  };

  // Summary info
  const workspaceInfo = () => props.summary ? `${props.summary.workspaceCount}ws` : '   ';
  const paneInfo = () => props.summary ? `${props.summary.paneCount}p` : '  ';

  // Time
  const timeStr = () => formatRelativeTime(props.session.lastSwitchedAt);

  // Colors - use brighter color for selection
  const nameColor = () => props.isSelected ? '#FFFFFF' : (props.isActive ? '#00AAFF' : '#CCCCCC');
  const bgColor = () => props.isSelected ? '#334455' : undefined;

  // Build the line as a single string with proper formatting
  const line = () => fitLine(` ${activeMarker()} ${truncatedName()} ${workspaceInfo()} ${paneInfo()} ${timeStr()}`, props.maxWidth);

  return (
    <text fg={nameColor()} bg={bgColor()}>
      {line()}
    </text>
  );
}
