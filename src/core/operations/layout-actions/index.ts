/**
 * Layout actions module
 * Re-exports all layout reducer functionality
 */

export type { LayoutState, LayoutAction, Workspaces } from './types';

export {
  generatePaneId,
  resetPaneIdCounter,
  syncPaneIdCounter,
  createWorkspace,
  getActiveWorkspace,
  updateWorkspace,
  recalculateLayout,
} from './helpers';

export { layoutReducer } from './reducer';

// Individual action handlers (for direct use if needed)
export { handleFocusPane } from './focus-pane';
export { handleNavigate } from './navigate';
export { handleNewPane } from './new-pane';
export { handleClosePane, handleClosePaneById } from './close-pane';
export { handleSetViewport, handleSwitchWorkspace, handleLoadSession, handleClearAll } from './workspace-ops';
export { handleSetLayoutMode, handleSetPanePty, handleSetPaneTitle, handleSwapMain, handleMovePane, handleToggleZoom } from './pane-ops';
