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
    sessionId: string
  ) => {
    // Try to resume PTYs for this session (if we've visited it before)
    const restoredPtys = await resumeSession(sessionId);

    // If we have restored PTYs, assign them to the panes
    if (restoredPtys && restoredPtys.size > 0) {
      for (const workspace of Object.values(workspaces)) {
        if (!workspace) continue;
        if (workspace.mainPane) {
          const ptyId = restoredPtys.get(workspace.mainPane.id);
          if (ptyId) {
            workspace.mainPane.ptyId = ptyId;
          }
        }
        for (const pane of workspace.stackPanes) {
          const ptyId = restoredPtys.get(pane.id);
          if (ptyId) {
            pane.ptyId = ptyId;
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
    loadSession({ workspaces, activeWorkspaceId });
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    destroyAllPTYs();
    clearPtyTracking();
    clearSessionCwdMap();
    clearSessionCommandMap();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return (
    <SessionProvider
      getCwd={getCwd}
      getForegroundProcess={getForegroundProcess}
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
