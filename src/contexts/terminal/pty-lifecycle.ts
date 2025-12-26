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
  subscribeToPtyExit,
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
  /** Whether to cache scroll state locally */
  shouldCacheScrollState: boolean;
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
    shouldCacheScrollState,
  } = deps;

  const resolvePaneId = (ptyId: string, fallbackPaneId?: string): string | undefined => {
    return ptyToPaneMap.get(ptyId) ?? fallbackPaneId ?? ptyToSessionMap.get(ptyId)?.paneId;
  };

  const cleanupPty = (
    ptyId: string,
    options?: { paneId?: string; closePane?: boolean; destroy?: boolean }
  ): void => {
    const shouldClosePane = options?.closePane ?? true;
    const shouldDestroy = options?.destroy ?? true;
    const sessionInfo = ptyToSessionMap.get(ptyId);
    const targetPaneId = resolvePaneId(ptyId, options?.paneId);

    if (shouldClosePane && targetPaneId) {
      closePaneById(targetPaneId);
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
    if (sessionInfo) {
      const mapping = sessionPtyMap.get(sessionInfo.sessionId);
      if (mapping) {
        mapping.delete(sessionInfo.paneId);
      }
      ptyToSessionMap.delete(ptyId);
    }

    if (shouldDestroy) {
      destroyPty(ptyId);
    }
  };

  /**
   * Handle PTY exit (when shell exits via Ctrl+D, `exit`, etc.)
   * Cleans up subscriptions, caches, and mappings, then closes the pane
   */
  const handlePtyExit = (ptyId: string, paneId: string): void => {
    cleanupPty(ptyId, { paneId, closePane: true, destroy: true });
  };

  /**
   * Handle PTY destroyed lifecycle event (already destroyed in service)
   */
  const handlePtyDestroyed = (ptyId: string): void => {
    cleanupPty(ptyId, { closePane: true, destroy: false });
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

    const exitUnsub = await subscribeToPtyExit(ptyId, paneId, handlePtyExit);
    unsubscribeFns.set(ptyId, exitUnsub);

    // Defer subscription setup to next frame to avoid blocking the render
    // This spreads out the work and prevents stutter
    setTimeout(async () => {
      if (!ptyToPaneMap.has(ptyId)) {
        return;
      }
      const unsub = await subscribeToPtyWithCaches(
        ptyId,
        paneId,
        ptyCaches,
        handlePtyExit,
        { cacheScrollState: shouldCacheScrollState, skipExit: true }
      );
      if (!ptyToPaneMap.has(ptyId)) {
        unsub();
        return;
      }
      unsubscribeFns.set(ptyId, () => {
        exitUnsub();
        unsub();
      });
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

    const exitUnsub = await subscribeToPtyExit(ptyId, paneId, handlePtyExit);
    unsubscribeFns.set(ptyId, exitUnsub);

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
      if (!ptyToPaneMap.has(ptyId)) {
        return;
      }
      const unsub = await subscribeToPtyWithCaches(
        ptyId,
        paneId,
        ptyCaches,
        handlePtyExit,
        { cacheScrollState: shouldCacheScrollState, skipExit: true }
      );
      if (!ptyToPaneMap.has(ptyId)) {
        unsub();
        return;
      }
      unsubscribeFns.set(ptyId, () => {
        exitUnsub();
        unsub();
      });
    }, 0);

    return paneId;
  };

  /**
   * Destroy a PTY session (also closes associated pane if one exists)
   * @param options.skipPaneClose - Skip closing the pane (use when pane is already closed)
   */
  const handleDestroyPTY = (ptyId: string, options?: { skipPaneClose?: boolean }): void => {
    cleanupPty(ptyId, {
      closePane: !options?.skipPaneClose,
      destroy: true,
    });
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
    handlePtyDestroyed,
    createPTY,
    createPaneWithPTY,
    handleDestroyPTY,
    handleDestroyAllPTYs,
  };
}
