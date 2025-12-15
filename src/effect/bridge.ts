/**
 * Bridge module for gradual migration to Effect services.
 * Provides simple async functions backed by Effect services.
 *
 * Use these functions in existing code to migrate to Effect
 * without changing the entire callsite at once.
 */
import { Effect } from "effect"
import { runEffect, runEffectIgnore } from "./runtime"
import { Clipboard, Pty, SessionManager, SessionStorage } from "./services"
import { PtyId, Cols, Rows, SessionId, makePtyId } from "./types"
import { getHostColors, extractRgb } from "../terminal/terminal-colors"
import type { SerializedSession, SessionMetadata } from "./models"
import {
  SerializedSession as EffectSerializedSession,
  SerializedWorkspace,
  SerializedPaneData,
  SessionMetadata as EffectSessionMetadata,
} from "./models"
import type {
  SessionMetadata as LegacySessionMetadata,
  Workspace,
  WorkspaceId,
  PaneData,
  TerminalState,
  UnifiedTerminalUpdate,
} from "../core/types"

// =============================================================================
// Clipboard Bridge
// =============================================================================

/**
 * Copy text to clipboard using Effect service.
 * Drop-in replacement for utils/clipboard.ts copyToClipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await runEffect(
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        yield* clipboard.write(text)
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read text from clipboard using Effect service.
 * Drop-in replacement for utils/clipboard.ts readFromClipboard
 */
export async function readFromClipboard(): Promise<string | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        return yield* clipboard.read()
      })
    )
  } catch {
    return null
  }
}

// =============================================================================
// PTY Bridge
// =============================================================================

/**
 * Create a PTY session using Effect service.
 */
export async function createPtySession(options: {
  cols: number
  rows: number
  cwd?: string
}): Promise<string> {
  return runEffect(
    Effect.gen(function* () {
      const pty = yield* Pty
      const ptyId = yield* pty.create({
        cols: Cols.make(options.cols),
        rows: Rows.make(options.rows),
        cwd: options.cwd,
      })
      return ptyId
    })
  )
}

/**
 * Write data to a PTY session.
 */
export async function writeToPty(ptyId: string, data: string): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.write(PtyId.make(ptyId), data)
    })
  )
}

/**
 * Resize a PTY session.
 */
export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number
): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.resize(PtyId.make(ptyId), Cols.make(cols), Rows.make(rows))
    })
  )
}

/**
 * Get the current working directory of a PTY session.
 */
export async function getPtyCwd(ptyId: string): Promise<string> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getCwd(PtyId.make(ptyId))
      })
    )
  } catch {
    return process.cwd()
  }
}

/**
 * Destroy a PTY session.
 */
export async function destroyPty(ptyId: string): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.destroy(PtyId.make(ptyId))
    })
  )
}

/**
 * Destroy all PTY sessions.
 */
export async function destroyAllPtys(): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.destroyAll()
    })
  )
}

/**
 * Get terminal state for a PTY session.
 */
export async function getTerminalState(ptyId: string): Promise<TerminalState | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getTerminalState(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}

/**
 * Register an exit callback for a PTY session.
 * Returns an unsubscribe function.
 */
export async function onPtyExit(
  ptyId: string,
  callback: (exitCode: number) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.onExit(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Set pane position for graphics passthrough.
 */
export async function setPanePosition(
  ptyId: string,
  x: number,
  y: number
): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.setPanePosition(PtyId.make(ptyId), x, y)
    })
  )
}

/**
 * Get scroll state for a PTY session.
 */
export async function getScrollState(
  ptyId: string
): Promise<{ viewportOffset: number; scrollbackLength: number; isAtBottom: boolean } | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getScrollState(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}

/**
 * Set scroll offset for a PTY session.
 */
export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  await runEffectIgnore(
    Effect.gen(function* () {
      const pty = yield* Pty
      yield* pty.setScrollOffset(PtyId.make(ptyId), offset)
    })
  )
}

/**
 * Scroll terminal to bottom (live content).
 */
export async function scrollToBottom(ptyId: string): Promise<void> {
  await setScrollOffset(ptyId, 0)
}

/**
 * Subscribe to terminal state updates.
 * Returns an unsubscribe function.
 */
export async function subscribeToPty(
  ptyId: string,
  callback: (state: TerminalState) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribe(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Subscribe to scroll state changes (lightweight - no terminal state rebuild).
 * Returns an unsubscribe function.
 */
export async function subscribeToScroll(
  ptyId: string,
  callback: () => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeToScroll(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Subscribe to unified terminal + scroll updates.
 * More efficient than separate subscriptions - eliminates race conditions
 * and reduces render cycles by delivering both state changes in one callback.
 * Returns an unsubscribe function.
 */
export async function subscribeUnifiedToPty(
  ptyId: string,
  callback: (update: UnifiedTerminalUpdate) => void
): Promise<() => void> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.subscribeUnified(PtyId.make(ptyId), callback)
      })
    )
  } catch {
    return () => {}
  }
}

/**
 * Get a scrollback line from the terminal emulator.
 * Returns null if the line doesn't exist or the PTY is not found.
 */
export async function getScrollbackLine(
  ptyId: string,
  lineIndex: number
): Promise<import("../core/types").TerminalCell[] | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const emulator = yield* pty.getEmulator(PtyId.make(ptyId))
        return emulator.getScrollbackLine(lineIndex)
      })
    )
  } catch {
    return null
  }
}

