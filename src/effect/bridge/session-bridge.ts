/**
 * Session bridge functions
 * Wraps Effect SessionManager service for async/await usage
 */

import { Effect } from "effect"
import { runEffect } from "../runtime"
import { SessionManager } from "../services"
import { SessionId } from "../types"
import type {
  SerializedSession,
  SessionMetadata,
  SerializedSession as EffectSerializedSession,
  SerializedWorkspace,
  SerializedLayoutNode,
} from "../models"
import {
  SessionMetadata as EffectSessionMetadata,
} from "../models"
import { resolveActiveWorkspaceId } from "./session-bridge-utils"
import type {
  SessionMetadata as LegacySessionMetadata,
  Workspace,
  WorkspaceId,
  PaneData,
  LayoutNode,
} from "../../core/types"
import type { Workspaces } from "../../core/operations/layout-actions"
import type { WorkspaceState } from "../services/session-manager/types"

// =============================================================================
// Core Session Functions
// =============================================================================

/**
 * List all sessions.
 */
export async function listSessions(): Promise<readonly SessionMetadata[]> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.listSessions()
    })
  )
}

/**
 * Create a new session.
 */
export async function createSession(name: string): Promise<string> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      const metadata = yield* manager.createSession(name)
      return metadata.id
    })
  )
}

/**
 * Load a session by ID.
 */
export async function loadSession(id: string): Promise<SerializedSession> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.loadSession(SessionId.make(id))
    })
  )
}

/**
 * Save a session.
 */
export async function saveSession(session: SerializedSession): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.saveSession(session)
    })
  )
}

/**
 * Delete a session.
 */
export async function deleteSession(id: string): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.deleteSession(SessionId.make(id))
    })
  )
}

/**
 * Rename a session.
 */
export async function renameSession(
  id: string,
  newName: string
): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.renameSession(SessionId.make(id), newName)
    })
  )
}

/**
 * Get the active session ID.
 */
export async function getActiveSessionId(): Promise<string | null> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.getActiveSessionId()
    })
  )
}

/**
 * Set the active session ID.
 */
export async function setActiveSessionId(id: string | null): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.setActiveSessionId(id ? SessionId.make(id) : null)
    })
  )
}

/**
 * Switch to a session (updates lastSwitchedAt timestamp).
 */
export async function switchToSession(id: string): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.switchToSession(SessionId.make(id))
    })
  )
}

/**
 * Get session metadata by ID.
 */
export async function getSessionMetadata(id: string): Promise<SessionMetadata | null> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.getSessionMetadata(SessionId.make(id))
    })
  )
}

/**
 * Update auto-name for a session based on cwd.
 */
export async function updateAutoName(id: string, cwd: string): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      yield* manager.updateAutoName(SessionId.make(id), cwd)
    })
  )
}

/**
 * Get session summary (workspace/pane counts).
 */
export async function getSessionSummary(
  id: string
): Promise<{ workspaceCount: number; paneCount: number } | null> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      return yield* manager.getSessionSummary(SessionId.make(id))
    })
  )
}

// =============================================================================
// Legacy Compatibility Functions
// These maintain backwards compatibility with SessionContext imports
// =============================================================================

/**
 * Create a new session (legacy compatibility - returns full metadata).
 */
export async function createSessionLegacy(name?: string): Promise<LegacySessionMetadata> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      const metadata = yield* manager.createSession(name)
      // Effect SessionMetadata is structurally compatible with legacy
      return metadata as unknown as LegacySessionMetadata
    })
  )
}

/**
 * List all sessions (legacy compatibility - returns mutable array).
 */
export async function listSessionsLegacy(): Promise<LegacySessionMetadata[]> {
  return runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager
      const sessions = yield* manager.listSessions()
      // Convert to mutable array of legacy type
      return [...sessions] as unknown as LegacySessionMetadata[]
    })
  )
}

/**
 * Get active session ID (legacy compatibility).
 */
export async function getActiveSessionIdLegacy(): Promise<string | null> {
  return getActiveSessionId()
}

/**
 * Rename session (legacy compatibility).
 */
export async function renameSessionLegacy(id: string, name: string): Promise<void> {
  return renameSession(id, name)
}

/**
 * Delete session (legacy compatibility).
 */
export async function deleteSessionLegacy(id: string): Promise<void> {
  return deleteSession(id)
}

// =============================================================================
// Session Serialization Functions
// =============================================================================

