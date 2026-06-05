/**
 * PTY creation and retry logic extracted from App.
 *
 * Lazy loading: PTYs are only created for the focused pane. When the user
 * focuses a different pane (click, keyboard navigation, aggregate view
 * selection), the effect re-runs and creates that pane's PTY. Background
 * panes show a "waiting" indicator until they receive focus.
 */

import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { deferNextTick } from '../../core/scheduling';
import {
  getSessionCwd as getSessionCwdFromCoordinator,
  getSessionCommand as getSessionCommandFromCoordinator,
  getActiveSessionIdForShim,
  isPtyCreated,
  markPtyCreated,
} from '../../effect/bridge';

type PaneRectangle = { width: number; height: number };

type LayoutAccess = {
  panes: Array<{ id: string; ptyId?: string; rectangle?: PaneRectangle | null }>;
  getFocusedPaneId?: () => string | null | undefined;
};

type TerminalAccess = {
  isInitialized: boolean;
  createPTY: (
    paneId: string,
    cols: number,
    rows: number,
    cwd?: string,
    sessionId?: string
  ) => Promise<string | Error>;
  writeToPTY: (ptyId: string, data: string) => void;
  getFocusedCwd: () => Promise<string | null>;
};

type SessionStateLike = {
  initialized: boolean;
  switching: boolean;
};

export async function resolvePaneCwd(params: {
  paneId: string;
  focusedPaneId?: string | null;
  sessionCwd?: string;
  pendingCwdRef: string | null;
  pendingCwdPromise: Promise<string | null> | null;
  fallbackCwd: string;
}): Promise<{ cwd: string; clearPending: boolean }> {
  const isFocused = params.paneId === params.focusedPaneId;
  let pendingCwd = isFocused ? params.pendingCwdRef : null;

  if (!params.sessionCwd && isFocused && !pendingCwd && params.pendingCwdPromise) {
    const resolved = await params.pendingCwdPromise.catch((e) => {
      console.warn('[pty-creation] Failed to resolve pending CWD promise:', e);
      return null;
    });
    if (resolved) {
      pendingCwd = resolved;
    }
  }

  return {
    cwd: params.sessionCwd ?? pendingCwd ?? params.fallbackCwd,
    clearPending: isFocused,
  };
}

