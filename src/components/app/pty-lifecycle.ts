import { createEffect, createMemo, on, type Accessor, type Setter } from 'solid-js';
import type { SessionState } from '../../core/operations/session-actions';

interface LayoutDeps {
  panes: Array<{ id: string; rectangle?: { width: number; height: number } | null; ptyId?: string | null }>;
}

interface TerminalDeps {
  isInitialized: boolean;
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<void>;
}

interface PendingCwdRef {
  current: string | null;
}

interface PtyLifecycleDeps {
  layout: LayoutDeps;
  terminal: TerminalDeps;
  sessionState: Pick<SessionState, 'initialized' | 'switching'>;
  ptyRetryCounter: Accessor<number>;
  setPtyRetryCounter: Setter<number>;
  pendingCwdRef: PendingCwdRef;
  getSessionCwd: (paneId: string) => string | null;
  markPtyCreated: (paneId: string) => void;
  isPtyCreated: (paneId: string) => boolean;
}

export function usePtyLifecycle(deps: PtyLifecycleDeps): void {
  const panesNeedingPtys = createMemo(() =>
    deps.layout.panes.filter(p => !p.ptyId).map(p => ({ id: p.id, rectangle: p.rectangle }))
  );

  const pendingPtyCreation = new Set<string>();

  createEffect(
    on(
      [
        () => deps.terminal.isInitialized,
        () => deps.sessionState.initialized,
        () => deps.sessionState.switching,
        deps.ptyRetryCounter,
        panesNeedingPtys,
      ],
      ([isTerminalInit, isSessionInit, isSwitching, _retry, panes]) => {
        if (!isTerminalInit) return;
        if (!isSessionInit) return;
        if (isSwitching) return;

        const createPtyForPane = (pane: typeof panes[number]) => {
          try {
            const alreadyCreated = deps.isPtyCreated(pane.id);
            if (alreadyCreated) {
              return true;
            }

            const rect = pane.rectangle ?? { width: 80, height: 24 };
            const cols = Math.max(1, rect.width - 2);
            const rows = Math.max(1, rect.height - 2);

            const sessionCwd = deps.getSessionCwd(pane.id);
            let cwd = sessionCwd ?? deps.pendingCwdRef.current ?? process.env.OPENMUX_ORIGINAL_CWD ?? undefined;
            deps.pendingCwdRef.current = null;

            deps.markPtyCreated(pane.id);

            deps.terminal.createPTY(pane.id, cols, rows, cwd).catch(err => {
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

        const panesToProcess: typeof panes[number][] = [];
        for (const pane of panes) {
          if (pendingPtyCreation.has(pane.id)) {
            continue;
          }
          pendingPtyCreation.add(pane.id);
          panesToProcess.push(pane);
        }

        if (panesToProcess.length > 0) {
          setTimeout(() => {
            let anyFailed = false;
            for (const pane of panesToProcess) {
              const success = createPtyForPane(pane);
              if (!success) {
                anyFailed = true;
              }
            }
            if (anyFailed) {
              setTimeout(() => deps.setPtyRetryCounter(c => c + 1), 100);
            }
          }, 0);
        }
      }
    )
  );
}
