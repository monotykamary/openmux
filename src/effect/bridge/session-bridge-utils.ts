import type { WorkspaceId } from "../../core/types"
import type { Workspaces } from "../../core/operations/layout-actions"

export function resolveActiveWorkspaceId(
  workspaces: Workspaces,
  storedActiveId: WorkspaceId
): WorkspaceId {
  const workspaceIds = Object.entries(workspaces)
    .filter(([, ws]) => ws && (ws.mainPane || ws.stackPanes.length > 0))
    .map(([id]) => Number(id) as WorkspaceId)
    .sort((a, b) => a - b)

  if (workspaceIds.length === 0) {
    return storedActiveId
  }

  return workspaceIds.includes(storedActiveId)
    ? storedActiveId
    : (workspaceIds[0] as WorkspaceId)
}
