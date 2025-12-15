/**
 * NAVIGATE action handler
 */

import type { Direction, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, updateWorkspace, recalculateLayout } from './helpers';
import { getAllWorkspacePanes } from '../master-stack-layout';

/**
 * Handle NAVIGATE action
 * Moves focus between panes based on direction and layout mode
 */
export function handleNavigate(state: LayoutState, direction: Direction): LayoutState {
  const workspace = getActiveWorkspace(state);
  const allPanes = getAllWorkspacePanes(workspace);
  if (allPanes.length === 0) return state;

  const currentIndex = allPanes.findIndex(p => p.id === workspace.focusedPaneId);
  if (currentIndex === -1) return state;

  const newIndex = calculateNewIndex(workspace, currentIndex, direction);

  if (newIndex !== currentIndex && newIndex >= 0 && newIndex < allPanes.length) {
    const newPane = allPanes[newIndex];
    if (newPane) {
      const activeStackIndex = newIndex > 0 ? newIndex - 1 : workspace.activeStackIndex;
      let updated: Workspace = {
        ...workspace,
        focusedPaneId: newPane.id,
        activeStackIndex,
      };

      // If zoomed, recalculate layout so new focused pane gets fullscreen
      if (workspace.zoomed) {
        updated = recalculateLayout(updated, state.viewport, state.config);
      }

      return { ...state, workspaces: updateWorkspace(state, updated) };
    }
  }
  return state;
}

/**
 * Calculate the new pane index based on navigation direction and layout mode
 */
function calculateNewIndex(workspace: Workspace, currentIndex: number, direction: Direction): number {
  let newIndex = currentIndex;

  // Navigation logic based on layout mode
  if (workspace.layoutMode === 'vertical' || workspace.layoutMode === 'stacked') {
    newIndex = navigateVerticalLayout(workspace, currentIndex, direction);
  } else {
    newIndex = navigateHorizontalLayout(workspace, currentIndex, direction);
  }

  return newIndex;
}

/**
 * Navigate in vertical/stacked layout (main on left, stack on right)
 */
function navigateVerticalLayout(workspace: Workspace, currentIndex: number, direction: Direction): number {
  let newIndex = currentIndex;

  if (direction === 'west' || direction === 'east') {
    // Move between main and stack
    if (currentIndex === 0 && direction === 'east' && workspace.stackPanes.length > 0) {
      newIndex = 1 + workspace.activeStackIndex;
    } else if (currentIndex > 0 && direction === 'west') {
      newIndex = 0;
    }
  } else if (direction === 'north' || direction === 'south') {
    // Move within stack (vertical) or switch tabs (stacked)
    if (currentIndex > 0) {
      const stackIdx = currentIndex - 1;
      if (direction === 'north' && stackIdx > 0) {
        newIndex = currentIndex - 1;
      } else if (direction === 'south' && stackIdx < workspace.stackPanes.length - 1) {
        newIndex = currentIndex + 1;
      }
    }
  }

  return newIndex;
}

/**
 * Navigate in horizontal layout (main on top, stack on bottom)
 */
function navigateHorizontalLayout(workspace: Workspace, currentIndex: number, direction: Direction): number {
  let newIndex = currentIndex;

  if (direction === 'north' || direction === 'south') {
    // Move between main and stack
    if (currentIndex === 0 && direction === 'south' && workspace.stackPanes.length > 0) {
      newIndex = 1 + workspace.activeStackIndex;
    } else if (currentIndex > 0 && direction === 'north') {
      newIndex = 0;
    }
  } else if (direction === 'west' || direction === 'east') {
    // Move within stack (horizontal)
    if (currentIndex > 0) {
      const stackIdx = currentIndex - 1;
      if (direction === 'west' && stackIdx > 0) {
        newIndex = currentIndex - 1;
      } else if (direction === 'east' && stackIdx < workspace.stackPanes.length - 1) {
        newIndex = currentIndex + 1;
      }
    }
  }

  return newIndex;
}
