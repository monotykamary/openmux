/**
 * Layout context for BSP tree state management
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { BSPNode, NodeId, SplitDirection, Direction, Rectangle } from '../core/types';
import { BSPConfig, DEFAULT_CONFIG } from '../core/config';
import { insertPane, createFirstPane } from '../core/operations/insert';
import { removePane } from '../core/operations/remove';
import { resizePane } from '../core/operations/resize';
import { navigate } from '../core/operations/navigate';
import { calculateLayout } from '../core/operations/layout';
import { getAllPanes, getPaneCount } from '../core/bsp-tree';

interface LayoutState {
  root: BSPNode | null;
  focusedPaneId: NodeId | null;
  viewport: Rectangle;
  config: BSPConfig;
}

type LayoutAction =
  | { type: 'FOCUS_PANE'; paneId: NodeId }
  | { type: 'NAVIGATE'; direction: Direction }
  | { type: 'SPLIT_PANE'; direction: SplitDirection; ptyId?: string; title?: string }
  | { type: 'CLOSE_PANE' }
  | { type: 'RESIZE'; direction: Direction; delta: number }
  | { type: 'SET_VIEWPORT'; viewport: Rectangle }
  | { type: 'CREATE_FIRST_PANE'; ptyId?: string; title?: string }
  | { type: 'SET_PANE_PTY'; paneId: NodeId; ptyId: string };

function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'FOCUS_PANE':
      return { ...state, focusedPaneId: action.paneId };

    case 'NAVIGATE': {
      const newFocusId = navigate(state.root, state.focusedPaneId, action.direction);
      if (newFocusId && newFocusId !== state.focusedPaneId) {
        return { ...state, focusedPaneId: newFocusId };
      }
      return state;
    }

    case 'SPLIT_PANE': {
      if (!state.root || !state.focusedPaneId) {
        // Create first pane if tree is empty
        const firstPane = createFirstPane({
          ptyId: action.ptyId,
          title: action.title,
        });
        const layoutRoot = calculateLayout(firstPane, state.viewport, state.config);
        return {
          ...state,
          root: layoutRoot,
          focusedPaneId: firstPane.id,
        };
      }

      const { root: newRoot, newPaneId } = insertPane(
        state.root,
        state.focusedPaneId,
        {
          direction: action.direction,
          ptyId: action.ptyId,
          title: action.title,
        }
      );

      const layoutRoot = calculateLayout(newRoot, state.viewport, state.config);
      return {
        ...state,
        root: layoutRoot,
        focusedPaneId: newPaneId,
      };
    }

    case 'CLOSE_PANE': {
      if (!state.root || !state.focusedPaneId) return state;

      const { root: newRoot, newFocusId } = removePane(state.root, state.focusedPaneId);

      if (newRoot) {
        const layoutRoot = calculateLayout(newRoot, state.viewport, state.config);
        return {
          ...state,
          root: layoutRoot,
          focusedPaneId: newFocusId,
        };
      }

      return {
        ...state,
        root: null,
        focusedPaneId: null,
      };
    }

    case 'RESIZE': {
      if (!state.root || !state.focusedPaneId) return state;

      const newRoot = resizePane(
        state.root,
        state.focusedPaneId,
        action.direction,
        action.delta,
        state.config
      );

      if (newRoot) {
        const layoutRoot = calculateLayout(newRoot, state.viewport, state.config);
        return { ...state, root: layoutRoot };
      }
      return state;
    }

    case 'SET_VIEWPORT': {
      if (state.root) {
        const layoutRoot = calculateLayout(state.root, action.viewport, state.config);
        return { ...state, root: layoutRoot, viewport: action.viewport };
      }
      return { ...state, viewport: action.viewport };
    }

    case 'CREATE_FIRST_PANE': {
      const firstPane = createFirstPane({
        ptyId: action.ptyId,
        title: action.title,
      });
      const layoutRoot = calculateLayout(firstPane, state.viewport, state.config);
      return {
        ...state,
        root: layoutRoot,
        focusedPaneId: firstPane.id,
      };
    }

    case 'SET_PANE_PTY': {
      if (!state.root) return state;

      const { paneId, ptyId } = action;

      function updatePanePty(node: BSPNode): BSPNode {
        if (node.type === 'pane') {
          if (node.id === paneId) {
            return { ...node, ptyId: ptyId };
          }
          return node;
        }
        return {
          ...node,
          first: updatePanePty(node.first),
          second: updatePanePty(node.second),
        };
      }

      return { ...state, root: updatePanePty(state.root) };
    }

    default:
      return state;
  }
}

interface LayoutContextValue {
  state: LayoutState;
  dispatch: Dispatch<LayoutAction>;
  paneCount: number;
  panes: ReturnType<typeof getAllPanes>;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

interface LayoutProviderProps {
  config?: Partial<BSPConfig>;
  children: ReactNode;
}

export function LayoutProvider({ config, children }: LayoutProviderProps) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const initialState: LayoutState = {
    root: null,
    focusedPaneId: null,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: mergedConfig,
  };

  const [state, dispatch] = useReducer(layoutReducer, initialState);

  const value = useMemo<LayoutContextValue>(() => ({
    state,
    dispatch,
    paneCount: getPaneCount(state.root),
    panes: getAllPanes(state.root),
  }), [state]);

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}
