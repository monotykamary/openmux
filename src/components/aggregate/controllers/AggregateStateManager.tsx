/**
 * AggregateStateManager - Handles session loading, pane creation, and auto-focus effects.
 *
 * Reads state directly from contexts instead of receiving individual props.
 * This component must be rendered inside the AggregateViewContext provider tree.
 */

import { createEffect, onCleanup, createSignal } from 'solid-js';
import { loadSessionData } from '../../../effect/bridge';
import { getFocusedPtyId } from '../../../core/workspace-utils';
import { useConfig } from '../../../contexts/ConfigContext';
import { buildEditorCommand } from '../../../core/file-opener';
import { type DiffTarget } from '../../../core/diff-opener';
import { useLayout } from '../../../contexts/LayoutContext';
import { useSession } from '../../../contexts/SessionContext';
import { useTerminal } from '../../../contexts/TerminalContext';
import { useKeyboard } from '../../../contexts/KeyboardContext';
import { useCopyMode } from '../../../contexts/copy-mode';
import { useAggregateView } from '../../../contexts/AggregateViewContext';
import { collectPanes } from '../../../core/layout-tree';
import type { Workspace, WorkspaceId } from '../../../core/types';
import type { PendingPaneCreation } from '../../../contexts/aggregate-view-types';
import type { PendingAggregatePaneFocus } from '../pending-pane-focus';
import { getNextPendingPaneCreationOrder } from '../../../contexts/aggregate-view-pending-insertions';
import { resolvePendingAggregatePaneFocus } from '../pending-pane-focus';
import { findPtyLocation, findPaneLocation } from '../utils';

/**
 * Controller component that manages all async state effects for AggregateView.
 * Reads from contexts directly — no prop drilling.
 * Returns an object with methods that can be passed to keyboard controller.
 */
