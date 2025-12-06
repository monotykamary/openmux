/**
 * PaneContainer - renders master-stack layout panes
 */

import { useCallback } from 'react';
import type { PaneData, LayoutMode } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { Pane } from './Pane';

export function PaneContainer() {
  const { activeWorkspace, dispatch } = useLayout();
  const theme = useTheme();

  const handlePaneClick = useCallback((paneId: string) => {
    dispatch({ type: 'FOCUS_PANE', paneId });
  }, [dispatch]);

  if (!activeWorkspace.mainPane) {
    return (
      <box
        style={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg="#666666">
          No panes. Press Ctrl+b n or Alt+n to create a pane.
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        position: 'relative',
        flexGrow: 1,
      }}
    >
      {/* Render main pane */}
      <PaneRenderer
        pane={activeWorkspace.mainPane}
        isFocused={activeWorkspace.focusedPaneId === activeWorkspace.mainPane.id}
        isMain={true}
        onFocus={handlePaneClick}
      />

      {/* Render stack panes */}
      {activeWorkspace.layoutMode === 'stacked' ? (
        // Stacked mode: render tab headers and only the active pane
        <StackedPanesRenderer
          stackPanes={activeWorkspace.stackPanes}
          activeStackIndex={activeWorkspace.activeStackIndex}
          focusedPaneId={activeWorkspace.focusedPaneId}
          onFocus={handlePaneClick}
        />
      ) : (
        // Vertical/Horizontal mode: render all stack panes
        activeWorkspace.stackPanes.map((pane) => (
          <PaneRenderer
            key={pane.id}
            pane={pane}
            isFocused={activeWorkspace.focusedPaneId === pane.id}
            isMain={false}
            onFocus={handlePaneClick}
          />
        ))
      )}
    </box>
  );
}

interface PaneRendererProps {
  pane: PaneData;
  isFocused: boolean;
  isMain: boolean;
  onFocus: (paneId: string) => void;
}

function PaneRenderer({ pane, isFocused, isMain, onFocus }: PaneRendererProps) {
  const rect = pane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = useCallback(() => {
    onFocus(pane.id);
  }, [onFocus, pane.id]);

  return (
    <Pane
      id={pane.id}
      title={pane.title}
      isFocused={isFocused}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      ptyId={pane.ptyId}
      onClick={handleClick}
    />
  );
}

interface StackedPanesRendererProps {
  stackPanes: PaneData[];
  activeStackIndex: number;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
}

function StackedPanesRenderer({
  stackPanes,
  activeStackIndex,
  focusedPaneId,
  onFocus,
}: StackedPanesRendererProps) {
  if (stackPanes.length === 0) return null;

  const activePane = stackPanes[activeStackIndex];
  if (!activePane) return null;

  const rect = activePane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = useCallback(() => {
    onFocus(activePane.id);
  }, [onFocus, activePane.id]);

  const handleTabClick = useCallback((paneId: string) => {
    onFocus(paneId);
  }, [onFocus]);

  return (
    <>
      {/* Tab headers for stacked panes */}
      <box
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: 1,
          flexDirection: 'row',
        }}
        backgroundColor="#1a1a1a"
      >
        {stackPanes.map((pane, index) => (
          <text
            key={pane.id}
            fg={index === activeStackIndex ? '#00AAFF' : '#666666'}
            onMouseDown={() => handleTabClick(pane.id)}
          >
            {index === activeStackIndex ? `[${pane.title ?? 'pane'}]` : ` ${pane.title ?? 'pane'} `}
          </text>
        ))}
      </box>

      {/* Active pane (offset by 1 for tab header) */}
      <Pane
        id={activePane.id}
        title={activePane.title}
        isFocused={focusedPaneId === activePane.id}
        x={rect.x}
        y={rect.y + 1}
        width={rect.width}
        height={Math.max(1, rect.height - 1)}
        ptyId={activePane.ptyId}
        onClick={handleClick}
      />
    </>
  );
}
