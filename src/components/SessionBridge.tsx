/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */

import type { ParentProps } from 'solid-js';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useTitle } from '../contexts/TitleContext';
import { SessionProvider } from '../contexts/SessionContext';
import type { WorkspaceId, PaneData } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import { collectPanes } from '../core/layout-tree';
import { createWorkspace } from '../core/operations/layout-actions/helpers';
import { generatePaneId } from '../core/operations/layout-actions/helpers';
import { countWorkspacePanes, pruneMissingPanes } from './session-bridge-utils';
import { deferMacrotask } from '../core/scheduling';
import {
  clearPtyTracking,
  setActiveSessionIdForShim,
  setSessionCwdMap,
  clearSessionCwdMap,
  setSessionCommandMap,
  clearSessionCommandMap,
  getPtyTitle,
  waitForShimClient,
} from '../effect/bridge';
import * as errore from 'errore';
import { SessionRefreshError } from '../effect/errors';

interface SessionBridgeProps extends ParentProps {}

const DEFAULT_PANE_TITLE = 'shell';

export function SessionBridge(props: SessionBridgeProps) {
  const layout = useLayout();
  const { loadSession, clearAll } = layout;
  const titleContext = useTitle();
  const {
    suspendSession,
    resumeSession,
    cleanupSessionPtys,
    getSessionCwd,
    getSessionForegroundProcess,
    getSessionLastCommand,
    destroyAllPTYs,
  } = useTerminal();

  // In Solid, we don't need refs for stable callbacks - there are no stale closures

  // Callbacks for SessionProvider
  const getCwd = async (ptyId: string) => {
    return getSessionCwd(ptyId);
  };

  const getForegroundProcess = async (ptyId: string) => {
    return getSessionForegroundProcess(ptyId);
  };

  const getLastCommand = async (ptyId: string) => {
    return getSessionLastCommand(ptyId);
  };

  const getWorkspaces = () => {
    return layout.state.workspaces;
  };

  const getActiveWorkspaceId = () => {
    return layout.state.activeWorkspaceId;
  };

  const hydratePaneTitles = async (workspacesToLoad: Workspaces): Promise<void> => {
    const panes: PaneData[] = [];
    for (const workspace of Object.values(workspacesToLoad)) {
      if (!workspace) continue;
      if (workspace.mainPane) {
        collectPanes(workspace.mainPane, panes);
      }
      for (const node of workspace.stackPanes) {
        collectPanes(node, panes);
      }
    }

    if (panes.length === 0) return;

    const manualPaneIds = new Set<string>();
    for (const pane of panes) {
      titleContext.clearTitle(pane.id);
      const trimmedTitle = pane.title?.trim();
      if (trimmedTitle && trimmedTitle !== DEFAULT_PANE_TITLE) {
        manualPaneIds.add(pane.id);
        titleContext.setManualTitle(pane.id, trimmedTitle);
      }
    }

    const waitResult = await errore.tryAsync<void, SessionRefreshError>({
      try: () => waitForShimClient(),
      catch: (e) =>
        new SessionRefreshError({ operation: 'waitForShim', reason: String(e), cause: e }),
    });
    if (waitResult instanceof Error) return;

    await Promise.all(
      panes.map(async (pane) => {
        if (!pane.ptyId) return;
        if (manualPaneIds.has(pane.id)) return;
        const title = (await getPtyTitle(pane.ptyId)).trim();
        if (title) {
          titleContext.setTitle(pane.id, title);
        }
      })
    );
  };

  const onSessionLoad = async (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => {
    const allowPrune = options?.allowPrune ?? true;

    // Make the target session visible to PTY creation before the reactive
    // SessionContext state catches up. This prevents restored or auto-created
    // panes from being registered against the previous session during a switch.
    setActiveSessionIdForShim(sessionId);

    // Try to resume PTYs for this session (if we've visited it before)
    // Pass the focused pane ID so resumeSession can subscribe to it first.
    // Use the ORIGINAL workspaces/activeWorkspaceId here (before pruning)
    // — the focused pane is a hint, and if it ends up pruned the subscription
    // is simply wasted (harmless).
    const resumeFocusedPaneId = workspaces[activeWorkspaceId]?.focusedPaneId;
    const resumeResult = await resumeSession(sessionId, {
      focusedPaneId: resumeFocusedPaneId ?? undefined,
    });
    const restoredPtys = resumeResult?.mapping;
    const missingPaneIds = resumeResult?.missingPaneIds ?? [];
    let workspacesToLoad = workspaces;
    let activeWorkspaceIdToLoad = activeWorkspaceId;

    if (allowPrune && missingPaneIds.length > 0) {
      const previousPaneCount = countWorkspacePanes(workspacesToLoad);
      const pruned = pruneMissingPanes({
        workspaces: workspacesToLoad,
        activeWorkspaceId: activeWorkspaceIdToLoad,
        paneIds: missingPaneIds,
        viewport: layout.state.viewport,
        config: layout.state.config,
      });
      const prunedPaneCount = countWorkspacePanes(pruned.workspaces);
      const wouldWipeSession =
        previousPaneCount > 0 && prunedPaneCount === 0 && (restoredPtys?.size ?? 0) === 0;

      if (!wouldWipeSession) {
        workspacesToLoad = pruned.workspaces;
        activeWorkspaceIdToLoad = pruned.activeWorkspaceId;
        for (const paneId of new Set(missingPaneIds)) {
          cwdMap.delete(paneId);
          commandMap.delete(paneId);
        }
      } else {
        console.warn(
          '[SessionBridge] Ignoring stale prune that would wipe the session layout:',
          sessionId,
          missingPaneIds
        );
      }
    }

    // Auto-create a pane if workspaces are empty and config is enabled
    const isEmpty = Object.values(workspacesToLoad).every(
      (workspace) => !workspace || (!workspace.mainPane && workspace.stackPanes.length === 0)
    );

    if (isEmpty && layout.state.config.autoCreatePaneOnEmptyWorkspace) {
      const newPaneId = generatePaneId();
      const workspace = createWorkspace(1, layout.state.config.defaultLayoutMode);
      workspace.mainPane = {
        id: newPaneId,
        ptyId: undefined,
        title: 'shell',
      };
      workspace.focusedPaneId = newPaneId;
      workspacesToLoad = { [1]: workspace };
      activeWorkspaceIdToLoad = 1;
    }

    // If we have restored PTYs, assign them to the panes
    if (restoredPtys && restoredPtys.size > 0) {
      for (const workspace of Object.values(workspacesToLoad)) {
        if (!workspace) continue;
        const nodes = [];
        if (workspace.mainPane) nodes.push(workspace.mainPane);
        nodes.push(...workspace.stackPanes);
        for (const node of nodes) {
          for (const pane of collectPanes(node)) {
            const ptyId = restoredPtys.get(pane.id);
            if (ptyId) {
              pane.ptyId = ptyId;
            }
          }
        }
      }
    }

    // Clear PTY tracking to allow new PTYs to be created for panes without restored PTYs
    clearPtyTracking();

    // IMPORTANT: Store cwdMap BEFORE loading session
    // This ensures CWDs are available when PTY creation effect runs
    setSessionCwdMap(cwdMap);
    setSessionCommandMap(commandMap);

    // Load workspaces into layout (this triggers reactive effects)
    loadSession({ workspaces: workspacesToLoad, activeWorkspaceId: activeWorkspaceIdToLoad });

    void hydratePaneTitles(workspacesToLoad);
  };

  const onBeforeSwitch = async (currentSessionId: string) => {
    // Suspend PTYs for current session (save mapping, unsubscribe but don't destroy)
    suspendSession(currentSessionId);
    // Clear PTY tracking and CWD map to prevent stale state
    clearPtyTracking();
    clearSessionCwdMap();
    clearSessionCommandMap();
  };

  const onDeleteSession = (sessionId: string) => {
    // Clean up PTYs for deleted session (fire-and-forget is safe here —
    // PTY destruction is deferred via deferMacrotask and errors are logged)
    void cleanupSessionPtys(sessionId);
  };

  const resetLayoutForTemplate = async () => {
    clearAll();

    const timeoutMs = 1000;
    const pollIntervalMs = 25;
    const start = Date.now();

    const isEmpty = () => {
      const workspaces = layout.state.workspaces;
      return Object.values(workspaces).every(
        (workspace) => !workspace || (!workspace.mainPane && workspace.stackPanes.length === 0)
      );
    };

    while (!isEmpty()) {
      if (Date.now() - start > timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    await new Promise<void>((resolve) => deferMacrotask(resolve));
    destroyAllPTYs();
    clearPtyTracking();
    clearSessionCwdMap();
    clearSessionCommandMap();
    await new Promise<void>((resolve) => deferMacrotask(resolve));
  };

  return (
    <SessionProvider
      getCwd={getCwd}
      getForegroundProcess={getForegroundProcess}
      getLastCommand={getLastCommand}
      getWorkspaces={getWorkspaces}
      getActiveWorkspaceId={getActiveWorkspaceId}
      onSessionLoad={onSessionLoad}
      onBeforeSwitch={onBeforeSwitch}
      onDeleteSession={onDeleteSession}
      resetLayoutForTemplate={resetLayoutForTemplate}
      layoutVersion={() => layout.layoutVersion}
    >
      {props.children}
    </SessionProvider>
  );
}
