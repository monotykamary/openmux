/**
 * PTY creation and retry logic extracted from App.
 */

import { createEffect, createMemo, createSignal, on } from 'solid-js';
import {
  getSessionCwd as getSessionCwdFromCoordinator,
  getSessionCommand as getSessionCommandFromCoordinator,
  isPtyCreated,
  markPtyCreated,
} from '../../effect/bridge';
import { deferMacrotask } from '../../core/scheduling';

type PaneRectangle = { width: number; height: number };

type LayoutAccess = {
  panes: Array<{ id: string; ptyId?: string; rectangle?: PaneRectangle | null }>;
};

type TerminalAccess = {
  isInitialized: boolean;
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  writeToPTY: (ptyId: string, data: string) => void;
  getFocusedCwd: () => Promise<string | null>;
};

type SessionStateLike = {
  initialized: boolean;
  switching: boolean;
};

export function usePtyCreation(params: {
  layout: LayoutAccess;
  terminal: TerminalAccess;
  sessionState: SessionStateLike;
  newPane: (kind?: string) => void;
}): { handleNewPane: () => void } {
  // Ref for passing CWD to effect (avoids closure issues)
  let pendingCwdRef: string | null = null;

  // Create new pane handler - instant feedback, CWD retrieval in background
  const handleNewPane = () => {
    // Fire off CWD retrieval in background (don't await)
    params.terminal.getFocusedCwd().then((cwd) => {
      if (cwd) pendingCwdRef = cwd;
    });

    // Create pane immediately (shows border instantly)
    // PTY will be created by the effect with CWD when available
    params.newPane();
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

  // Create PTYs for panes that don't have one
  // IMPORTANT: Wait for BOTH terminal AND session to be initialized
  // This prevents creating PTYs before session has a chance to restore workspaces
  // Also skip while session is switching to avoid creating PTYs for stale panes
  // Using on() for explicit dependency tracking - only re-runs when these specific values change
  createEffect(
    on(
      [
        () => params.terminal.isInitialized,
        () => params.sessionState.initialized,
        () => params.sessionState.switching,
        ptyRetryCounter,
        panesNeedingPtys,
      ],
      ([isTerminalInit, isSessionInit, isSwitching, _retry, panes]) => {
        if (!isTerminalInit) return;
        if (!isSessionInit) return;
        if (isSwitching) return;

        const createPtyForPane = (pane: typeof panes[number]) => {
          try {
            // SYNC check: verify PTY wasn't created in a previous session/effect run
            const alreadyCreated = isPtyCreated(pane.id);
            if (alreadyCreated) {
              return true; // Already has a PTY
            }

            // Calculate pane dimensions (account for border)
            const rect = pane.rectangle ?? { width: 80, height: 24 };
            const cols = Math.max(1, rect.width - 2);
            const rows = Math.max(1, rect.height - 2);

            // Check for session-restored CWD first, then pending CWD from new pane handler,
            // then OPENMUX_ORIGINAL_CWD (set by wrapper to preserve user's cwd)
            const sessionCwd = getSessionCwdFromCoordinator(pane.id);
            let cwd = sessionCwd ?? pendingCwdRef ?? process.env.OPENMUX_ORIGINAL_CWD ?? undefined;
            pendingCwdRef = null; // Clear after use

            // Mark as created BEFORE calling createPTY (persistent marker)
            markPtyCreated(pane.id);

            // Fire-and-forget PTY creation - don't await to avoid blocking
            params.terminal.createPTY(pane.id, cols, rows, cwd)
              .then((ptyId) => {
                const command = getSessionCommandFromCoordinator(pane.id);
                if (command) {
                  params.terminal.writeToPTY(ptyId, `${command}\n`);
                }
              })
              .catch((err) => {
                console.error(`PTY creation failed for ${pane.id}:`, err);
              });

            return true;
          } catch (err) {
            console.error(`Failed to create PTY for pane ${pane.id}:`, err);
            return false;
          } finally {
            pendingPtyCreation.delete(pane.id);
          }
        };

        // Process each pane in a separate macrotask to avoid blocking animations
        for (const pane of panes) {
          // SYNCHRONOUS guard: check and add to pendingPtyCreation Set IMMEDIATELY
          if (pendingPtyCreation.has(pane.id)) {
            continue;
          }
          pendingPtyCreation.add(pane.id);

          // Defer to next macrotask - allows animations to continue
          deferMacrotask(() => {
            const success = createPtyForPane(pane);
            if (!success) {
              setTimeout(() => setPtyRetryCounter((c) => c + 1), 100);
            }
          });
        }
      }
    )
  );

  return { handleNewPane };
}
