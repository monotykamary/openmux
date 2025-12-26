/**
 * PaneContainer - renders master-stack layout panes
 */

import { Show, For, Index, createMemo } from 'solid-js';
import type { PaneData } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useSession } from '../contexts/SessionContext';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useTitle } from '../contexts/TitleContext';
import { getFocusedPane, isMainPaneFocused } from '../core/workspace-utils';
import { Pane } from './Pane';

export function PaneContainer() {
  const layout = useLayout();
  const { focusPane } = layout;
  const { writeToPTY, isMouseTrackingEnabled } = useTerminal();
  const session = useSession();
  const { state: aggregateState } = useAggregateView();

  // Memoize workspace properties to prevent cascading re-renders
  // Access layout.activeWorkspace once and derive stable values
  const workspace = () => layout.activeWorkspace;
  const mainPane = createMemo(() => workspace().mainPane);
  const stackPanes = createMemo(() => workspace().stackPanes);
  const focusedPaneId = createMemo(() => workspace().focusedPaneId);
  const layoutMode = createMemo(() => workspace().layoutMode);
  const isZoomed = createMemo(() => workspace().zoomed);
  const activeStackIndex = createMemo(() => workspace().activeStackIndex);

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

  // Don't show "No panes" message while session is switching or aggregate view is open (prevents bleed-through)
  const showNoPanesMessage = () => !mainPane() && !session.state.switching && !aggregateState.showAggregateView;

  return (
    <box style={{ flexGrow: 1, position: 'relative' }}>
      <Show
        when={mainPane()}
        fallback={
          <Show when={showNoPanesMessage()}>
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
          </Show>
        }
      >
        <Show
          when={isZoomed()}
          fallback={
            <box
              style={{
                position: 'relative',
                flexGrow: 1,
              }}
            >
              {/* Render main pane */}
              <PaneRenderer
                pane={mainPane()!}
                isFocused={focusedPaneId() === mainPane()!.id}
                isMain={true}
                onFocus={handlePaneClick}
                onMouseInput={handleMouseInput}
              />

              {/* Render stack panes */}
              <Show
                when={layoutMode() === 'stacked'}
                fallback={
                  /* Use Index instead of For - tracks by position not reference.
                     This prevents component recreation when array reference changes
                     but individual panes stay the same (just their rectangles update) */
                  <Index each={stackPanes()}>
                    {(pane) => (
                      <PaneRenderer
                        pane={pane()}
                        isFocused={focusedPaneId() === pane().id}
                        isMain={false}
                        onFocus={handlePaneClick}
                        onMouseInput={handleMouseInput}
                      />
                    )}
                  </Index>
                }
              >
                {/* Stacked mode: render tab headers and only the active pane */}
                <StackedPanesRenderer
                  stackPanes={stackPanes()}
                  activeStackIndex={activeStackIndex()}
                  focusedPaneId={focusedPaneId()}
                  onFocus={handlePaneClick}
                  onMouseInput={handleMouseInput}
                />
              </Show>
            </box>
          }
        >
          {/* When zoomed, only render the focused pane */}
          <ZoomedPaneRenderer
            workspace={workspace()}
            onFocus={handlePaneClick}
            onMouseInput={handleMouseInput}
          />
        </Show>
      </Show>
    </box>
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
  const theme = useTheme();
  const titleCtx = useTitle();
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
    // Access titleVersion to create reactive dependency on title changes
    titleCtx.titleVersion();
    const visibleWidth = rect().width - 1; // Account for tab bar offset from pane edge

    // Build tab info with positions
    const tabItems = props.stackPanes.map((pane, index) => {
      const isActive = index === props.activeStackIndex;
      // Get title from TitleContext (avoids layout store re-renders)
      const title = titleCtx.getTitle(pane.id) ?? pane.title ?? 'pane';
      // Use consistent space padding for all tabs (background fill indicates active)
      const label = ` ${title} `;
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

    // Calculate active tab's visual position for the connector
    const activeTabVisualX = activeTab ? Math.max(0, activeTab.start - scrollOffset) : 0;
    const activeTabVisualWidth = activeTab ? Math.min(activeTab.width, visibleWidth - activeTabVisualX) : 0;

    return { tabs: result, activeTabVisualX, activeTabVisualWidth };
  });

  // Extract just the tabs for rendering
  const tabs = () => visibleTabs().tabs;

  // Get active tab info for connector
  const activeTabInfo = () => {
    const { activeTabVisualX, activeTabVisualWidth } = visibleTabs();
    return activeTabVisualWidth > 0 ? { x: activeTabVisualX, width: activeTabVisualWidth } : null;
  };

  // Whether the stacked pane area is focused (vs main pane)
  const isPaneFocused = () => props.focusedPaneId === activePane()?.id;
  // Active tab background color based on focus state
  const activeTabBg = () => isPaneFocused() ? theme.pane.focusedBorderColor : theme.pane.borderColor;

  return (
    <Show when={activePane()}>
      {/* Tab headers for stacked panes (positioned above the pane rectangle) */}
      <box
        style={{
          position: 'absolute',
          left: rect().x + 1,
          top: rect().y - 1,
          width: rect().width - 1,
          height: 1,
          flexDirection: 'row',
        }}
      >
        <For each={tabs()}>
          {({ pane, label, isActive }) => (
            <text
              fg={isActive ? '#FFFFFF' : '#666666'}
              bg={isActive ? activeTabBg() : undefined}
              selectable={false}
              onMouseDown={(e: { preventDefault: () => void }) => {
                e.preventDefault();
                handleTabClick(pane.id);
              }}
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
        hideTitle={true}
        onClick={handleClick}
        onMouseInput={handleMouseInput}
      />

      {/* Connector: fills the gap between active tab and pane border using upper half block */}
      <Show when={activeTabInfo()}>
        {(info: () => { x: number; width: number }) => (
          <text
            style={{
              position: 'absolute',
              left: rect().x + 1 + info().x,
              top: rect().y,
            }}
            fg={activeTabBg()}
          >
            {'▀'.repeat(info().width)}
          </text>
        )}
      </Show>
    </Show>
  );
}
