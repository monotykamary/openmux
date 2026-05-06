import type { SessionMetadata } from '../../../effect/models';
import { getPtyMetadata } from '../../../effect/bridge/aggregate';
import type { PtyMetadata } from '../../../effect/bridge/aggregate';
import { listSessionsResult, loadSession } from '../../../effect/bridge/session-bridge';
import { AggregateBridgeError } from '../../../effect/errors';
import { clonePtyStdoutActivity } from '../../../core/shimmer';
import { getGlobalGitMetadataCache } from '../../git-metadata-cache';
import { getGitDiffStats, getGitInfo } from '../../../effect/services/pty/helpers';

import { applyGitMetadataSnapshot } from '../git';
import { ptyMetadataToInfo } from '../pty-info';
import {
  type CurrentSessionHints,
  type CurrentSessionPty,
  type PtyOwnership,
} from '../subscriptions';
import type { AggregateViewState, PtyInfo, SessionLoadState } from '../types';
import { dedupeAggregatePtysByPane, getAggregatePaneKey, getSavedAggregatePtyId } from '../rows';
import type { SuspendedPtyCache } from './suspended-pty-cache';
import {
  buildSessionPaneOrder,
  collectSessionPaneRecords,
  buildSavedPaneInfo,
  buildLivePaneFallback,
} from './pty-builders';

export interface SnapshotResult {
  sessions: SessionMetadata[];
  sessionLoadStates: Map<string, SessionLoadState>;
  sessionPaneOrders: Map<string, Map<string, number>>;
  ptys: PtyInfo[];
  /** Sessions actually loaded in this snapshot (not inferred from PTYs). */
  loadedSessionIds: Set<string>;
}

export interface BuildSnapshotDeps {
  state: AggregateViewState;
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionPtys?: () => CurrentSessionPty[];
  suspendedPtyCache: SuspendedPtyCache;
}

