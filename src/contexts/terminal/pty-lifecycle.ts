/**
 * PTY lifecycle handlers for TerminalContext
 * Handles creation, destruction, and exit events for PTY sessions
 */

import {
  createPtySession,
  destroyPty,
  destroyAllPtys,
} from '../../effect/bridge';
import { getActiveSessionIdForShim, registerPtyPane } from '../../effect/bridge';
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
  /** Create pane with PTY already attached (single render) */
  newPaneWithPty: (ptyId: string, title?: string) => string;
  /** Get estimated dimensions for a new pane */
  getNewPaneDimensions: () => { cols: number; rows: number };
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
    newPaneWithPty,
    getNewPaneDimensions,
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
    // Ghostty-vt is initialized per PTY session
    const ptyId = await createPtySession({ cols, rows, cwd });

    // Track the mapping immediately
    ptyToPaneMap.set(ptyId, paneId);

    const sessionId = getActiveSessionIdForShim();
    if (sessionId) {
      const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
      mapping.set(paneId, ptyId);
      sessionPtyMap.set(sessionId, mapping);
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
      registerPtyPane(sessionId, paneId, ptyId).catch(() => {});
    }

    // Update the pane with the PTY ID FIRST - this triggers TerminalView mounting
    // TerminalView has its own subscription, so we can defer the context subscription
    setPanePty(paneId, ptyId);

    // Defer subscription setup to next frame to avoid blocking the render
    // This spreads out the work and prevents stutter
    setTimeout(async () => {
      const unsub = await subscribeToPtyWithCaches(
        ptyId,
        paneId,
        ptyCaches,
        handlePtyExit
      );
      unsubscribeFns.set(ptyId, unsub);
    }, 0);

    return ptyId;
  };

  /**
   * Create a new pane with PTY in a single render (no stutter)
   * This creates the PTY first, then creates the pane with PTY already attached.
   * @param cwd - Optional working directory for the PTY
   * @param title - Optional title for the pane
   */
  const createPaneWithPTY = async (cwd?: string, title?: string): Promise<string> => {
    // Get estimated dimensions for the new pane
    const { cols, rows } = getNewPaneDimensions();

    // Create PTY first (async - this is the expensive part)
    const ptyId = await createPtySession({ cols, rows, cwd });

    // Create pane with PTY already attached - SINGLE render!
    const paneId = newPaneWithPty(ptyId, title);

    // Track the mapping
    ptyToPaneMap.set(ptyId, paneId);

    const sessionId = getActiveSessionIdForShim();
    if (sessionId) {
      const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
      mapping.set(paneId, ptyId);
      sessionPtyMap.set(sessionId, mapping);
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
      registerPtyPane(sessionId, paneId, ptyId).catch(() => {});
    }

    // Defer subscription setup to next frame to avoid blocking the render
    setTimeout(async () => {
      const unsub = await subscribeToPtyWithCaches(
        ptyId,
        paneId,
        ptyCaches,
        handlePtyExit
      );
      unsubscribeFns.set(ptyId, unsub);
    }, 0);

    return paneId;
  };

  /**
   * Destroy a PTY session (also closes associated pane if one exists)
   * @param options.skipPaneClose - Skip closing the pane (use when pane is already closed)
   */
  const handleDestroyPTY = (ptyId: string, options?: { skipPaneClose?: boolean }): void => {
    // Close associated pane if this PTY is in the current session
    // Skip if caller already closed the pane (avoids redundant layout update)
    const paneId = ptyToPaneMap.get(ptyId);
    if (paneId && !options?.skipPaneClose) {
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
    createPaneWithPTY,
    handleDestroyPTY,
    handleDestroyAllPTYs,
  };
}