/**
 * Get the terminal emulator instance for direct access.
 * Primarily used for scrollback rendering in TerminalView.
 * Should be called once and cached for sync access in render loops.
 */
export async function getEmulator(
  ptyId: string
): Promise<import("../terminal/ghostty-emulator").GhosttyEmulator | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        return yield* pty.getEmulator(PtyId.make(ptyId))
      })
    )
  } catch {
    return null
  }
}

// =============================================================================
// Session Bridge
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

// =============================================================================
// Additional Session Bridge Functions (Effect implementations)
// =============================================================================

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

/**
 * Extract auto-name from a path (last directory component).
 */
export function getAutoName(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? "untitled"
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
// Session Serialization Bridge (Effect implementations)
// =============================================================================

/**
 * Deserialize a pane from Effect format to legacy format.
 */
function deserializePane(serialized: SerializedPaneData): PaneData {
  return {
    id: serialized.id,
    title: serialized.title,
    // ptyId is intentionally omitted - will be created on session load
  }
}

/**
 * Deserialize a workspace from Effect format to legacy format.
 */
function deserializeWorkspace(serialized: SerializedWorkspace): Workspace {
  return {
    id: serialized.id as WorkspaceId,
    mainPane: serialized.mainPane ? deserializePane(serialized.mainPane) : null,
    stackPanes: serialized.stackPanes.map(deserializePane),
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
  for (const ws of session.workspaces) {
    if (ws.mainPane) {
      cwdMap.set(ws.mainPane.id, ws.mainPane.cwd)
    }
    for (const pane of ws.stackPanes) {
      cwdMap.set(pane.id, pane.cwd)
    }
  }
  return cwdMap
}

/**
 * Save the current session state using Effect service.
 */
export async function saveCurrentSession(
  metadata: LegacySessionMetadata,
  workspaces: Map<WorkspaceId, Workspace>,
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

      // Convert Map<WorkspaceId, Workspace> to ReadonlyMap<number, WorkspaceState>
      const workspaceState = new Map<number, {
        mainPane: { id: string; ptyId?: string; title?: string } | null
        stackPanes: Array<{ id: string; ptyId?: string; title?: string }>
        focusedPaneId?: string
        layoutMode: "vertical" | "horizontal" | "stacked"
        activeStackIndex: number
        zoomed: boolean
      }>()

      for (const [id, ws] of workspaces) {
        workspaceState.set(id, {
          mainPane: ws.mainPane ? {
            id: ws.mainPane.id,
            ptyId: ws.mainPane.ptyId,
            title: ws.mainPane.title,
          } : null,
          stackPanes: ws.stackPanes.map(p => ({
            id: p.id,
            ptyId: p.ptyId,
            title: p.title,
          })),
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
  workspaces: Map<WorkspaceId, Workspace>
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

        // Deserialize workspaces
        const workspaces = new Map<WorkspaceId, Workspace>()
        for (const ws of session.workspaces) {
          workspaces.set(ws.id as WorkspaceId, deserializeWorkspace(ws))
        }

        // Extract CWD map
        const cwdMap = extractCwdMap(session)

        return {
          metadata,
          workspaces,
          activeWorkspaceId: session.activeWorkspaceId as WorkspaceId,
          cwdMap,
        }
      })
    )
  } catch {
    return null
  }
}

// =============================================================================
// Aggregate View Bridge
// =============================================================================

/** Check if a process is still alive */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    // kill -0 sends no signal but checks if process exists
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function listAllPtysWithMetadata(): Promise<Array<{
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  foregroundProcess: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}>> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const pty = yield* Pty
        const ptyIds = yield* pty.listAll()

        const results: Array<{
          ptyId: string
          cwd: string
          gitBranch: string | undefined
          foregroundProcess: string | undefined
          workspaceId: number | undefined
          paneId: string | undefined
        }> = []

        for (const ptyId of ptyIds) {
          // Get session to check if PTY process is still alive
          const session = yield* pty.getSession(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )

          // Skip if session not found or process is dead
          if (!session || session.pid === 0) continue
          const alive = yield* Effect.promise(() => isProcessAlive(session.pid))
          if (!alive) continue

          const cwd = yield* pty.getCwd(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(process.cwd()))
          )
          const gitBranch = yield* pty.getGitBranch(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )
          const foregroundProcess = yield* pty.getForegroundProcess(ptyId).pipe(
            Effect.catchAll(() => Effect.succeed(undefined))
          )

          // Skip defunct processes (zombie processes)
          if (foregroundProcess?.includes('defunct')) continue

          results.push({
            ptyId,
            cwd,
            gitBranch,
            foregroundProcess,
            workspaceId: undefined, // Will be enriched by AggregateView
            paneId: undefined,      // Will be enriched by AggregateView
          })
        }

        return results
      })
    )
  } catch {
    return []
  }
}

// =============================================================================
// Terminal Color Bridge
// =============================================================================

/**
 * Get the host terminal's background color as a hex string.
 * Returns the cached color if available, otherwise returns a default.
 */
export function getHostBackgroundColor(): string {
  const colors = getHostColors()
  if (colors) {
    const rgb = extractRgb(colors.background)
    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
  }
  // Default dark background if no host colors detected
  return '#000000'
}

/**
 * Get the host terminal's foreground color as a hex string.
 * Returns the cached color if available, otherwise returns a default.
 */
export function getHostForegroundColor(): string {
  const colors = getHostColors()
  if (colors) {
    const rgb = extractRgb(colors.foreground)
    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
  }
  // Default white foreground if no host colors detected
  return '#ffffff'
}
