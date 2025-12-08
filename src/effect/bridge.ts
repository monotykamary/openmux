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
import type { SerializedSession, SessionMetadata } from "./models"
import type { SessionMetadata as LegacySessionMetadata } from "../core/types"

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

// These still use legacy implementations due to complex serialization
export {
  saveCurrentSession,
  loadSessionData,
} from "../core/session"
