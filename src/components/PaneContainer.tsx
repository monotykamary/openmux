/**
 * PaneContainer - renders master-stack layout panes
 */

import { Show, For, createMemo } from 'solid-js';
import type { PaneData, LayoutMode } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { getFocusedPane, isMainPaneFocused } from '../core/workspace-utils';
import { Pane } from './Pane';

export function PaneContainer() {
  const layout = useLayout();
  const { focusPane } = layout;
  const theme = useTheme();
  const { writeToPTY, isMouseTrackingEnabled } = useTerminal();

  const handlePaneClick = (paneId: string) => {
    focusPane(paneId);
  };

  const handleMouseInput = (ptyId: string, data: string) => {
    // Only forward mouse events if the child application has enabled mouse tracking
    // (via escape sequences like \x1b[?1000h)
    // Otherwise the shell will echo them as raw text
    if (isMouseTrackingEnabled(ptyId)) {
      writeToPTY(ptyId, data);
    }
  };

  return (
    <Show
      when={layout.activeWorkspace.mainPane}
      fallback={
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
      }
    >
      <Show
        when={layout.activeWorkspace.zoomed}
        fallback={
          <box
            style={{
              position: 'relative',
              flexGrow: 1,
            }}
          >
            {/* Render main pane */}
            <PaneRenderer
              pane={layout.activeWorkspace.mainPane!}
              isFocused={layout.activeWorkspace.focusedPaneId === layout.activeWorkspace.mainPane!.id}
              isMain={true}
              onFocus={handlePaneClick}
              onMouseInput={handleMouseInput}
            />

            {/* Render stack panes */}
            <Show
              when={layout.activeWorkspace.layoutMode === 'stacked'}
              fallback={
                <For each={layout.activeWorkspace.stackPanes}>
                  {(pane) => (
                    <PaneRenderer
                      pane={pane}
                      isFocused={layout.activeWorkspace.focusedPaneId === pane.id}
                      isMain={false}
                      onFocus={handlePaneClick}
                      onMouseInput={handleMouseInput}
                    />
                  )}
                </For>
              }
            >
              {/* Stacked mode: render tab headers and only the active pane */}
              <StackedPanesRenderer
                stackPanes={layout.activeWorkspace.stackPanes}
                activeStackIndex={layout.activeWorkspace.activeStackIndex}
                focusedPaneId={layout.activeWorkspace.focusedPaneId}
                onFocus={handlePaneClick}
                onMouseInput={handleMouseInput}
              />
            </Show>
          </box>
        }
      >
        {/* When zoomed, only render the focused pane */}
        <ZoomedPaneRenderer
          workspace={layout.activeWorkspace}
          onFocus={handlePaneClick}
          onMouseInput={handleMouseInput}
        />
      </Show>
    </Show>
  );
}

