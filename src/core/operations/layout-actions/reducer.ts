/**
 * Main layout reducer
 * Delegates to action-specific handlers
 */

import type { LayoutState, LayoutAction } from './types';
import { handleFocusPane } from './focus-pane';
import { handleNavigate } from './navigate';
import { handleNewPane } from './new-pane';
import { handleClosePane, handleClosePaneById } from './close-pane';
import { handleSetViewport, handleSwitchWorkspace, handleLoadSession, handleClearAll } from './workspace-ops';
import { handleSetLayoutMode, handleSetPanePty, handleSetPaneTitle, handleSwapMain, handleMovePane, handleToggleZoom } from './pane-ops';

/**
 * Layout reducer - handles all layout-related actions
 */
export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'FOCUS_PANE':
      return handleFocusPane(state, action.paneId);

    case 'NAVIGATE':
      return handleNavigate(state, action.direction);

    case 'MOVE_PANE':
      return handleMovePane(state, action.direction);

    case 'NEW_PANE':
      return handleNewPane(state, action.ptyId, action.title);

    case 'CLOSE_PANE':
      return handleClosePane(state);

    case 'CLOSE_PANE_BY_ID':
      return handleClosePaneById(state, action.paneId);

    case 'SET_VIEWPORT':
      return handleSetViewport(state, action.viewport);

    case 'SWITCH_WORKSPACE':
      return handleSwitchWorkspace(state, action.workspaceId);

    case 'SET_LAYOUT_MODE':
      return handleSetLayoutMode(state, action.mode);

    case 'SET_PANE_PTY':
      return handleSetPanePty(state, action.paneId, action.ptyId);

    case 'SET_PANE_TITLE':
      return handleSetPaneTitle(state, action.paneId, action.title);

    case 'SWAP_MAIN':
      return handleSwapMain(state);

    case 'TOGGLE_ZOOM':
      return handleToggleZoom(state);

    case 'LOAD_SESSION':
      return handleLoadSession(state, action.workspaces, action.activeWorkspaceId);

    case 'CLEAR_ALL':
      return handleClearAll(state);

    default:
      return state;
  }
}