export function createBuildSnapshot(deps: BuildSnapshotDeps) {
  const {
    state,
    resolvePtyOwnership,
    getCurrentSessionHints,
    getCurrentSessionPaneOrder,
    getCurrentSessionPtys,
    suspendedPtyCache,
  } = deps;

  const gitCache = getGlobalGitMetadataCache({
    fetchGitInfo: (cwd) => getGitInfo(cwd, { force: false }),
    fetchDiffStats: getGitDiffStats,
  });

  return async (options: {
    forceGitRefresh: boolean;
    /** Only load the active session (skip non-active session disk reads and git). */
    activeSessionOnly?: boolean;
    /** Skip git metadata hydration entirely (apply empty git fields). */
    skipGitMetadata?: boolean;
  }): Promise<SnapshotResult | Error> => {
    try {
      const sessionsResult = await listSessionsResult();
      if (sessionsResult instanceof Error) {
        return sessionsResult;
      }
      const sessions = [...sessionsResult];
      const currentSessionHints = getCurrentSessionHints();
      const currentSessionPaneOrder = getCurrentSessionPaneOrder();
      const currentSessionPtys = (getCurrentSessionPtys?.() ?? []).filter(
        (pty) => !state.deletedPtyIds.has(pty.ptyId)
      );
      const hintedSessionId = currentSessionHints.sessionId;
      // currentSessionPtys come from the live in-memory layout. During cold-start
      // and session-switch races, a PTY may already have moved to another session
      // while the stamped sessionId (or the active-session hint) is still stale.
      // Prefer authoritative ownership resolution over the stamped/current hint.
      const currentSessionPtysBySession = new Map<string, CurrentSessionPty[]>();
      for (const pty of currentSessionPtys) {
        const ownership = resolvePtyOwnership(pty.ptyId);
        const ptySessionId = ownership?.sessionId ?? pty.sessionId ?? hintedSessionId;
        if (!ptySessionId) {
          continue;
        }

        const ownedPty: CurrentSessionPty = ownership
          ? {
              ...pty,
              sessionId: ownership.sessionId,
              paneId: ownership.paneId ?? pty.paneId,
              workspaceId: ownership.workspaceId ?? pty.workspaceId,
            }
          : {
              ...pty,
              sessionId: ptySessionId,
            };

        const existing = currentSessionPtysBySession.get(ptySessionId) ?? [];
        existing.push(ownedPty);
        currentSessionPtysBySession.set(ptySessionId, existing);
      }
      const currentLiveSessionIds = [...currentSessionPtysBySession.keys()];
      const effectiveCurrentSessionId =
        currentLiveSessionIds.length === 1 ? currentLiveSessionIds[0] : hintedSessionId;

      // When loading only the active session, defer non-active session disk reads.
      const sessionsToLoad = options.activeSessionOnly
        ? sessions.filter((s) => String(s.id) === effectiveCurrentSessionId)
        : sessions;
      const sessionDetailsEntries = await Promise.all(
        sessionsToLoad.map(
          async (session) => [String(session.id), await loadSession(String(session.id))] as const
        )
      );
      const sessionDetailsById = new Map(sessionDetailsEntries);

      const sessionLoadStates = new Map<string, SessionLoadState>();
      const sessionPaneOrders = new Map<string, Map<string, number>>();
      const provisionalPtys: PtyInfo[] = [];

      // Pre-load live metadata for non-active sessions in the background.
      // Suspended PTYs stay alive across session switches — we can fetch
      // their real foregroundProcess, shell, title, and cwd just like we
      // do for git metadata. Cache TTL prevents repeated fetches on
      // every keystroke.
      const nonActiveSessionIds = options.activeSessionOnly
        ? []
        : sessions
            .filter((s) => String(s.id) !== effectiveCurrentSessionId)
            .map((s) => String(s.id));

      const suspendedPtyPreloadPromise =
        nonActiveSessionIds.length > 0
          ? suspendedPtyCache.preloadSessions(nonActiveSessionIds)
          : Promise.resolve(
              new Map<
                string,
                Map<string, { ptyId: string; metadata: PtyMetadata; lastUpdated: number }>
              >()
            );

      const previousPanePtyByKey = new Map<string, PtyInfo>();
      for (const pty of dedupeAggregatePtysByPane(state.allPtys)) {
        const paneKey = getAggregatePaneKey(pty.sessionId, pty.paneId);
        if (!paneKey) {
          continue;
        }
        previousPanePtyByKey.set(paneKey, pty);
      }

      const currentLiveMetadataEntries = await Promise.all(
        currentSessionPtys.map(
          async (pty) =>
            [pty.ptyId, await getPtyMetadata(pty.ptyId, { skipGitDiffStats: true })] as const
        )
      );
      const currentLiveMetadata = new Map(currentLiveMetadataEntries);
      const existingCurrentSessionPtys = effectiveCurrentSessionId
        ? state.allPtys.filter((pty) => {
            if (pty.sessionId !== effectiveCurrentSessionId || pty.ptyId.startsWith('saved:')) {
              return false;
            }

            const ownership = resolvePtyOwnership(pty.ptyId);
            return !ownership || ownership.sessionId === effectiveCurrentSessionId;
          })
        : [];

      for (const session of sessions) {
        const sessionId = String(session.id);

        // When activeSessionOnly, mark non-active sessions as unloaded and skip.
        // They will be hydrated by the subsequent full refreshPtys() call.
        if (options.activeSessionOnly && sessionId !== effectiveCurrentSessionId) {
          sessionLoadStates.set(sessionId, {
            status: 'unloaded',
          });
          continue;
        }

        const sessionDetails = sessionDetailsById.get(sessionId);
        const loadedSession =
          sessionDetails && !(sessionDetails instanceof Error) ? sessionDetails : null;

        const currentLivePtysForSession = currentSessionPtysBySession.get(sessionId) ?? [];
        if (currentLivePtysForSession.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            (loadedSession ? buildSessionPaneOrder(loadedSession) : new Map<string, number>());
          // Ensure all live PTY pane IDs are in the pane order.
          // New panes that aren't in the layout yet get appended at the end.
          for (const livePty of currentLivePtysForSession) {
            if (livePty.paneId && !paneOrder.has(livePty.paneId)) {
              const maxOrder = [...paneOrder.values()].reduce((max, o) => Math.max(max, o), -1);
              paneOrder.set(livePty.paneId, maxOrder + 1);
            }
          }
          sessionPaneOrders.set(sessionId, paneOrder);

          for (const currentPty of currentLivePtysForSession) {
            const metadataResult = currentLiveMetadata.get(currentPty.ptyId);
            const existingPty = previousPanePtyByKey.get(
              getAggregatePaneKey(sessionId, currentPty.paneId) ?? ''
            );
            const nextPty =
              metadataResult && !(metadataResult instanceof Error) && metadataResult !== null
                ? ptyMetadataToInfo(
                    {
                      ...metadataResult,
                      sessionId,
                      sessionMetadata: session,
                      paneId: currentPty.paneId,
                      workspaceId: currentPty.workspaceId,
                      title: metadataResult.title ?? currentPty.title,
                    },
                    existingPty
                  )
                : buildLivePaneFallback({
                    sessionId,
                    sessionMetadata: session,
                    pty: currentPty,
                  });

            provisionalPtys.push(nextPty);
          }

          // Preserve existing live PTYs from allPtys that are NOT in the
          // live set. During a session switch, createPTY is fire-and-forget —
          // some panes may not have their ptyId yet when getCurrentSessionPtys()
          // runs. These "in-flight" PTYs were in the previous allPtys and would
          // be lost if we only use the live set. Including them prevents
          // "PTYs disappear, then reappear" during rapid session switches.
          const livePtyIds = new Set(currentLivePtysForSession.map((p) => p.ptyId));
          for (const existingPty of existingCurrentSessionPtys) {
            if (!livePtyIds.has(existingPty.ptyId)) {
              provisionalPtys.push({ ...existingPty, sessionId });
            }
          }

          sessionLoadStates.set(sessionId, {
            status: 'loaded',
            paneCount: currentLivePtysForSession.length,
            lastActiveWorkspaceId: currentSessionHints.lastActiveWorkspaceId,
            focusedPaneId: currentSessionHints.focusedPaneId,
          });
          continue;
        }

        if (sessionId === effectiveCurrentSessionId && existingCurrentSessionPtys.length > 0) {
          const paneOrder =
            currentSessionPaneOrder ??
            new Map(
              existingCurrentSessionPtys
                .filter((pty) => !!pty.paneId)
                .map((pty, index) => [pty.paneId as string, index] as const)
            );
          sessionPaneOrders.set(sessionId, paneOrder);
          provisionalPtys.push(
            ...existingCurrentSessionPtys.map((pty) => ({
              ...pty,
              // Stamp sessionId from the session being processed.
              // The filter ensures pty.sessionId === effectiveCurrentSessionId,
              // but explicit stamping prevents any stale sessionId from
              // propagating if the filter logic ever changes.
              sessionId,
            }))
          );
          sessionLoadStates.set(sessionId, {
            status: 'loaded',
            paneCount: existingCurrentSessionPtys.length,
            lastActiveWorkspaceId: currentSessionHints.lastActiveWorkspaceId,
            focusedPaneId: currentSessionHints.focusedPaneId,
          });
          continue;
        }

        if (sessionDetails instanceof Error) {
          sessionLoadStates.set(sessionId, {
            status: 'error',
            error: sessionDetails.message,
          });
          continue;
        }

        if (!loadedSession) {
          sessionLoadStates.set(sessionId, {
            status: 'error',
            error: 'Session data unavailable',
          });
          continue;
        }

        const paneOrder = buildSessionPaneOrder(loadedSession);
        sessionPaneOrders.set(sessionId, paneOrder);

        const paneRecords = collectSessionPaneRecords(loadedSession);
        for (const paneRecord of paneRecords) {
          const savedPtyId = getSavedAggregatePtyId(sessionId, paneRecord.paneId);
          const previousPanePty = previousPanePtyByKey.get(
            getAggregatePaneKey(sessionId, paneRecord.paneId) ?? ''
          );
          if (previousPanePty && previousPanePty.ptyId !== savedPtyId) {
            clonePtyStdoutActivity(previousPanePty.ptyId, savedPtyId);
          }

          provisionalPtys.push(
            buildSavedPaneInfo({
              sessionId,
              sessionMetadata: session,
              paneId: paneRecord.paneId,
              workspaceId: paneRecord.workspaceId,
              cwd: paneRecord.cwd,
              title: paneRecord.title,
              existing: previousPanePty,
            })
          );
        }

        const activeWorkspace = loadedSession.workspaces.find(
          (workspace) => workspace.id === loadedSession.activeWorkspaceId
        );
        sessionLoadStates.set(sessionId, {
          status: 'loaded',
          paneCount: paneRecords.length,
          lastActiveWorkspaceId: loadedSession.activeWorkspaceId,
          focusedPaneId: activeWorkspace?.focusedPaneId ?? undefined,
        });
      }

      // Apply suspended live metadata overlay to non-active sessions.
      // This runs after all provisionalPtys are built (active + non-active),
      // and overlays real PTY data where available, just like git metadata.
      const suspendedPtysBySession = await suspendedPtyPreloadPromise;
      if (suspendedPtysBySession.size > 0) {
        const ptyIdToSuspended = new Map<string, { metadata: PtyMetadata; paneId: string }>();
        for (const [sessionId, paneMap] of suspendedPtysBySession) {
          for (const [paneId, suspendedPty] of paneMap) {
            ptyIdToSuspended.set(suspendedPty.ptyId, {
              metadata: suspendedPty.metadata,
              paneId,
            });
            // Also index by (sessionId, paneId) for synthetic saved: entries
            ptyIdToSuspended.set(`${sessionId}\u0000${paneId}`, {
              metadata: suspendedPty.metadata,
              paneId,
            });
          }
        }

        for (let i = 0; i < provisionalPtys.length; i++) {
          const pty = provisionalPtys[i];
          if (pty.sessionId === effectiveCurrentSessionId) {
            continue; // active session already has live data
          }
          // Match by real ptyId (for entries that have one) or (sessionId,paneId)
          const key = ptyIdToSuspended.has(pty.ptyId)
            ? pty.ptyId
            : `${pty.sessionId}\u0000${pty.paneId}`;
          const suspended = ptyIdToSuspended.get(key);
          if (!suspended) continue;

          // Overlay live metadata, preferring live over disk snapshot
          provisionalPtys[i] = {
            ...pty,
            ptyId: suspended.metadata.ptyId,
            cwd: suspended.metadata.cwd || pty.cwd,
            foregroundProcess: suspended.metadata.foregroundProcess ?? pty.foregroundProcess,
            shell: suspended.metadata.shell ?? pty.shell,
            title: suspended.metadata.title ?? pty.title,
          };
        }
      }

      // Skip git metadata hydration when requested (fast initial load).
      // The subsequent full refreshPtys() will hydrate git data.
      let ptys: PtyInfo[];
      if (options.skipGitMetadata) {
        ptys = provisionalPtys;
      } else {
        const cwds = [...new Set(provisionalPtys.map((pty) => pty.cwd).filter(Boolean))];
        const gitMetadataMap = await gitCache.getMetadataBatch(cwds, {
          forceRefresh: options.forceGitRefresh,
        });
        ptys = provisionalPtys.map((pty) =>
          applyGitMetadataSnapshot(pty, gitMetadataMap.get(pty.cwd))
        );
      }

      // Track which sessions were actually loaded in this snapshot.
      // In activeSessionOnly mode, only the effective current session
      // was loaded — even if some PTYs have a different sessionId due
      // to ownership resolution. This is critical for the merge mode
      // in applySnapshot, which uses loadedSessionIds to decide which
      // sessions' data to replace.
      const loadedSessionIds = options.activeSessionOnly
        ? new Set<string>(effectiveCurrentSessionId ? [effectiveCurrentSessionId] : [])
        : new Set<string>(sessions.map((s) => String(s.id)));

      return {
        sessions,
        sessionLoadStates,
        sessionPaneOrders,
        ptys,
        loadedSessionIds,
      };
    } catch (error) {
      return error instanceof AggregateBridgeError
        ? error
        : new AggregateBridgeError({
            operation: 'aggregate snapshot refresh',
            target: 'aggregate-view',
            reason: String(error),
            cause: error instanceof Error ? error : undefined,
          });
    }
  };
}