// Zoomed pane helper component
interface ZoomedPaneRendererProps {
  workspace: ReturnType<typeof useLayout>['activeWorkspace'];
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function ZoomedPaneRenderer(props: ZoomedPaneRendererProps) {
  const focusedPane = () => getFocusedPane(props.workspace);

  return (
    <Show when={focusedPane()?.rectangle}>
      <box style={{ position: 'relative', flexGrow: 1 }}>
        <PaneRenderer
          pane={focusedPane()!}
          isFocused={true}
          isMain={isMainPaneFocused(props.workspace)}
          onFocus={props.onFocus}
          onMouseInput={props.onMouseInput}
        />
      </box>
    </Show>
  );
}

interface PaneRendererProps {
  pane: PaneData;
  isFocused: boolean;
  isMain: boolean;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function PaneRenderer(props: PaneRendererProps) {
  const rect = () => props.pane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = () => {
    props.onFocus(props.pane.id);
  };

  const handleMouseInput = (data: string) => {
    if (props.pane.ptyId) {
      props.onMouseInput(props.pane.ptyId, data);
    }
  };

  return (
    <Pane
      id={props.pane.id}
      title={props.pane.title}
      isFocused={props.isFocused}
      x={rect().x}
      y={rect().y}
      width={rect().width}
      height={rect().height}
      ptyId={props.pane.ptyId}
      onClick={handleClick}
      onMouseInput={handleMouseInput}
    />
  );
}

interface StackedPanesRendererProps {
  stackPanes: PaneData[];
  activeStackIndex: number;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function StackedPanesRenderer(props: StackedPanesRendererProps) {
  const activePane = () => props.stackPanes[props.activeStackIndex];
  const rect = () => activePane()?.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = () => {
    const pane = activePane();
    if (pane) {
      props.onFocus(pane.id);
    }
  };

  const handleTabClick = (paneId: string) => {
    props.onFocus(paneId);
  };

  const handleMouseInput = (data: string) => {
    const pane = activePane();
    if (pane?.ptyId) {
      props.onMouseInput(pane.ptyId, data);
    }
  };

  // Calculate visible tabs based on scroll offset
  const visibleTabs = createMemo(() => {
    const visibleWidth = rect().width;

    // Build tab info with positions
    const tabItems = props.stackPanes.map((pane, index) => {
      const isActive = index === props.activeStackIndex;
      const label = isActive
        ? `[${pane.title ?? 'pane'}]`
        : ` ${pane.title ?? 'pane'} `;
      return { pane, label, width: label.length, isActive, index };
    });

    let pos = 0;
    const tabsWithPos = tabItems.map((tab) => {
      const start = pos;
      pos += tab.width;
      return { ...tab, start, end: pos };
    });

    // Calculate scroll offset to keep active tab visible
    const activeTab = tabsWithPos[props.activeStackIndex];
    let scrollOffset = 0;
    if (activeTab) {
      if (activeTab.end > visibleWidth) {
        scrollOffset = activeTab.end - visibleWidth;
      }
      if (activeTab.start < scrollOffset) {
        scrollOffset = activeTab.start;
      }
    }

    // Filter and trim tabs to fit visible area
    const result: Array<{ pane: PaneData; label: string; isActive: boolean }> = [];
    for (const tab of tabsWithPos) {
      const visibleStart = scrollOffset;
      const visibleEnd = scrollOffset + visibleWidth;

      // Skip tabs completely outside visible area
      if (tab.end <= visibleStart || tab.start >= visibleEnd) continue;

      // Calculate visible portion of this tab
      const labelStart = Math.max(0, visibleStart - tab.start);
      const labelEnd = Math.min(tab.width, visibleEnd - tab.start);
      const visibleLabel = tab.label.slice(labelStart, labelEnd);

      if (visibleLabel.length > 0) {
        result.push({ pane: tab.pane, label: visibleLabel, isActive: tab.isActive });
      }
    }
    return result;
  });

  return (
    <Show when={activePane()}>
      {/* Tab headers for stacked panes (positioned above the pane rectangle) */}
      <box
        style={{
          position: 'absolute',
          left: rect().x,
          top: rect().y - 1,
          width: rect().width,
          height: 1,
          flexDirection: 'row',
        }}
      >
        <For each={visibleTabs()}>
          {({ pane, label, isActive }) => (
            <text
              fg={isActive ? '#00AAFF' : '#666666'}
              onMouseDown={() => handleTabClick(pane.id)}
            >
              {label}
            </text>
          )}
        </For>
      </box>

      {/* Active pane (rectangle already accounts for tab header via layout calculation) */}
      <Pane
        id={activePane()!.id}
        title={activePane()!.title}
        isFocused={props.focusedPaneId === activePane()!.id}
        x={rect().x}
        y={rect().y}
        width={rect().width}
        height={rect().height}
        ptyId={activePane()!.ptyId}
        onClick={handleClick}
        onMouseInput={handleMouseInput}
      />
    </Show>
  );
}
