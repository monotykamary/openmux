/**
 * Pane resize handlers for App
 * Handles PTY resizing and position updates
 */

import type { PaneData } from '../../core/types';
import { deferNextTick } from '../../core/scheduling';

export interface PaneResizeDeps {
  // State accessors
  getPanes: () => PaneData[];

  // PTY operations
  resizePTY: (ptyId: string, cols: number, rows: number) => void;
  setPanePosition: (ptyId: string, x: number, y: number) => void;
}

/**
 * Create pane resize handlers
 */
export function createPaneResizeHandlers(deps: PaneResizeDeps) {
  const {
    getPanes,
    resizePTY,
    setPanePosition,
  } = deps;

  type PaneGeometry = { cols: number; rows: number; x: number; y: number };
  const lastGeometry = new Map<string, PaneGeometry>();
  const RESIZE_BATCH_SIZE = 2;
  let resizeScheduled = false;
  let resizeRunning = false;
  let resizeRerunRequested = false;

  const applyPaneResize = (pane: PaneData, seenPtys: Set<string>) => {
    if (!pane.ptyId || !pane.rectangle) return;

    const cols = Math.max(1, pane.rectangle.width - 2);
    const rows = Math.max(1, pane.rectangle.height - 2);
    const x = pane.rectangle.x + 1;
    const y = pane.rectangle.y + 1;
    const geometry: PaneGeometry = { cols, rows, x, y };
    const previous = lastGeometry.get(pane.ptyId);
    const sizeChanged = !previous || previous.cols !== cols || previous.rows !== rows;
    const positionChanged = !previous || previous.x !== x || previous.y !== y;

    if (sizeChanged) {
      resizePTY(pane.ptyId, cols, rows);
    }
    if (positionChanged) {
      setPanePosition(pane.ptyId, x, y);
    }
    if (sizeChanged || positionChanged) {
      lastGeometry.set(pane.ptyId, geometry);
    }
    seenPtys.add(pane.ptyId);
  };

  const cleanupMissingPtys = (seenPtys: Set<string>) => {
    for (const ptyId of Array.from(lastGeometry.keys())) {
      if (!seenPtys.has(ptyId)) {
        lastGeometry.delete(ptyId);
      }
    }
  };

  /**
   * Resize all PTYs and update their positions based on current pane dimensions
   */
  const resizeAllPanes = () => {
    const seenPtys = new Set<string>();
    for (const pane of getPanes()) {
      applyPaneResize(pane, seenPtys);
    }

    cleanupMissingPtys(seenPtys);
  };

  /**
   * Schedule a batched resize to avoid blocking animations.
   */
  const scheduleResizeAllPanes = () => {
    if (resizeRunning) {
      resizeRerunRequested = true;
      return;
    }
    if (resizeScheduled) {
      return;
    }
    resizeScheduled = true;
    deferNextTick(() => {
      resizeScheduled = false;
      resizeRunning = true;
      resizeRerunRequested = false;

      const panesSnapshot = getPanes();
      const seenPtys = new Set<string>();
      let index = 0;

      const runBatch = () => {
        const end = Math.min(index + RESIZE_BATCH_SIZE, panesSnapshot.length);
        for (; index < end; index++) {
          applyPaneResize(panesSnapshot[index], seenPtys);
        }

        if (index < panesSnapshot.length) {
          deferNextTick(runBatch);
          return;
        }

        cleanupMissingPtys(seenPtys);
        resizeRunning = false;

        if (resizeRerunRequested) {
          resizeRerunRequested = false;
          scheduleResizeAllPanes();
        }
      };

      runBatch();
    });
  };

  /**
   * Restore PTY sizes when aggregate view closes
   * The preview resizes PTYs to preview dimensions, so we need to restore pane dimensions
   */
  const restorePaneSizes = () => {
    for (const pane of getPanes()) {
      if (pane.ptyId && pane.rectangle) {
        const cols = Math.max(1, pane.rectangle.width - 2);
        const rows = Math.max(1, pane.rectangle.height - 2);
        const x = pane.rectangle.x + 1;
        const y = pane.rectangle.y + 1;
        resizePTY(pane.ptyId, cols, rows);
        setPanePosition(pane.ptyId, x, y);
        lastGeometry.set(pane.ptyId, { cols, rows, x, y });
      }
    }
  };

  return {
    resizeAllPanes,
    scheduleResizeAllPanes,
    restorePaneSizes,
  };
}
