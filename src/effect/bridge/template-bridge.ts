/**
 * Template bridge functions
 * Wraps Effect TemplateStorage service for async/await usage
 */

import { Effect } from "effect"
import { runEffect } from "../runtime"
import { TemplateStorage } from "../services"
import type { TemplateSession, TemplateWorkspace, TemplatePaneData } from "../models"
import type { Workspaces } from "../../core/operations/layout-actions"
import type { Workspace, PaneData, WorkspaceId } from "../../core/types"
import { createWorkspace, generatePaneId, resetPaneIdCounter } from "../../core/operations/layout-actions/helpers"

// =============================================================================
// Storage Functions
// =============================================================================

export async function listTemplates(): Promise<TemplateSession[]> {
  return runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      return yield* storage.listTemplates()
    })
  )
}

export async function saveTemplate(template: TemplateSession): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      yield* storage.saveTemplate(template)
    })
  )
}

export async function deleteTemplate(id: string): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const storage = yield* TemplateStorage
      yield* storage.deleteTemplate(id)
    })
  )
}

export async function loadTemplate(id: string): Promise<TemplateSession | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const storage = yield* TemplateStorage
        return yield* storage.loadTemplate(id)
      })
    )
  } catch {
    return null
  }
}

// =============================================================================
// Layout Generation
// =============================================================================

function normalizeTemplatePanes(
  panes: TemplatePaneData[],
  defaultCwd?: string
): TemplatePaneData[] {
  if (panes.length === 0) {
    return [{ role: "main", cwd: defaultCwd }]
  }

  const mainIndex = panes.findIndex((pane) => pane.role === "main")
  if (mainIndex === -1) {
    return [{ role: "main", cwd: defaultCwd }, ...panes]
  }

  const [main] = panes.splice(mainIndex, 1)
  return [main, ...panes.map((pane) => ({ ...pane, role: "stack" as const }))]
}

function buildDefaultPanes(
  paneCount: number,
  defaultCwd?: string
): TemplatePaneData[] {
  const count = Math.max(1, paneCount)
  return [
    { role: "main", cwd: defaultCwd },
    ...Array.from({ length: count - 1 }, () => ({ role: "stack" as const, cwd: defaultCwd })),
  ]
}

function resolveWorkspacePanes(
  workspace: TemplateWorkspace | undefined,
  paneCount: number,
  defaultCwd?: string
): TemplatePaneData[] {
  const panes = workspace?.panes ?? []
  if (panes.length > 0) {
    return normalizeTemplatePanes([...panes], defaultCwd)
  }
  return buildDefaultPanes(paneCount, defaultCwd)
}

export function buildLayoutFromTemplate(
  template: TemplateSession
): {
  workspaces: Workspaces
  cwdMap: Map<string, string>
  commandMap: Map<string, string>
  activeWorkspaceId: WorkspaceId
} {
  resetPaneIdCounter()
  const cwdMap = new Map<string, string>()
  const commandMap = new Map<string, string>()
  const workspaces: Workspaces = {}
  const workspaceMap = new Map<number, TemplateWorkspace>()

  for (const workspace of template.workspaces) {
    workspaceMap.set(workspace.id, workspace)
  }

  const maxWorkspaceId = Math.max(
    template.defaults.workspaceCount,
    ...template.workspaces.map((ws) => ws.id),
    1
  )
  const totalWorkspaces = Math.min(9, maxWorkspaceId)

  for (let id = 1; id <= totalWorkspaces; id += 1) {
    const workspaceId = id as WorkspaceId
    const templateWorkspace = workspaceMap.get(id)
    const layoutMode = templateWorkspace?.layoutMode ?? template.defaults.layoutMode
    const panes = resolveWorkspacePanes(
      templateWorkspace,
      template.defaults.paneCount,
      template.defaults.cwd
    )

    const workspace: Workspace = createWorkspace(workspaceId, layoutMode)
    const paneDefaultsCwd = template.defaults.cwd ?? process.cwd()

    const mainPaneData = panes[0]
    const mainPaneId = generatePaneId()
    workspace.mainPane = {
      id: mainPaneId,
      title: "shell",
    } satisfies PaneData
    cwdMap.set(mainPaneId, mainPaneData.cwd ?? paneDefaultsCwd)
    if (mainPaneData.command) {
      commandMap.set(mainPaneId, mainPaneData.command)
    }

    const stackPanes: PaneData[] = []
    for (const pane of panes.slice(1)) {
      const paneId = generatePaneId()
      stackPanes.push({ id: paneId, title: "shell" })
      cwdMap.set(paneId, pane.cwd ?? paneDefaultsCwd)
      if (pane.command) {
        commandMap.set(paneId, pane.command)
      }
    }

    workspace.stackPanes = stackPanes
    workspace.focusedPaneId = mainPaneId
    workspace.activeStackIndex = 0
    workspace.zoomed = false

    workspaces[workspaceId] = workspace
  }

  return {
    workspaces,
    cwdMap,
    commandMap,
    activeWorkspaceId: 1,
  }
}
