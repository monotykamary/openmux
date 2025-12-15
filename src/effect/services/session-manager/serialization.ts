/**
 * Serialization helpers for SessionManager
 */

import { Effect } from "effect"
import type { WorkspaceState } from "./types"
import {
  SerializedSession,
  SerializedWorkspace,
  SerializedPaneData,
  SessionMetadata,
} from "../../models"
import { WorkspaceId } from "../../types"

/**
 * Extract auto-name from path (last directory component)
 */
export function getAutoName(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? "untitled"
}

/**
 * Check if session name should be auto-updated based on cwd
 */
export function shouldUpdateAutoName(
  session: SessionMetadata,
  newName: string
): boolean {
  return session.autoNamed && newName !== session.name
}

/**
 * Collect all CWDs from workspaces
 * Returns a map of ptyId -> cwd
 */
export function collectCwdMap(
  workspaces: ReadonlyMap<number, WorkspaceState>,
  getCwd: (ptyId: string) => Promise<string>
): Effect.Effect<Map<string, string>, never> {
  return Effect.gen(function* () {
    const cwdMap = new Map<string, string>()

    for (const workspace of workspaces.values()) {
      const mainPane = workspace.mainPane
      if (mainPane?.ptyId) {
        const ptyId = mainPane.ptyId
        const cwd = yield* Effect.promise(() =>
          getCwd(ptyId).catch(() => process.cwd())
        )
        cwdMap.set(ptyId, cwd)
      }
      for (const pane of workspace.stackPanes) {
        if (pane.ptyId) {
          const ptyId = pane.ptyId
          const cwd = yield* Effect.promise(() =>
            getCwd(ptyId).catch(() => process.cwd())
          )
          cwdMap.set(ptyId, cwd)
        }
      }
    }

    return cwdMap
  })
}

/**
 * Serialize a single workspace to SerializedWorkspace format
 */
export function serializeWorkspace(
  id: number,
  workspace: WorkspaceState,
  cwdMap: Map<string, string>
): SerializedWorkspace | null {
  // Only serialize workspaces with panes
  if (!workspace.mainPane && workspace.stackPanes.length === 0) {
    return null
  }

  const mainPane = workspace.mainPane
    ? SerializedPaneData.make({
        id: workspace.mainPane.id,
        title: workspace.mainPane.title,
        cwd: workspace.mainPane.ptyId
          ? cwdMap.get(workspace.mainPane.ptyId) ?? process.cwd()
          : process.cwd(),
      })
    : null

  const stackPanes = workspace.stackPanes.map((pane) =>
    SerializedPaneData.make({
      id: pane.id,
      title: pane.title,
      cwd: pane.ptyId
        ? cwdMap.get(pane.ptyId) ?? process.cwd()
        : process.cwd(),
    })
  )

  return SerializedWorkspace.make({
    id: WorkspaceId.make(id),
    mainPane,
    stackPanes,
    focusedPaneId: workspace.focusedPaneId ?? null,
    layoutMode: workspace.layoutMode,
    activeStackIndex: workspace.activeStackIndex,
    zoomed: workspace.zoomed,
  })
}

/**
 * Serialize all workspaces to a SerializedSession
 */
export function serializeSession(
  metadata: SessionMetadata,
  workspaces: ReadonlyMap<number, WorkspaceState>,
  activeWorkspaceId: number,
  cwdMap: Map<string, string>
): SerializedSession {
  const serializedWorkspaces: SerializedWorkspace[] = []

  for (const [id, workspace] of workspaces) {
    const serialized = serializeWorkspace(id, workspace, cwdMap)
    if (serialized) {
      serializedWorkspaces.push(serialized)
    }
  }

  return SerializedSession.make({
    metadata,
    workspaces: serializedWorkspaces,
    activeWorkspaceId: WorkspaceId.make(activeWorkspaceId),
  })
}
