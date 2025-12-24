/**
 * PTY subscription management utilities
 * Consolidates duplicated subscription logic from TerminalContext
 */

import {
  onPtyExit,
  subscribeUnifiedToPty,
  getEmulator,
} from '../effect/bridge';
import type { TerminalScrollState, UnifiedTerminalUpdate } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';

/**
 * Caches used for synchronous access to PTY state
 */
export interface PtyCaches {
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

  // Subscribe to unified updates (terminal + scroll combined)
  // This eliminates race conditions from separate subscriptions
  const unsubState = await subscribeUnifiedToPty(ptyId, (update: UnifiedTerminalUpdate) => {
    caches.scrollStates.set(ptyId, update.scrollState);
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
  caches.scrollStates.delete(ptyId);
  caches.emulators.delete(ptyId);
}

/**
 * Clear all caches
 */
export function clearAllPtyCaches(caches: PtyCaches): void {
  caches.scrollStates.clear();
  caches.emulators.clear();
}
