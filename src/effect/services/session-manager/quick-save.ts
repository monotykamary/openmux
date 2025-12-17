/**
 * Quick save operations for SessionManager
 * Handles workspace serialization and quick save functionality
 */

import { Effect } from "effect"
import {
  SerializedSession,
  SessionMetadata,
} from "../../models"
import type { WorkspaceState } from "./types"
import { collectCwdMap, serializeSession } from "./serialization"

export interface QuickSaveDeps {
  saveSession: (session: SerializedSession) => Effect.Effect<void, any>
}

/**
 * Create quick save operations for SessionManager
 */
export function createQuickSaveOperations(deps: QuickSaveDeps) {
  const { saveSession } = deps

  const serializeWorkspaces = Effect.fn(
    "SessionManager.serializeWorkspaces"
  )(function* (
    metadata: SessionMetadata,
    workspaces: ReadonlyMap<number, WorkspaceState>,
    activeWorkspaceId: number,
    getCwd: (ptyId: string) => Promise<string>
  ) {
    // Collect all CWDs using extracted helper
    const cwdMap = yield* collectCwdMap(workspaces, getCwd)
    // Serialize using extracted helper
    return serializeSession(metadata, workspaces, activeWorkspaceId, cwdMap)
  })

  const quickSave = Effect.fn("SessionManager.quickSave")(function* (
    metadata: SessionMetadata,
    workspaces: ReadonlyMap<number, WorkspaceState>,
    activeWorkspaceId: number,
    getCwd: (ptyId: string) => Promise<string>
  ) {
    const session = yield* serializeWorkspaces(
      metadata,
      workspaces,
      activeWorkspaceId,
      getCwd
    )
    yield* saveSession(session)
  })

  return {
    serializeWorkspaces,
    quickSave,
  }
}