export function AggregateStateManager() {
  const aggregate = useAggregateView();
  const layout = useLayout();
  const session = useSession();
  const config = useConfig();
  const terminal = useTerminal();
  const keyboard = useKeyboard();
  const copyMode = useCopyMode();

  // Derived getters from aggregate context
  const isActive = () => aggregate.state.showAggregateView;
  const selectedPtyId = () => aggregate.state.selectedPtyId;
  const selectedSessionId = () => aggregate.state.selectedSessionId;
  const previewMode = () => aggregate.state.previewMode;
  const selectedIndex = () => aggregate.state.selectedIndex;
  const flattenedTree = () => aggregate.state.flattenedTree;
  const expandedSessionIds = () => aggregate.state.expandedSessionIds;
  const pendingPaneCreations = () => aggregate.state.pendingPaneCreations;

  const { state: layoutState, switchWorkspace, focusPane, setLayoutMode } = layout;
  const { state: sessionState, switchSession } = session;
  const { findSessionForPty, getSessionCwd, createPaneWithPTY, writeToPTY } = terminal;
  const { state: keyboardState, enterAggregateMode } = keyboard;

  // Local pending focus signal (managed internally)
  const [pendingPaneFocus, setPendingPaneFocus] = createSignal<PendingAggregatePaneFocus | null>(
    null
  );

  // Copy mode tracking
  const [aggregateCopyModeActive, setAggregateCopyModeActive] = createSignal(false);

  // Helpers
  const getLastPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;

    const paneIds: string[] = [];
    if (workspace.mainPane) {
      for (const pane of collectPanes(workspace.mainPane)) {
        paneIds.push(pane.id);
      }
    }
    for (const stackPane of workspace.stackPanes) {
      for (const pane of collectPanes(stackPane)) {
        paneIds.push(pane.id);
      }
    }

    return paneIds[paneIds.length - 1] ?? workspace.focusedPaneId ?? null;
  };

  const getPreferredPaneIdForWorkspace = (workspace: Workspace | undefined): string | null => {
    if (!workspace) return null;
    return workspace.focusedPaneId ?? getLastPaneIdForWorkspace(workspace);
  };

  const toWorkspaceId = (workspaceId: number | undefined): WorkspaceId | undefined => {
    if (
      workspaceId === 1 ||
      workspaceId === 2 ||
      workspaceId === 3 ||
      workspaceId === 4 ||
      workspaceId === 5 ||
      workspaceId === 6 ||
      workspaceId === 7 ||
      workspaceId === 8 ||
      workspaceId === 9
    ) {
      return workspaceId;
    }
    return undefined;
  };

  const switchToSessionWithData = async (
    sessionId: string,
    preloadedData?: Awaited<ReturnType<typeof loadSessionData>>,
    target?: { workspaceId?: WorkspaceId; paneId?: string }
  ): Promise<boolean> => {
    if (preloadedData instanceof Error) {
      console.error('Failed to load session:', preloadedData.message);
      return false;
    }

    const adjustedPreloadedData =
      preloadedData && !(preloadedData instanceof Error) && target?.workspaceId
        ? (() => {
            const workspace = preloadedData.workspaces[target.workspaceId];
            return {
              ...preloadedData,
              activeWorkspaceId: target.workspaceId,
              workspaces: {
                ...preloadedData.workspaces,
                [target.workspaceId]: workspace
                  ? {
                      ...workspace,
                      focusedPaneId: target.paneId ?? workspace.focusedPaneId,
                    }
                  : workspace,
              },
            };
          })()
        : preloadedData;

    await switchSession(
      sessionId,
      adjustedPreloadedData ? { preloadedData: adjustedPreloadedData } : undefined
    );
    return true;
  };

  // Copy mode tracking effects
  createEffect(() => {
    if (
      isActive() &&
      previewMode() &&
      keyboardState.mode === 'copy' &&
      selectedPtyId() &&
      copyMode.isActive(selectedPtyId()!)
    ) {
      setAggregateCopyModeActive(true);
    }
  });

  createEffect(() => {
    if (!aggregateCopyModeActive()) return;

    const activeCopyPtyId = copyMode.getActivePtyId();
    const shouldKeepCopyMode =
      isActive() && previewMode() && !!activeCopyPtyId && activeCopyPtyId === selectedPtyId();

    if (shouldKeepCopyMode) return;

    // Exit copy mode
    copyMode.exitCopyMode();
    setAggregateCopyModeActive(false);
    if (keyboardState.mode === 'copy') {
      keyboard.exitCopyMode();
      if (isActive()) {
        enterAggregateMode();
      }
    }
  });

  // Resolve pending pane focus (for newly created panes)
  createEffect(() => {
    if (!isActive()) {
      setPendingPaneFocus(null);
      aggregate.clearPendingPaneCreations();
      return;
    }

    const resolution = resolvePendingAggregatePaneFocus({
      pending: pendingPaneFocus(),
      allPtys: aggregate.state.allPtys,
      flattenedTreeIndex: aggregate.state.flattenedTreeIndex,
      expandedSessionIds: expandedSessionIds(),
    });

    if (resolution.type === 'wait') return;

    if (resolution.type === 'expand-session') {
      aggregate.toggleSessionExpanded(resolution.sessionId);
      return;
    }

    aggregate.selectPty(resolution.ptyId);
    setPendingPaneFocus(null);

    // Clean up any pending pane creations that are now resolved.
    // When handlePtyCreated fires before onCreated sets pendingPtyId
    // (and there are multiple unclaimed insertions), the lifecycle
    // handler can't match the insertion and leaves it orphaned.
    // Now that the real PTY is selected and visible in the tree,
    // remove any pending creation whose PTY has landed in allPtys.
    //
    // CRITICAL: Use allPtysIndex (not flattenedTreeIndex) to confirm
    // the real PTY has landed. flattenedTreeIndex includes placeholders
    // from buildPendingAggregatePtys that share the same ptyId, so
    // checking it would match a placeholder and remove the pending
    // creation before the real PTY is in allPtys, causing the row
    // to disappear.
    const resolvedPtyId = resolution.ptyId;
    const allPtysIndex = aggregate.state.allPtysIndex;
    const treeIndex = aggregate.state.flattenedTreeIndex;
    if (resolvedPtyId && treeIndex.has(resolvedPtyId)) {
      const pendingCreations = aggregate.state.pendingPaneCreations;
      const orphaned = pendingCreations.filter(
        (insertion) => insertion.pendingPtyId !== null && allPtysIndex.has(insertion.pendingPtyId)
      );
      for (const insertion of orphaned) {
        aggregate.removePendingPaneCreation(insertion.id);
      }
    }
  });

  // AUTO-SELECT: When the aggregate view is open in preview mode with no PTY selected,
  // automatically select the first available PTY as soon as PTYs load.
  // Prefer the PTY the user was focused on before opening the aggregate view.
  createEffect(() => {
    if (!isActive()) return;
    if (!previewMode()) return;
    if (selectedPtyId()) return;

    const tree = flattenedTree();

    // Try the focused PTY first (the one the user was working on)
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace) ?? null;
    if (focusedPtyId) {
      const focusedIndex = tree.findIndex(
        (item) => item.node.type === 'pty' && item.node.ptyInfo.ptyId === focusedPtyId
      );
      if (focusedIndex >= 0) {
        aggregate.setSelectedIndex(focusedIndex);
        return;
      }
    }

    // Fallback: first PTY in the tree
    const firstPtyIndex = tree.findIndex((item) => item.node.type === 'pty');
    if (firstPtyIndex < 0) return;

    aggregate.setSelectedIndex(firstPtyIndex);
  });

  // FOCUS-ON-SELECT: When the user selects a PTY in aggregate view (click or
  // keyboard navigation), focus the corresponding pane in the layout.
  // This is critical for lazy PTY creation: usePtyCreation only creates PTYs
  // for the focused pane when aggregate view is open, so focusing the selected
  // pane triggers its PTY creation immediately.
  // Uses aggregate view's allPtys data for lookup (not findSessionForPty)
  // because findSessionForPty returns null for PTYs that haven't been
  // created yet (no ptyToSessionMap entry).
  createEffect(() => {
    if (!isActive()) return;
    if (!previewMode()) return;
    if (sessionState.switching) return;

    const ptyId = selectedPtyId();
    if (!ptyId) return;

    // Look up pane info from aggregate view's data (populated by refreshPtys)
    const ptyIndex = aggregate.state.allPtysIndex.get(ptyId);
    if (ptyIndex === undefined) return;
    const ptyInfo = aggregate.state.allPtys[ptyIndex];
    if (!ptyInfo?.paneId) return;

    // Only focus for same-session selections — cross-session is handled by AUTOSWITCH
    if (ptyInfo.sessionId !== sessionState.activeSessionId) return;

    // Only focus if the pane doesn't already have focus
    const ws = layoutState.workspaces[layoutState.activeWorkspaceId];
    if (ws && ws.focusedPaneId === ptyInfo.paneId) return;

    focusPane(ptyInfo.paneId);
  });

  // PTY MRU DEBOUNCE: When the selected PTY changes (via picker, sidebar click,
  // or j/k navigation), push it to the MRU stack after the user settles.
  // This prevents rapid j/k flips from flooding the MRU — only the PTY the
  // user "sticks with" gets registered.
  let mruDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const MRU_SETTLE_MS = 500;

  createEffect(() => {
    if (!isActive()) return;
    if (!previewMode()) return;

    const ptyId = selectedPtyId();
    if (!ptyId) return;

    // Track that this effect read selectedPtyId so it re-runs on changes
    void ptyId;

    // Clear any pending debounce from a previous selection
    if (mruDebounceTimer !== null) {
      clearTimeout(mruDebounceTimer);
    }

    mruDebounceTimer = setTimeout(() => {
      mruDebounceTimer = null;
      // Only push if the selection is still the same after the settle period
      if (selectedPtyId() === ptyId) {
        aggregate.pushPtyMru(ptyId);
      }
    }, MRU_SETTLE_MS);
  });

  onCleanup(() => {
    if (mruDebounceTimer !== null) {
      clearTimeout(mruDebounceTimer);
      mruDebounceTimer = null;
    }
  });

  // AUTOSWITCH: Automatically switch sessions when navigating to a pane from a different session.
  // Only fires when previewMode is true — this distinguishes intentional PTY selection
  // (user clicked or navigated to a PTY) from incidental index shifts caused by
  // recomputeTree (e.g. after showing/hiding session groups).
  createEffect(() => {
    if (!isActive()) return;
    if (!previewMode()) return;
    if (sessionState.switching) return;
    if (pendingPaneCreations().length > 0) return;
    if (pendingPaneFocus()) return;

    const selectedItem = flattenedTree()[selectedIndex()];
    if (selectedItem?.node.type !== 'pty') return;

    const itemSessionId = selectedItem.node.ptyInfo.sessionId;
    if (!itemSessionId) return;
    if (itemSessionId === sessionState.activeSessionId) return;

    const targetWorkspaceId = toWorkspaceId(selectedItem.node.ptyInfo.workspaceId);
    const targetPaneId = selectedItem.node.ptyInfo.paneId;

    let cancelled = false;

    void (async () => {
      const sessionData = await loadSessionData(itemSessionId);
      if (cancelled) return;
      await switchToSessionWithData(itemSessionId, sessionData, {
        workspaceId: targetWorkspaceId,
        paneId: targetPaneId ?? undefined,
      });
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  // Cleanup
  onCleanup(() => {
    setPendingPaneFocus(null);
    aggregate.clearPendingPaneCreations();
  });

  // Public API for jump to PTY (Tab key)
  const handleJumpToPty = async (): Promise<boolean> => {
    const currentPtyId = selectedPtyId();
    const currentSessionId = selectedSessionId();

    if (currentPtyId) {
      const location = findPtyLocation(currentPtyId, layoutState.workspaces);
      if (location) {
        aggregate.closeAggregateView();
        keyboard.exitAggregateMode();
        if (layoutState.activeWorkspaceId !== location.workspaceId) {
          switchWorkspace(location.workspaceId);
        }
        focusPane(location.paneId);
        return true;
      }

      const sessionLocation = findSessionForPty(currentPtyId);
      if (sessionLocation && sessionLocation.sessionId !== sessionState.activeSessionId) {
        const sessionData = await loadSessionData(sessionLocation.sessionId);
        if (sessionData instanceof Error) {
          console.error('Failed to load session:', sessionData.message);
          return false;
        }

        const nextLocation = findPaneLocation(sessionLocation.paneId, sessionData.workspaces);

        aggregate.closeAggregateView();
        keyboard.exitAggregateMode();
        const switched = await switchToSessionWithData(sessionLocation.sessionId, sessionData);
        if (!switched) {
          return false;
        }
        if (nextLocation) {
          switchWorkspace(nextLocation.workspaceId);
          focusPane(sessionLocation.paneId);
          return true;
        }
        const fallbackPaneId = getPreferredPaneIdForWorkspace(
          sessionData.workspaces[sessionData.activeWorkspaceId]
        );
        if (fallbackPaneId) {
          switchWorkspace(sessionData.activeWorkspaceId);
          focusPane(fallbackPaneId);
        }
        return true;
      }
    }

    if (!currentSessionId) return false;

    if (currentSessionId === sessionState.activeSessionId) {
      const workspaceId = layoutState.activeWorkspaceId;
      const paneId = getPreferredPaneIdForWorkspace(layoutState.workspaces[workspaceId]);
      aggregate.closeAggregateView();
      keyboard.exitAggregateMode();
      if (paneId) {
        switchWorkspace(workspaceId);
        focusPane(paneId);
      }
      return true;
    }

    // Load session and jump to it
    const sessionData = await loadSessionData(currentSessionId);
    if (sessionData instanceof Error) {
      console.error('Failed to load session:', sessionData.message);
      return false;
    }

    const workspaceId = sessionData.activeWorkspaceId;
    const paneId = getPreferredPaneIdForWorkspace(sessionData.workspaces[workspaceId]);

    aggregate.closeAggregateView();
    keyboard.exitAggregateMode();
    const switched = await switchToSessionWithData(currentSessionId, sessionData);
    if (!switched) {
      return false;
    }
    switchWorkspace(workspaceId);
    if (paneId) {
      focusPane(paneId);
    }
    return true;
  };

  // Public API for new pane in session (option+n / alt+n)
  const handleNewPaneInSession = async (): Promise<void> => {
    const currentSessionId = selectedSessionId();
    const currentPtyId = selectedPtyId();

    if (!currentSessionId && !currentPtyId) return;

    const selectedPty = currentPtyId
      ? (aggregate.state.allPtys[aggregate.state.allPtysIndex.get(currentPtyId) ?? -1] ?? null)
      : null;

    const targetSessionId =
      currentSessionId ??
      findSessionForPty(currentPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    const pendingInsertionId = crypto.randomUUID();
    const pendingInsertion: PendingPaneCreation = {
      id: pendingInsertionId,
      sessionId: targetSessionId,
      insertAfterPtyId: currentPtyId,
      insertAfterPaneId: selectedPty?.paneId ?? null,
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: getNextPendingPaneCreationOrder(
        {
          allPtys: aggregate.state.allPtys,
          sessionPaneOrderIndex: aggregate.state.sessionPaneOrderIndex,
          pendingPaneCreations: aggregate.state.pendingPaneCreations,
        },
        {
          sessionId: targetSessionId,
          insertAfterPaneId: selectedPty?.paneId ?? null,
        }
      ),
    };
    aggregate.upsertPendingPaneCreation(pendingInsertion);

    // NOTE: do NOT set pendingPaneFocus(null) here. Rapid sequential
    // creations would wipe a previous creation's unresolved focus,
    // breaking autoswitch. The new focus is set below after
    // createPaneWithPTY resolves, which overwrites any stale one.

    let targetWorkspaceId = layoutState.activeWorkspaceId;
    let targetCwd: string | undefined;

    // Get CWD from selected PTY if available
    if (currentPtyId) {
      targetCwd = await getSessionCwd(currentPtyId).catch((e) => {
        console.warn(
          `[AggregateStateManager] Failed to get CWD for selected PTY ${currentPtyId}:`,
          e
        );
        return undefined;
      });
    }

    if (targetSessionId === sessionState.activeSessionId) {
      // Current session
      if (!targetCwd) {
        const workspace = layoutState.workspaces[layoutState.activeWorkspaceId];
        if (workspace) {
          const livePanes: Array<{ id: string; ptyId?: string }> = [];
          if (workspace.mainPane) {
            livePanes.push(...collectPanes(workspace.mainPane));
          }
          for (const stackPane of workspace.stackPanes) {
            livePanes.push(...collectPanes(stackPane));
          }
          const candidatePane =
            livePanes.find((p) => p.id === workspace.focusedPaneId && !!p.ptyId) ??
            [...livePanes].reverse().find((p) => !!p.ptyId) ??
            null;
          if (candidatePane?.ptyId) {
            targetCwd = await getSessionCwd(candidatePane.ptyId).catch((e) => {
              console.warn(
                `[AggregateStateManager] Failed to get CWD for candidate PTY ${candidatePane.ptyId}:`,
                e
              );
              return undefined;
            });
          }
        }
      }

      if (currentPtyId) {
        const location = findPtyLocation(currentPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      // Other session - load and switch
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        console.error('Failed to load session:', sessionData.message);
        return;
      }

      targetWorkspaceId = sessionData.activeWorkspaceId;
      if (!targetCwd) {
        const activeWorkspace = sessionData.workspaces[sessionData.activeWorkspaceId];
        const lastPaneId = getLastPaneIdForWorkspace(activeWorkspace);
        if (lastPaneId) {
          targetCwd = sessionData.cwdMap.get(lastPaneId);
        }
      }

      const switched = await switchToSessionWithData(targetSessionId, sessionData);
      if (!switched) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        return;
      }
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const createdPane = await createPaneWithPTY(
      targetCwd,
      'shell',
      {
        onCreated: (created) => {
          aggregate.upsertPendingPaneCreation({
            ...pendingInsertion,
            pendingPtyId: created.ptyId,
            pendingPaneId: created.paneId,
          });
        },
      },
      targetSessionId
    );
    if (!createdPane) {
      aggregate.removePendingPaneCreation(pendingInsertionId);
      console.error('Failed to create pane in aggregate view');
      return;
    }

    aggregate.upsertPendingPaneCreation({
      ...pendingInsertion,
      pendingPtyId: createdPane.ptyId,
      pendingPaneId: createdPane.paneId,
    });

    setPendingPaneFocus({ sessionId: targetSessionId, paneId: createdPane.paneId });
  };

  // Send the editor command to a newly created PTY
  const writeToEditor = (ptyId: string, filePath: string) => {
    const settings = config.config().fileOpener;
    const { args: commandParts, autoExit } = buildEditorCommand(settings, filePath);
    const fullCommand = `${settings.editor} ${commandParts.join(' ')}${autoExit ? '; exit' : ''}`;
    writeToPTY(ptyId, `${fullCommand}\n`);
  };

  // Open a file in the selected PTY's session, creating a new pane with the editor.
  // Follows the same autoswitch pattern as handleNewPaneInSession.
  const handleOpenFileInSession = async (entry: {
    absolutePath: string;
    isFolderAction: boolean;
    rootDir?: string;
  }): Promise<void> => {
    if (entry.isFolderAction) return;

    const currentSessionId = selectedSessionId();
    const currentPtyId = selectedPtyId();

    if (!currentSessionId && !currentPtyId) return;

    const selectedPty = currentPtyId
      ? (aggregate.state.allPtys[aggregate.state.allPtysIndex.get(currentPtyId) ?? -1] ?? null)
      : null;

    const targetSessionId =
      currentSessionId ??
      findSessionForPty(currentPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    const pendingInsertionId = crypto.randomUUID();
    const pendingInsertion: PendingPaneCreation = {
      id: pendingInsertionId,
      sessionId: targetSessionId,
      insertAfterPtyId: currentPtyId,
      insertAfterPaneId: selectedPty?.paneId ?? null,
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: getNextPendingPaneCreationOrder(
        {
          allPtys: aggregate.state.allPtys,
          sessionPaneOrderIndex: aggregate.state.sessionPaneOrderIndex,
          pendingPaneCreations: aggregate.state.pendingPaneCreations,
        },
        {
          sessionId: targetSessionId,
          insertAfterPaneId: selectedPty?.paneId ?? null,
        }
      ),
    };
    aggregate.upsertPendingPaneCreation(pendingInsertion);

    let targetWorkspaceId = layoutState.activeWorkspaceId;
    // Use the rootDir (where the file opener was invoked) as CWD,
    // not the directory containing the file
    const targetCwd = entry.rootDir || process.cwd();

    if (targetSessionId === sessionState.activeSessionId) {
      if (currentPtyId) {
        const location = findPtyLocation(currentPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        console.error('Failed to load session:', sessionData.message);
        return;
      }
      targetWorkspaceId = sessionData.activeWorkspaceId;

      const switched = await switchToSessionWithData(targetSessionId, sessionData);
      if (!switched) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        return;
      }
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const createdPane = await createPaneWithPTY(
      targetCwd,
      'shell',
      {
        onCreated: (created) => {
          aggregate.upsertPendingPaneCreation({
            ...pendingInsertion,
            pendingPtyId: created.ptyId,
            pendingPaneId: created.paneId,
          });
        },
      },
      targetSessionId
    );
    if (!createdPane) {
      aggregate.removePendingPaneCreation(pendingInsertionId);
      console.error('Failed to create pane in aggregate view');
      return;
    }

    aggregate.upsertPendingPaneCreation({
      ...pendingInsertion,
      pendingPtyId: createdPane.ptyId,
      pendingPaneId: createdPane.paneId,
    });

    setPendingPaneFocus({ sessionId: targetSessionId, paneId: createdPane.paneId });

    // Send the editor command to the new PTY
    writeToEditor(createdPane.ptyId, entry.absolutePath);
  };

  // Open a diff view in the selected PTY's session, creating a new pane.
  // Follows the same autoswitch pattern as handleNewPaneInSession.
  const handleOpenDiffInSession = async (
    target: DiffTarget,
    rootDir: string,
    fullCommand: string
  ): Promise<void> => {
    if (target.isSeparator) return;

    const currentSessionId = selectedSessionId();
    const currentPtyId = selectedPtyId();

    if (!currentSessionId && !currentPtyId) return;

    const selectedPty = currentPtyId
      ? (aggregate.state.allPtys[aggregate.state.allPtysIndex.get(currentPtyId) ?? -1] ?? null)
      : null;

    const targetSessionId =
      currentSessionId ??
      findSessionForPty(currentPtyId!)?.sessionId ??
      sessionState.activeSessionId;
    if (!targetSessionId) return;

    const pendingInsertionId = crypto.randomUUID();
    const pendingInsertion: PendingPaneCreation = {
      id: pendingInsertionId,
      sessionId: targetSessionId,
      insertAfterPtyId: currentPtyId,
      insertAfterPaneId: selectedPty?.paneId ?? null,
      pendingPtyId: null,
      pendingPaneId: null,
      sortOrderHint: getNextPendingPaneCreationOrder(
        {
          allPtys: aggregate.state.allPtys,
          sessionPaneOrderIndex: aggregate.state.sessionPaneOrderIndex,
          pendingPaneCreations: aggregate.state.pendingPaneCreations,
        },
        {
          sessionId: targetSessionId,
          insertAfterPaneId: selectedPty?.paneId ?? null,
        }
      ),
    };
    aggregate.upsertPendingPaneCreation(pendingInsertion);

    const targetCwd = rootDir || process.cwd();
    let targetWorkspaceId = layoutState.activeWorkspaceId;

    if (targetSessionId === sessionState.activeSessionId) {
      if (currentPtyId) {
        const location = findPtyLocation(currentPtyId, layoutState.workspaces);
        if (location) {
          targetWorkspaceId = location.workspaceId;
        }
      }
    } else {
      const sessionData = await loadSessionData(targetSessionId);
      if (sessionData instanceof Error) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        console.error('Failed to load session:', sessionData.message);
        return;
      }
      targetWorkspaceId = sessionData.activeWorkspaceId;

      const switched = await switchToSessionWithData(targetSessionId, sessionData);
      if (!switched) {
        aggregate.removePendingPaneCreation(pendingInsertionId);
        return;
      }
    }

    switchWorkspace(targetWorkspaceId);
    setLayoutMode('stacked');
    const createdPane = await createPaneWithPTY(
      targetCwd,
      'shell',
      {
        onCreated: (created) => {
          aggregate.upsertPendingPaneCreation({
            ...pendingInsertion,
            pendingPtyId: created.ptyId,
            pendingPaneId: created.paneId,
          });
        },
      },
      targetSessionId
    );

    if (!createdPane) {
      aggregate.removePendingPaneCreation(pendingInsertionId);
      return;
    }

    aggregate.upsertPendingPaneCreation({
      ...pendingInsertion,
      pendingPtyId: createdPane.ptyId,
      pendingPaneId: createdPane.paneId,
    });

    setPendingPaneFocus({ sessionId: targetSessionId, paneId: createdPane.paneId });

    // Send the diff command to the new PTY
    writeToPTY(createdPane.ptyId, `${fullCommand}\n`);
  };

  // Return public API for use by other controllers
  return {
    handleJumpToPty,
    handleNewPaneInSession,
    handleOpenFileInSession,
    handleOpenDiffInSession,
    pendingPaneFocus,
    setPendingPaneFocus,
    aggregateCopyModeActive,
    setAggregateCopyModeActive,
  };
}