function deserializeLayoutNode(serialized: SerializedLayoutNode): LayoutNode {
  if ((serialized as { type?: string }).type === "split") {
    const split = serialized as SerializedLayoutNode & {
      id: string
      direction: "horizontal" | "vertical"
      ratio: number
      first: SerializedLayoutNode
      second: SerializedLayoutNode
    }
    return {
      type: "split",
      id: split.id,
      direction: split.direction,
      ratio: split.ratio,
      first: deserializeLayoutNode(split.first),
      second: deserializeLayoutNode(split.second),
    }
  }

  const pane = serialized as SerializedLayoutNode & { id: string; title?: string }
  return {
    id: pane.id,
    title: pane.title,
  } satisfies PaneData
}

/**
 * Deserialize a workspace from Effect format to legacy format.
 */
function deserializeWorkspace(serialized: SerializedWorkspace): Workspace {
  return {
    id: serialized.id as WorkspaceId,
    mainPane: serialized.mainPane ? deserializeLayoutNode(serialized.mainPane) : null,
    stackPanes: serialized.stackPanes.map(deserializeLayoutNode),
    focusedPaneId: serialized.focusedPaneId,
    activeStackIndex: serialized.activeStackIndex,
    layoutMode: serialized.layoutMode,
    zoomed: serialized.zoomed,
  }
}

/**
 * Extract cwd map from Effect serialized session.
 */
function extractCwdMap(session: EffectSerializedSession): Map<string, string> {
  const cwdMap = new Map<string, string>()
  const collectCwds = (node: SerializedLayoutNode | null) => {
    if (!node) return
    if ((node as { type?: string }).type === "split") {
      const split = node as SerializedLayoutNode & { first: SerializedLayoutNode; second: SerializedLayoutNode }
      collectCwds(split.first)
      collectCwds(split.second)
      return
    }
    const pane = node as SerializedLayoutNode & { id: string; cwd: string }
    cwdMap.set(pane.id, pane.cwd)
  }

  for (const ws of session.workspaces) {
    collectCwds(ws.mainPane)
    for (const pane of ws.stackPanes) {
      collectCwds(pane)
    }
  }
  return cwdMap
}

/**
 * Save the current session state using Effect service.
 */
export async function saveCurrentSession(
  metadata: LegacySessionMetadata,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId,
  getCwd: (ptyId: string) => Promise<string>
): Promise<void> {
  await runEffect(
    Effect.gen(function* () {
      const manager = yield* SessionManager

      // Convert legacy metadata to Effect metadata
      const effectMetadata = EffectSessionMetadata.make({
        id: SessionId.make(metadata.id),
        name: metadata.name,
        createdAt: metadata.createdAt,
        lastSwitchedAt: metadata.lastSwitchedAt,
        autoNamed: metadata.autoNamed,
      })

      // Convert Workspaces object to ReadonlyMap<number, WorkspaceState>
      const workspaceState = new Map<number, WorkspaceState>()

      for (const [idStr, ws] of Object.entries(workspaces)) {
        if (!ws) continue
        const id = Number(idStr)
        workspaceState.set(id, {
          mainPane: ws.mainPane ?? null,
          stackPanes: ws.stackPanes,
          focusedPaneId: ws.focusedPaneId ?? undefined,
          layoutMode: ws.layoutMode,
          activeStackIndex: ws.activeStackIndex,
          zoomed: ws.zoomed,
        })
      }

      yield* manager.quickSave(effectMetadata, workspaceState, activeWorkspaceId, getCwd)
    })
  )
}

/**
 * Load a session from disk using Effect service.
 * Returns the deserialized data and a CWD map for PTY creation.
 */
export async function loadSessionData(
  sessionId: string
): Promise<{
  metadata: LegacySessionMetadata
  workspaces: Workspaces
  activeWorkspaceId: WorkspaceId
  cwdMap: Map<string, string>
} | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const manager = yield* SessionManager
        const session = yield* manager.loadSession(SessionId.make(sessionId))

        // Convert Effect metadata to legacy metadata
        const metadata: LegacySessionMetadata = {
          id: session.metadata.id,
          name: session.metadata.name,
          createdAt: session.metadata.createdAt,
          lastSwitchedAt: session.metadata.lastSwitchedAt,
          autoNamed: session.metadata.autoNamed,
        }

        // Deserialize workspaces to plain object
        const workspaces: Workspaces = {}
        for (const ws of session.workspaces) {
          workspaces[ws.id as WorkspaceId] = deserializeWorkspace(ws)
        }

        const storedActiveId = session.activeWorkspaceId as WorkspaceId
        const resolvedActiveWorkspaceId = resolveActiveWorkspaceId(workspaces, storedActiveId)

        // Extract CWD map
        const cwdMap = extractCwdMap(session)

        return {
          metadata,
          workspaces,
          activeWorkspaceId: resolvedActiveWorkspaceId,
          cwdMap,
        }
      })
    )
  } catch {
    return null
  }
}
