/**
 * PTY subscription management utilities
 * Consolidates duplicated subscription logic from TerminalContext
 */

import {
  onPtyExit,
  subscribeUnifiedToPty,
  getEmulator,
} from '../effect/bridge';
import type { TerminalState, TerminalCell, TerminalScrollState, UnifiedTerminalUpdate } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';

/**
 * Caches used for synchronous access to PTY state
 */
export interface PtyCaches {
  terminalStates: Map<string, TerminalState>;
  scrollStates: Map<string, TerminalScrollState>;
  emulators: Map<string, ITerminalEmulator>;
}

/**
 * Subscribe to a PTY and manage all callbacks
 * Returns unsubscribe function
 */
export async function subscribeToPtyWithCaches(
  ptyId: string,
  paneId: string,
  caches: PtyCaches,
  onExit: (ptyId: string, paneId: string) => void
): Promise<() => void> {
  // Register exit callback
  const unsubExit = await onPtyExit(ptyId, () => {
    onExit(ptyId, paneId);
  });

  // Cache the emulator for synchronous access (selection text extraction)
  const emulator = await getEmulator(ptyId);
  if (emulator) {
    caches.emulators.set(ptyId, emulator);
  }

  // Cache for terminal rows (structural sharing)
  let cachedRows: TerminalCell[][] = [];

  // Subscribe to unified updates (terminal + scroll combined)
  // This eliminates race conditions from separate subscriptions
  const unsubState = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
    const { terminalUpdate, scrollState } = update;

    // Update terminal state cache
    if (terminalUpdate.isFull && terminalUpdate.fullState) {
      // Full refresh: store complete state
      caches.terminalStates.set(ptyId, terminalUpdate.fullState);
      cachedRows = [...terminalUpdate.fullState.cells];
    } else {
      // Delta update: merge dirty rows into cached state
      const existingState = caches.terminalStates.get(ptyId);
      if (existingState) {
        if (terminalUpdate.dirtyRows.size > 0) {
          // Apply dirty rows to cached rows
          for (const [rowIdx, newRow] of terminalUpdate.dirtyRows) {
            cachedRows[rowIdx] = newRow;
          }
        }
        // Update state with merged cells and new cursor/modes
        caches.terminalStates.set(ptyId, {
          ...existingState,
          cells: cachedRows,
          cursor: terminalUpdate.cursor,
          alternateScreen: terminalUpdate.alternateScreen,
          mouseTracking: terminalUpdate.mouseTracking,
          cursorKeyMode: terminalUpdate.cursorKeyMode,
        });
      }
    }

    // Update scroll state cache synchronously (no more race conditions!)
    caches.scrollStates.set(ptyId, scrollState);
  });

  // Return combined unsubscribe function
  return () => {
    unsubExit();
    unsubState();
  };
}

/**
 * Clear all caches for a PTY
 */
export function clearPtyCaches(ptyId: string, caches: PtyCaches): void {
  caches.terminalStates.delete(ptyId);
  caches.scrollStates.delete(ptyId);
  caches.emulators.delete(ptyId);
}

/**
 * Clear all caches
 */
export function clearAllPtyCaches(caches: PtyCaches): void {
  caches.terminalStates.clear();
  caches.scrollStates.clear();
  caches.emulators.clear();
}
