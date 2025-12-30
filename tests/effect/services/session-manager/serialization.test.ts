import { describe, expect, it } from "vitest"

import { SessionMetadata } from "../../../../src/effect/models"
import { serializeSession } from "../../../../src/effect/services/session-manager/serialization"
import type { WorkspaceState } from "../../../../src/effect/services/session-manager/types"

const createWorkspaceWithPane = (paneId: string, ptyId: string): WorkspaceState => ({
  mainPane: { id: paneId, ptyId },
  stackPanes: [],
  focusedPaneId: paneId,
  layoutMode: "vertical",
  activeStackIndex: 0,
  zoomed: false,
})

const createEmptyWorkspace = (): WorkspaceState => ({
  mainPane: null,
  stackPanes: [],
  focusedPaneId: undefined,
  layoutMode: "vertical",
  activeStackIndex: 0,
  zoomed: false,
})

const createMetadata = () =>
  SessionMetadata.make({
    id: "session-1",
    name: "Test Session",
    createdAt: 1,
    lastSwitchedAt: 2,
    autoNamed: false,
  })

describe("serializeSession", () => {
  it("falls back to the first populated workspace when the active workspace is empty", () => {
    const metadata = createMetadata()
    const workspaces = new Map<number, WorkspaceState>([
      [1, createEmptyWorkspace()],
      [2, createWorkspaceWithPane("pane-1", "pty-1")],
    ])
    const cwdMap = new Map<string, string>([["pty-1", "/tmp"]])

    const session = serializeSession(metadata, workspaces, 1, cwdMap)

    expect(session.activeWorkspaceId).toBe(2)
  })

  it("keeps the active workspace when it has panes", () => {
    const metadata = createMetadata()
    const workspaces = new Map<number, WorkspaceState>([
      [2, createWorkspaceWithPane("pane-2", "pty-2")],
    ])
    const cwdMap = new Map<string, string>([["pty-2", "/tmp"]])

    const session = serializeSession(metadata, workspaces, 2, cwdMap)

    expect(session.activeWorkspaceId).toBe(2)
  })

  it("keeps the active workspace when no workspaces are serialized", () => {
    const metadata = createMetadata()
    const workspaces = new Map<number, WorkspaceState>()

    const session = serializeSession(metadata, workspaces, 3, new Map())

    expect(session.activeWorkspaceId).toBe(3)
  })
})
