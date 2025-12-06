/**
 * PaneContainer - recursively renders the BSP tree as nested panes
 */

import type { BSPNode } from '../core/types';
import { isPane } from '../core/bsp-tree';
import { useLayout } from '../contexts/LayoutContext';
import { useTheme } from '../contexts/ThemeContext';
import { Pane } from './Pane';

interface PaneContainerProps {
  /** Optional: render a subtree instead of root */
  node?: BSPNode;
}

export function PaneContainer({ node }: PaneContainerProps) {
  const { state } = useLayout();
  const theme = useTheme();

  const rootNode = node ?? state.root;

  if (!rootNode) {
    return (
      <box
        style={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <text fg="#666666">
          No panes. Press Ctrl+b then | or - to create a pane.
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        position: 'relative',
        flexGrow: 1,
        padding: theme.pane.outerGap,
      }}
    >
      <BSPNodeRenderer node={rootNode} focusedId={state.focusedPaneId} />
    </box>
  );
}

interface BSPNodeRendererProps {
  node: BSPNode;
  focusedId: string | null;
}

function BSPNodeRenderer({ node, focusedId }: BSPNodeRendererProps) {
  if (isPane(node)) {
    const rect = node.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

    return (
      <Pane
        id={node.id}
        title={node.title}
        isFocused={node.id === focusedId}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
      />
    );
  }

  // Split node - render children
  return (
    <>
      <BSPNodeRenderer node={node.first} focusedId={focusedId} />
      <BSPNodeRenderer node={node.second} focusedId={focusedId} />
    </>
  );
}
