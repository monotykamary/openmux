/**
 * SessionBridge - bridges SessionContext with Layout and Terminal contexts
 * This component lives inside all contexts and provides callbacks to SessionContext
 */

import type { ParentProps } from 'solid-js';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { SessionProvider } from '../contexts/SessionContext';
import type { WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import { collectPanes } from '../core/layout-tree';
import { pruneMissingPanes } from './session-bridge-utils';
import { deferMacrotask } from '../core/scheduling';
import {
  clearPtyTracking,
  setSessionCwdMap,
  clearSessionCwdMap,
  setSessionCommandMap,
  clearSessionCommandMap,
} from '../effect/bridge';

interface SessionBridgeProps extends ParentProps {}

export function SessionBridge(props: SessionBridgeProps) {
  const layout = useLayout();
  const { loadSession, clearAll } = layout;
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

  const onSessionLoad = async (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => {
    const allowPrune = options?.allowPrune ?? true;

    // Try to resume PTYs for this session (if we've visited it before)
    const resumeResult = await resumeSession(sessionId);
    const restoredPtys = resumeResult?.mapping;
    const missingPaneIds = resumeResult?.missingPaneIds ?? [];
    let workspacesToLoad = workspaces;
    let activeWorkspaceIdToLoad = activeWorkspaceId;

    if (allowPrune && missingPaneIds.length > 0) {
      const pruned = pruneMissingPanes({
        workspaces: workspacesToLoad,
        activeWorkspaceId: activeWorkspaceIdToLoad,
        paneIds: missingPaneIds,
        viewport: layout.state.viewport,
        config: layout.state.config,
      });
      workspacesToLoad = pruned.workspaces;
      activeWorkspaceIdToLoad = pruned.activeWorkspaceId;
      for (const paneId of new Set(missingPaneIds)) {
        cwdMap.delete(paneId);
        commandMap.delete(paneId);
      }
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
    // Clean up PTYs for deleted session
    cleanupSessionPtys(sessionId);
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
