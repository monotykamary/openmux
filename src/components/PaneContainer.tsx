/**
 * PaneContainer - renders master-stack layout panes
 */

import type { PaneData, LayoutMode } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { Pane } from './Pane';

export function PaneContainer() {
  const { activeWorkspace, panes } = useLayout();
  const theme = useTheme();

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
          No panes. Press Ctrl+b then n to create a pane.
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
      />

      {/* Render stack panes */}
      {activeWorkspace.layoutMode === 'stacked' ? (
        // Stacked mode: render tab headers and only the active pane
        <StackedPanesRenderer
          stackPanes={activeWorkspace.stackPanes}
          activeStackIndex={activeWorkspace.activeStackIndex}
          focusedPaneId={activeWorkspace.focusedPaneId}
        />
      ) : (
        // Vertical/Horizontal mode: render all stack panes
        activeWorkspace.stackPanes.map((pane) => (
          <PaneRenderer
            key={pane.id}
            pane={pane}
            isFocused={activeWorkspace.focusedPaneId === pane.id}
            isMain={false}
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
}

function PaneRenderer({ pane, isFocused, isMain }: PaneRendererProps) {
  const rect = pane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  return (
    <Pane
      id={pane.id}
      title={pane.title}
      isFocused={isFocused}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
    />
  );
}

interface StackedPanesRendererProps {
  stackPanes: PaneData[];
  activeStackIndex: number;
  focusedPaneId: string | null;
}

function StackedPanesRenderer({
  stackPanes,
  activeStackIndex,
  focusedPaneId,
}: StackedPanesRendererProps) {
  if (stackPanes.length === 0) return null;

  const activePane = stackPanes[activeStackIndex];
  if (!activePane) return null;

  const rect = activePane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

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
      />
    </>
  );
}
