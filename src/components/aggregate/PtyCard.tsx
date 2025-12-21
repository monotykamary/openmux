/**
 * PTY card component for aggregate view list
 * Displays directory name, process name, and git branch in a 2-line card format
 */

import type { PtyInfo } from '../../contexts/aggregate-view/types';
import { getDirectoryName } from './utils';

interface PtyCardProps {
  pty: PtyInfo;
  isSelected: boolean;
  maxWidth: number;
  index: number;
  totalCount: number;
  onClick?: () => void;
}

/**
 * Format git diff stats as colored text spans
 */
function formatDiffStats(stats: { added: number; removed: number } | undefined) {
  if (!stats) return null;
  return {
    added: `+${stats.added}`,
    removed: `-${stats.removed}`,
  };
}

/**
 * Single PTY card in the list (4 lines with padding: empty, dir name + process, git branch, empty)
 */
export function PtyCard(props: PtyCardProps) {
  const dirName = () => getDirectoryName(props.pty.cwd);
  const process = () => props.pty.foregroundProcess ?? 'shell';
  const gitBranch = () => props.pty.gitBranch;
  const gitDiffStats = () => formatDiffStats(props.pty.gitDiffStats);

  // Padding constants
  const leftPadding = '   '; // 3 spaces
  const rightPadding = 3;    // 3 spaces on right

  // Calculate number padding based on total count
  const numberWidth = () => String(props.totalCount).length;
  const paddedNumber = () => String(props.index + 1).padStart(numberWidth(), ' ');

  // Calculate indent for second line to align with dirname
  // Line 1: "   1. dirname" = leftPadding + number + ". "
  // Line 2 should align with dirname, so: leftPadding + numberWidth + ". " (2 chars)
  const line2Indent = () => leftPadding + ' '.repeat(numberWidth()) + '  ';

  // First line: leftPadding + number. + dirName (process)
  const line1Text = () => `${leftPadding}${paddedNumber()}. ${dirName()} (${process()})`;

  // Use background color for selection, keep foreground neutral
  const fgColor = () => props.isSelected ? '#FFFFFF' : '#CCCCCC';
  const bgColor = () => props.isSelected ? '#3b82f6' : undefined;
  // Dim color needs to be readable - lighter on blue, darker otherwise
  const dimColor = () => props.isSelected ? '#93c5fd' : '#666666';
  // Git diff colors - green for additions, red for removals
  const addedColor = () => props.isSelected ? '#86efac' : '#22c55e';
  const removedColor = () => props.isSelected ? '#fca5a5' : '#ef4444';

  const handleClick = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onClick?.();
  };

  // Build second line content
  const branchText = () => gitBranch() ?? '';
  const diffStats = () => gitDiffStats();

  // Calculate diff stats width for right-alignment
  const diffStatsText = () => {
    const stats = diffStats();
    if (!stats) return '';
    return `${stats.added},${stats.removed}`;
  };

  // Available width accounting for right padding
  const availableWidth = () => props.maxWidth - rightPadding;

  // Calculate padding needed to right-align diff stats
  const line1Content = () => line1Text().slice(0, availableWidth());
  const line2BranchContent = () => (line2Indent() + branchText());
  const diffStatsWidth = () => diffStatsText().length;

  // For first line: main text on left, diff stats on right (with right padding)
  const line1Padding = () => {
    const textLen = line1Content().length;
    const statsLen = diffStatsWidth();
    const padding = availableWidth() - textLen - statsLen;
    return padding > 0 ? ' '.repeat(padding) : ' ';
  };

  // For second line: branch on left
  const line2Content = () => line2BranchContent().slice(0, availableWidth());

  return (
    <box
      style={{ flexDirection: 'column', height: 2 }}
      backgroundColor={bgColor()}
      onMouseDown={handleClick}
    >
      {/* Line 1: number + dirname (process) + diff stats */}
      <box style={{ height: 1, flexDirection: 'row' }}>
        <text fg={fgColor()}>{line1Content()}</text>
        {diffStats() && (
          <>
            <text fg={fgColor()}>{line1Padding()}</text>
            <text fg={addedColor()}>{diffStats()!.added}</text>
            <text fg={dimColor()}>,</text>
            <text fg={removedColor()}>{diffStats()!.removed}</text>
          </>
        )}
      </box>
      {/* Line 2: branch name */}
      <box style={{ height: 1 }}>
        <text fg={dimColor()}>{line2Content()}</text>
      </box>
    </box>
  );
}
