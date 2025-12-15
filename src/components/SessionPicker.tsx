/**
 * SessionPicker - modal overlay for session selection and management
 */

import { useCallback, useEffect } from 'react';
import { useSession, type SessionSummary } from '../contexts/SessionContext';
import type { SessionMetadata } from '../core/types';
import { useTheme } from '../contexts/ThemeContext';
import { registerKeyboardHandler } from '../effect/bridge';

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

export function SessionPicker({ width, height }: SessionPickerProps) {
  const theme = useTheme();
  const {
    state,
    dispatch,
    filteredSessions,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    saveSession,
    closePicker,
  } = useSession();

  const {
    showSessionPicker,
    selectedIndex,
    isRenaming,
    renameValue,
    renamingSessionId,
    summaries,
  } = state;

  // Handle keyboard input when picker is open
  const handleKeyDown = useCallback((event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
  }) => {
    if (!showSessionPicker) return false;

    const { key } = event;
    // Normalize key names (OpenTUI uses lowercase for special keys)
    const normalizedKey = key.toLowerCase();

    // If renaming, handle rename-specific keys
    if (isRenaming) {
      if (normalizedKey === 'escape') {
        dispatch({ type: 'CANCEL_RENAME' });
        return true;
      }
      if (normalizedKey === 'return' || normalizedKey === 'enter') {
        if (renamingSessionId && renameValue.trim()) {
          renameSession(renamingSessionId, renameValue.trim());
        }
        return true;
      }
      if (normalizedKey === 'backspace') {
        dispatch({ type: 'UPDATE_RENAME_VALUE', value: renameValue.slice(0, -1) });
        return true;
      }
      // Single printable character
      if (key.length === 1 && !event.ctrl && !event.alt) {
        dispatch({ type: 'UPDATE_RENAME_VALUE', value: renameValue + key });
        return true;
      }
      return true; // Consume all keys while renaming
    }

    // Normal picker navigation
    // Ctrl+key commands (don't conflict with search)
    if (event.ctrl) {
      switch (normalizedKey) {
        case 'n': {
          // Create new session
          createSession();
          return true;
        }

        case 'r': {
          // Start rename
          const selected = filteredSessions[selectedIndex];
          if (selected) {
            dispatch({ type: 'START_RENAME', sessionId: selected.id, currentName: selected.name });
          }
          return true;
        }

        case 'x':
        case 'd': {
          // Delete session
          const selected = filteredSessions[selectedIndex];
          if (selected && filteredSessions.length > 1) {
            deleteSession(selected.id);
          }
          return true;
        }
      }
    }

    switch (normalizedKey) {
      case 'escape':
        closePicker();
        // Save session when closing picker
        saveSession();
        return true;

      case 'down':
        dispatch({ type: 'NAVIGATE_DOWN' });
        return true;

      case 'up':
        dispatch({ type: 'NAVIGATE_UP' });
        return true;

      case 'return':
      case 'enter': {
        const selected = filteredSessions[selectedIndex];
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

      case 'backspace':
        // Remove last character from search
        dispatch({ type: 'SET_SEARCH_QUERY', query: state.searchQuery.slice(0, -1) });
        return true;

      default:
        // Single printable character - add to search
        if (key.length === 1 && !event.ctrl && !event.alt) {
          dispatch({ type: 'SET_SEARCH_QUERY', query: state.searchQuery + key });
          return true;
        }
        return false;
    }
  }, [
    showSessionPicker,
    isRenaming,
    renameValue,
    renamingSessionId,
    filteredSessions,
    selectedIndex,
    state.searchQuery,
    dispatch,
    closePicker,
    saveSession,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
  ]);

  // Register keyboard handler with KeyboardRouter
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    registerKeyboardHandler('sessionPicker', handleKeyDown).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [handleKeyDown]);

  if (!showSessionPicker) return null;

  // Calculate overlay dimensions
  const overlayWidth = Math.min(60, width - 4);
  // Height: search(1) + separator(1) + sessions/empty(max 1) + separator(1) + footer(1) + border(2) + padding(2) = 9 minimum
  const sessionRowCount = Math.max(1, filteredSessions.length); // At least 1 for "No sessions found"
  const overlayHeight = Math.min(sessionRowCount + 7, height - 4);
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
        borderColor: '#00AAFF',
        padding: 1,
      }}
      backgroundColor="#1a1a1a"
      title=" Sessions "
      titleAlignment="center"
    >
      <box style={{ flexDirection: 'column' }}>
        {/* Search bar */}
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg="#888888">{isRenaming ? 'Rename: ' : 'Search: '}</text>
          <text fg="#FFFFFF">
            {(isRenaming ? renameValue : state.searchQuery) + '_'}
          </text>
        </box>

        {/* Separator */}
        <box style={{ height: 1 }}>
          <text fg="#444444">{'─'.repeat(overlayWidth - 4)}</text>
        </box>

        {/* Session list */}
        {filteredSessions.length > 0 ? (
          filteredSessions.map((session, index) => (
            <box key={session.id} style={{ height: 1 }}>
              <SessionRow
                session={session}
                isSelected={index === selectedIndex}
                isActive={session.id === state.activeSessionId}
                isRenaming={isRenaming && session.id === renamingSessionId}
                renameValue={renameValue}
                summary={summaries.get(session.id)}
                maxWidth={overlayWidth - 4}
              />
            </box>
          ))
        ) : (
          <box style={{ height: 1 }}>
            <text fg="#666666">  No sessions found</text>
          </box>
        )}

        {/* Footer with hints */}
        <box style={{ height: 1 }}>
          <text fg="#444444">{'─'.repeat(overlayWidth - 4)}</text>
        </box>
        <box style={{ height: 1 }}>
          <text fg="#666666">
            ↑↓:nav Enter:select ^n:new ^r:rename ^x:del Esc:close
          </text>
        </box>
      </box>
    </box>
  );
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

function SessionRow({
  session,
  isSelected,
  isActive,
  isRenaming,
  renameValue,
  summary,
  maxWidth,
}: SessionRowProps) {
  // Build the row content
  const activeMarker = isActive ? '*' : ' ';
  const selectMarker = isSelected ? '>' : ' ';

  // Name (possibly being renamed)
  const displayName = isRenaming ? renameValue : session.name;
  const nameWidth = Math.min(20, maxWidth - 30);
  const truncatedName = displayName.length > nameWidth
    ? displayName.slice(0, nameWidth - 1) + '…'
    : displayName.padEnd(nameWidth);

  // Summary info
  const workspaceInfo = summary ? `${summary.workspaceCount}ws` : '   ';
  const paneInfo = summary ? `${summary.paneCount}p` : '  ';

  // Time
  const timeStr = formatRelativeTime(session.lastSwitchedAt);

  // Colors - use brighter color for selection
  const nameColor = isSelected ? '#FFFFFF' : (isActive ? '#00AAFF' : '#CCCCCC');

  // Build the line as a single string with proper formatting
  const line = `${selectMarker}${activeMarker} ${truncatedName} ${workspaceInfo} ${paneInfo} ${timeStr}`;

  return (
    <text fg={nameColor}>{line}</text>
  );
}
