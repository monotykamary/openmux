/**
 * PTY lifecycle handlers for TerminalContext
 * Handles creation, destruction, and exit events for PTY sessions
 */

import { isGhosttyInitialized } from '../../terminal';
import {
  createPtySession,
  destroyPty,
  destroyAllPtys,
} from '../../effect/bridge';
import {
  subscribeToPtyWithCaches,
  clearPtyCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../../hooks/usePtySubscription';

export interface PtyLifecycleDeps {
  /** Map of ptyId -> paneId for current session */
  ptyToPaneMap: Map<string, string>;
  /** Map of sessionId -> Map<paneId, ptyId> for all sessions */
  sessionPtyMap: Map<string, Map<string, string>>;
  /** Reverse index: ptyId -> { sessionId, paneId } for O(1) lookups */
  ptyToSessionMap: Map<string, { sessionId: string; paneId: string }>;
  /** Unified caches for PTY state */
  ptyCaches: PtyCaches;
  /** Map of ptyId -> unsubscribe function */
  unsubscribeFns: Map<string, () => void>;
  /** Close pane by ID (from LayoutContext) */
  closePaneById: (paneId: string) => void;
  /** Set PTY ID for a pane (from LayoutContext) */
  setPanePty: (paneId: string, ptyId: string) => void;
}

/**
 * Creates PTY lifecycle handlers for TerminalContext
 */
export function createPtyLifecycleHandlers(deps: PtyLifecycleDeps) {
  const {
    ptyToPaneMap,
    sessionPtyMap,
    ptyToSessionMap,
    ptyCaches,
    unsubscribeFns,
    closePaneById,
    setPanePty,
  } = deps;

  /**
   * Handle PTY exit (when shell exits via Ctrl+D, `exit`, etc.)
   * Cleans up subscriptions, caches, and mappings, then closes the pane
   */
  const handlePtyExit = (ptyId: string, _paneId: string): void => {
    const mappedPaneId = ptyToPaneMap.get(ptyId);
    if (mappedPaneId) {
      closePaneById(mappedPaneId);
    }

    // Clean up PTY subscription and caches
    const unsub = unsubscribeFns.get(ptyId);
    if (unsub) {
      unsub();
      unsubscribeFns.delete(ptyId);
    }
    clearPtyCaches(ptyId, ptyCaches);
    ptyToPaneMap.delete(ptyId);

    // O(1) removal from session mappings using reverse index
    const sessionInfo = ptyToSessionMap.get(ptyId);
    if (sessionInfo) {
      const mapping = sessionPtyMap.get(sessionInfo.sessionId);
      if (mapping) {
        mapping.delete(sessionInfo.paneId);
      }
      ptyToSessionMap.delete(ptyId);
    }

    // Destroy the PTY from the service (removes from HashMap, emits lifecycle event)
    destroyPty(ptyId);
  };

  /**
   * Create a new PTY session for a pane
   */
  const createPTY = async (
    paneId: string,
    cols: number,
    rows: number,
    cwd?: string
  ): Promise<string> => {
    if (!isGhosttyInitialized()) {
      throw new Error('Ghostty not initialized');
    }

    const ptyId = await createPtySession({ cols, rows, cwd });

    // Track the mapping
    ptyToPaneMap.set(ptyId, paneId);

    // Subscribe to PTY with unified caches
    const unsub = await subscribeToPtyWithCaches(
      ptyId,
      paneId,
      ptyCaches,
      handlePtyExit
    );

    // Store unsubscribe function
    unsubscribeFns.set(ptyId, unsub);

    // Update the pane with the PTY ID
    setPanePty(paneId, ptyId);

    return ptyId;
  };

  /**
   * Destroy a PTY session (also closes associated pane if one exists)
   */
  const handleDestroyPTY = (ptyId: string): void => {
    // Close associated pane if this PTY is in the current session
    const paneId = ptyToPaneMap.get(ptyId);
    if (paneId) {
      closePaneById(paneId);
    }

    // Unsubscribe from updates
    const unsub = unsubscribeFns.get(ptyId);
    if (unsub) {
      unsub();
      unsubscribeFns.delete(ptyId);
    }

    // Clear caches
    clearPtyCaches(ptyId, ptyCaches);
    ptyToPaneMap.delete(ptyId);

    // O(1) removal from session mappings using reverse index
    const sessionInfo = ptyToSessionMap.get(ptyId);
    if (sessionInfo) {
      const mapping = sessionPtyMap.get(sessionInfo.sessionId);
      if (mapping) {
        mapping.delete(sessionInfo.paneId);
      }
      ptyToSessionMap.delete(ptyId);
    }

    // Destroy the PTY (fire and forget)
    destroyPty(ptyId);
  };

  /**
   * Destroy all PTY sessions
   */
  const handleDestroyAllPTYs = (): void => {
    // Unsubscribe all
    for (const unsub of unsubscribeFns.values()) {
      unsub();
    }
    unsubscribeFns.clear();
    clearAllPtyCaches(ptyCaches);
    ptyToPaneMap.clear();
    ptyToSessionMap.clear();
    sessionPtyMap.clear();

    // Destroy all PTYs (fire and forget)
    destroyAllPtys();
  };

  return {
    handlePtyExit,
    createPTY,
    handleDestroyPTY,
    handleDestroyAllPTYs,
  };
}
