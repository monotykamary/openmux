/**
 * SearchOverlay - search input overlay for terminal pane search
 *
 * Displays at the bottom of the screen when search mode is active.
 * Shows search query, match count, and navigation hints.
 */

import { Show, type Accessor } from 'solid-js';
import { useSearch } from '../contexts/SearchContext';
import type { SearchState } from '../contexts/search/types';

interface SearchOverlayProps {
  width: number;
  height: number;
}

export function SearchOverlay(props: SearchOverlayProps) {
  const { searchState } = useSearch();

  // Calculate overlay dimensions
  const overlayWidth = () => Math.min(props.width - 4, 60);
  const overlayHeight = 3;
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => props.height - overlayHeight - 1;

  // Build match count display
  const matchDisplay = () => {
    const state = searchState;
    if (!state) return '';
    const { query, matches, currentMatchIndex } = state;
    if (query === '') {
      return '';
    } else if (matches.length === 0) {
      return '0 matches';
    } else {
      return `${currentMatchIndex + 1}/${matches.length}`;
    }
  };

  return (
    <Show when={searchState}>
      {(state: Accessor<SearchState>) => (
        <box
          style={{
            position: 'absolute',
            left: overlayX(),
            top: overlayY(),
            width: overlayWidth(),
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
            <text fg="#FFFFFF">{state().query || ' '}</text>
            <text fg="#FFAA00">_</text>
            <text fg="#444444">  </text>
            <text fg={state().matches.length > 0 ? '#88FF88' : '#888888'}>{matchDisplay()}</text>
            <text fg="#444444">  </text>
            <text fg="#666666">^n/^p:nav Esc:cancel</text>
          </box>
        </box>
      )}
    </Show>
  );
}
