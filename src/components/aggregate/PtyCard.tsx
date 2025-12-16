/**
 * PTY card component for aggregate view list
 * Displays directory name, process name, and git branch in a 2-line card format
 */

import type { PtyInfo } from '../../contexts/AggregateViewContext';
import { getDirectoryName } from './utils';

interface PtyCardProps {
  pty: PtyInfo;
  isSelected: boolean;
  maxWidth: number;
}

/**
 * Single PTY card in the list (2 lines: dir name + process, git branch)
 */
export function PtyCard(props: PtyCardProps) {
  const selectMarker = () => props.isSelected ? '>' : ' ';
  const dirName = () => getDirectoryName(props.pty.cwd);
  const process = () => props.pty.foregroundProcess ?? 'shell';
  const gitBranch = () => props.pty.gitBranch;

  // First line: dirName (process)
  const line1 = () => `${selectMarker()} ${dirName()} (${process()})`;

  // Second line: git branch (if available)
  const line2 = () => gitBranch() ? `    ${gitBranch()}` : '';

  // Use background color for selection, keep foreground neutral
  const fgColor = () => props.isSelected ? '#FFFFFF' : '#CCCCCC';
  const bgColor = () => props.isSelected ? '#3b82f6' : undefined;
  // Dim color needs to be readable - lighter on blue, darker otherwise
  const dimColor = () => props.isSelected ? '#93c5fd' : '#666666';

  return (
    <box style={{ flexDirection: 'column', height: 2 }} backgroundColor={bgColor()}>
      <box style={{ height: 1 }}>
        <text fg={fgColor()}>{line1().slice(0, props.maxWidth)}</text>
      </box>
      <box style={{ height: 1 }}>
        <text fg={dimColor()}>{line2().slice(0, props.maxWidth)}</text>
      </box>
    </box>
  );
}
