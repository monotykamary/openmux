import { describe, expect, it } from "vitest"

import type { Workspace, WorkspaceId } from "../../../src/core/types"
import type { Workspaces } from "../../../src/core/operations/layout-actions"
import { resolveActiveWorkspaceId } from "../../../src/effect/bridge/session-bridge-utils"

const createWorkspace = (
  id: WorkspaceId,
  options: { main?: boolean; stack?: boolean } = {}
): Workspace => {
  const hasMain = options.main ?? false
  const hasStack = options.stack ?? false
  const mainId = `pane-${id}`
  const stackId = `stack-pane-${id}`

  return {
    id,
    mainPane: hasMain ? { id: mainId } : null,
    stackPanes: hasStack ? [{ id: stackId }] : [],
    focusedPaneId: hasMain ? mainId : hasStack ? stackId : null,
    activeStackIndex: 0,
    layoutMode: "vertical",
    zoomed: false,
  }
}

describe("resolveActiveWorkspaceId", () => {
  it("keeps the stored active workspace when it has panes", () => {
    const workspaces: Workspaces = {
      1: createWorkspace(1, { main: true }),
      2: createWorkspace(2),
    }

    expect(resolveActiveWorkspaceId(workspaces, 1)).toBe(1)
  })

  it("falls back to the first populated workspace when the active one is empty", () => {
    const workspaces: Workspaces = {
      1: createWorkspace(1),
      2: createWorkspace(2, { stack: true }),
      3: createWorkspace(3, { main: true }),
    }

    expect(resolveActiveWorkspaceId(workspaces, 1)).toBe(2)
  })

  it("returns the stored active ID when no workspaces are populated", () => {
    const workspaces: Workspaces = {
      1: createWorkspace(1),
      2: createWorkspace(2),
    }

    expect(resolveActiveWorkspaceId(workspaces, 3)).toBe(3)
  })
})
