/**
 * SearchOverlay - search input overlay for terminal pane search
 *
 * Displays at the bottom of the screen when search mode is active.
 * Shows search query, match count, and navigation hints.
 */

import { useSearch } from '../contexts/SearchContext';

interface SearchOverlayProps {
  width: number;
  height: number;
}

export function SearchOverlay({ width, height }: SearchOverlayProps) {
  const { searchState } = useSearch();

  if (!searchState) return null;

  const { query, matches, currentMatchIndex } = searchState;

  // Calculate overlay dimensions
  const overlayWidth = Math.min(width - 4, 60);
  const overlayHeight = 3;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = height - overlayHeight - 1;

  // Build match count display
  let matchDisplay: string;
  if (query === '') {
    matchDisplay = '';
  } else if (matches.length === 0) {
    matchDisplay = '0 matches';
  } else {
    matchDisplay = `${currentMatchIndex + 1}/${matches.length}`;
  }

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
        borderColor: '#FFAA00',
        padding: 0,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      backgroundColor="#1a1a1a"
      title=" Search "
      titleAlignment="center"
    >
      <box style={{ flexDirection: 'row', height: 1 }}>
        <text fg="#FFAA00">/ </text>
        <text fg="#FFFFFF">{query || ' '}</text>
        <text fg="#FFAA00">_</text>
        <text fg="#444444">  </text>
        <text fg={matches.length > 0 ? '#88FF88' : '#888888'}>{matchDisplay}</text>
        <text fg="#444444">  </text>
        <text fg="#666666">n/N:nav Esc:cancel</text>
      </box>
    </box>
  );
}