export function usePtyCreation(params: {
  layout: LayoutAccess;
  terminal: TerminalAccess;
  sessionState: SessionStateLike;
  newPane: (kind?: string) => void;
  splitPane: (direction: 'horizontal' | 'vertical') => void;
}): { handleNewPane: () => void; handleSplitPane: (direction: 'horizontal' | 'vertical') => void } {
  // Ref for passing CWD to effect (avoids closure issues)
  let pendingCwdRef: string | null = null;
  let pendingCwdPromise: Promise<string | null> | null = null;

  const queueFocusedCwd = () => {
    pendingCwdPromise = params.terminal.getFocusedCwd().then((cwd) => {
      if (cwd) pendingCwdRef = cwd;
      return cwd;
    });
  };

  // Create new pane handler - instant feedback, CWD retrieval in background
  const handleNewPane = () => {
    // Fire off CWD retrieval in background (don't await)
    queueFocusedCwd();

    // Create pane immediately (shows border instantly)
    // PTY will be created by the effect with CWD when available
    params.newPane();
  };

  const handleSplitPane = (direction: 'horizontal' | 'vertical') => {
    queueFocusedCwd();
    params.splitPane(direction);
  };

  // Retry counter to trigger effect re-run when PTY creation fails
  const [ptyRetryCounter, setPtyRetryCounter] = createSignal(0);

  // Guard against concurrent PTY creation (synchronous Set for O(1) check)
  const pendingPtyCreation = new Set<string>();

  // Memoize pane IDs that need PTYs - only changes when panes are added/removed
  // or when a pane's ptyId status changes. This prevents re-triggering PTY creation
  // when unrelated pane properties change (rectangle, cursor position, etc.)
  const panesNeedingPtys = createMemo(() =>
    params.layout.panes.filter((p) => !p.ptyId).map((p) => ({ id: p.id, rectangle: p.rectangle }))
  );

  // Track focused pane ID reactively so the effect re-runs when focus changes
  // to a pane that still needs a PTY.
  const focusedPaneId = createMemo(() => params.layout.getFocusedPaneId?.() ?? null);

  // Create PTYs for panes that don't have one — lazy: only for the focused pane.
  // When the user focuses a different pane, focusedPaneId changes and the
  // effect re-runs to create that pane's PTY.
  createEffect(
    on(
      [
        () => params.terminal.isInitialized,
        () => params.sessionState.initialized,
        () => params.sessionState.switching,
        ptyRetryCounter,
        panesNeedingPtys,
        focusedPaneId,
      ],
      ([isTerminalInit, isSessionInit, isSwitching, _retry, panes, focusedId]) => {
        if (!isTerminalInit) return;
        if (!isSessionInit) return;
        if (isSwitching) return;

        // Only create a PTY for the focused pane. Background panes stay
        // empty until the user focuses them, at which point this effect
        // re-runs (focusedPaneId is a dependency).
        const focusedPane = panes.find((p) => p.id === focusedId);
        if (!focusedPane) return;
        if (pendingPtyCreation.has(focusedPane.id)) return;

        // Capture the active session ID SYNCHRONOUSLY before deferring any
        // macrotasks. This prevents the session-switch race where:
        // 1. Session switch to B completes (switching=false), this effect fires
        // 2. PTY creation is deferred via deferMacrotask
        // 3. AUTOSWITCH fires for session C (e.g. via rapid j/k in aggregate view)
        // 4. setActiveSessionIdForShim(C) is called in onSessionLoad
        // 5. Deferred macrotask runs — without the captured value, createPTY
        //    reads the clobbered global and attributes the PTY to session C
        //    instead of session B.
        const capturedSessionId = getActiveSessionIdForShim();

        pendingPtyCreation.add(focusedPane.id);

        const createPtyForFocusedPane = async () => {
          try {
            // SYNC check: verify PTY wasn't created in a previous session/effect run
            const alreadyCreated = isPtyCreated(focusedPane.id);
            if (alreadyCreated) {
              return true;
            }

            // Calculate pane dimensions (account for border)
            const rect = focusedPane.rectangle ?? { width: 80, height: 24 };
            const cols = Math.max(1, rect.width - 2);
            const rows = Math.max(1, rect.height - 2);

            // Check for session-restored CWD first, then pending CWD from new pane handler,
            // then OPENMUX_ORIGINAL_CWD (set by wrapper to preserve user's cwd)
            const currentFocusedPaneId = params.layout.getFocusedPaneId?.();
            const { cwd, clearPending } = await resolvePaneCwd({
              paneId: focusedPane.id,
              focusedPaneId: currentFocusedPaneId,
              sessionCwd: getSessionCwdFromCoordinator(focusedPane.id),
              pendingCwdRef,
              pendingCwdPromise,
              fallbackCwd: process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd(),
            });

            if (clearPending) {
              pendingCwdRef = null;
              pendingCwdPromise = null;
            }

            // Mark as created BEFORE calling createPTY (persistent marker)
            markPtyCreated(focusedPane.id);

            // Fire-and-forget PTY creation - don't await to avoid blocking
            params.terminal
              .createPTY(focusedPane.id, cols, rows, cwd, capturedSessionId ?? undefined)
              .then((result) => {
                if (result instanceof Error) {
                  console.error(`PTY creation failed for ${focusedPane.id}:`, result.message);
                  return false;
                }
                const ptyId = result;
                const command = getSessionCommandFromCoordinator(focusedPane.id);
                if (command) {
                  params.terminal.writeToPTY(ptyId, `${command}\n`);
                }
                return true;
              })
              .catch((err) => {
                console.error(`PTY creation failed for ${focusedPane.id}:`, err);
                return false;
              });

            return true;
          } catch (err) {
            console.error(`Failed to create PTY for pane ${focusedPane.id}:`, err);
            return false;
          } finally {
            pendingPtyCreation.delete(focusedPane.id);
          }
        };

        // Create PTY on next tick — fast (setImmediate-priority), avoids
        // blocking the current render cycle.
        deferNextTick(() => {
          createPtyForFocusedPane().then((success) => {
            if (!success) {
              setTimeout(() => setPtyRetryCounter((c) => c + 1), 100);
            }
          });
        });
      }
    )
  );

  return { handleNewPane, handleSplitPane };
}
