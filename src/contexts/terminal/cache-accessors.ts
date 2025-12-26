/**
 * Cache accessor functions for TerminalContext
 * Provides synchronous access to cached terminal state for performance
 */

import type { TerminalState } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { PtyCaches } from '../../hooks/usePtySubscription';
import { getPtyCwd, getPtyForegroundProcess } from '../../effect/bridge';

export interface CacheAccessorDeps {
  /** Unified caches for PTY state */
  ptyCaches: PtyCaches;
  /** Map of ptyId -> paneId for current session */
  ptyToPaneMap: Map<string, string>;
  /** Reverse index: ptyId -> { sessionId, paneId } for O(1) lookups */
  ptyToSessionMap: Map<string, { sessionId: string; paneId: string }>;
  /** Function to get the focused PTY ID */
  getFocusedPtyId: () => string | undefined;
}

/**
 * Creates cache accessor functions for TerminalContext
 */
export function createCacheAccessors(deps: CacheAccessorDeps) {
  const {
    ptyCaches,
    ptyToPaneMap,
    ptyToSessionMap,
    getFocusedPtyId,
  } = deps;

  /**
   * Get the current working directory of the focused pane
   */
  const getFocusedCwd = async (): Promise<string | null> => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return null;
    return getPtyCwd(focusedPtyId);
  };

  /**
   * Get CWD for a specific PTY session
   */
  const getSessionCwd = async (ptyId: string): Promise<string> => {
    return getPtyCwd(ptyId);
  };

  /**
   * Get foreground process name for a specific PTY session
   */
  const getSessionForegroundProcess = async (ptyId: string): Promise<string | undefined> => {
    return getPtyForegroundProcess(ptyId);
  };

  /**
   * Get the cursor key mode from the focused pane (sync - uses cache)
   */
  const getFocusedCursorKeyMode = (): 'normal' | 'application' => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return 'normal';

    const emulator = ptyCaches.emulators.get(focusedPtyId);
    return emulator?.getCursorKeyMode() ?? 'normal';
  };

  /**
   * Check if mouse tracking is enabled for a PTY (sync - uses cache)
   */
  const isMouseTrackingEnabled = (ptyId: string): boolean => {
    const emulator = ptyCaches.emulators.get(ptyId);
    return emulator?.isMouseTrackingEnabled() ?? false;
  };

  /**
   * Check if terminal is in alternate screen mode (sync - uses cache)
   */
  const isAlternateScreen = (ptyId: string): boolean => {
    const emulator = ptyCaches.emulators.get(ptyId);
    return emulator?.isAlternateScreen() ?? false;
  };

  /**
   * Get cached emulator synchronously (for selection text extraction)
   */
  const getEmulatorSync = (ptyId: string): ITerminalEmulator | null => {
    return ptyCaches.emulators.get(ptyId) ?? null;
  };

  /**
   * Get the focused emulator synchronously.
   */
  const getFocusedEmulator = (): ITerminalEmulator | null => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return null;
    return ptyCaches.emulators.get(focusedPtyId) ?? null;
  };

  /**
   * Get cached terminal state synchronously (for selection text extraction)
   */
  const getTerminalStateSync = (ptyId: string): TerminalState | null => {
    const emulator = ptyCaches.emulators.get(ptyId);
    return emulator?.getTerminalState() ?? null;
  };

  /**
   * Find which session owns a PTY - O(1) using reverse index
   */
  const findSessionForPty = (
    ptyId: string
  ): { sessionId: string; paneId: string } | null => {
    // O(1) lookup using reverse index
    const sessionInfo = ptyToSessionMap.get(ptyId);
    if (sessionInfo) {
      return sessionInfo;
    }

    // If not in reverse index, check current session's ptyToPaneMap (active PTYs)
    // These may not be in sessionPtyMap yet if session hasn't been suspended
    const currentPaneId = ptyToPaneMap.get(ptyId);
    if (currentPaneId) {
      // PTY is in the current (unsaved) session - return null
      // The caller should handle current session separately
      return null;
    }

    return null;
  };

  return {
    getFocusedCwd,
    getSessionCwd,
    getSessionForegroundProcess,
    getFocusedCursorKeyMode,
    isMouseTrackingEnabled,
    isAlternateScreen,
    getEmulatorSync,
    getFocusedEmulator,
    getTerminalStateSync,
    findSessionForPty,
  };
}
