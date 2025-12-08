/**
 * Domain errors with Schema.TaggedError for type-safe, serializable errors.
 */
import { Schema } from "effect"
import { PtyId, SessionId } from "./types"

// =============================================================================
// PTY Errors
// =============================================================================

/** Failed to spawn a PTY process */
export class PtySpawnError extends Schema.TaggedError<PtySpawnError>()(
  "PtySpawnError",
  {
    shell: Schema.String,
    cwd: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** PTY session not found */
export class PtyNotFoundError extends Schema.TaggedError<PtyNotFoundError>()(
  "PtyNotFoundError",
  {
    ptyId: PtyId,
  }
) {}

/** Failed to get PTY current working directory */
export class PtyCwdError extends Schema.TaggedError<PtyCwdError>()(
  "PtyCwdError",
  {
    ptyId: PtyId,
    cause: Schema.Defect,
  }
) {}

/** Union of all PTY errors */
export const PtyError = Schema.Union(PtySpawnError, PtyNotFoundError, PtyCwdError)
export type PtyError = typeof PtyError.Type

// =============================================================================
// Session Errors
// =============================================================================

/** Session not found */
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionId: SessionId,
  }
) {}

/** Session file is corrupted */
export class SessionCorruptedError extends Schema.TaggedError<SessionCorruptedError>()(
  "SessionCorruptedError",
  {
    sessionId: SessionId,
    cause: Schema.Defect,
  }
) {}

/** Session storage I/O error */
export class SessionStorageError extends Schema.TaggedError<SessionStorageError>()(
  "SessionStorageError",
  {
    operation: Schema.Literal("read", "write", "delete"),
    path: Schema.String,
    cause: Schema.Defect,
  }
) {}

/** Union of all session errors */
export const SessionError = Schema.Union(
  SessionNotFoundError,
  SessionCorruptedError,
  SessionStorageError
)
export type SessionError = typeof SessionError.Type

// =============================================================================
// Clipboard Errors
// =============================================================================

/** Clipboard operation failed */
export class ClipboardError extends Schema.TaggedError<ClipboardError>()(
  "ClipboardError",
  {
    operation: Schema.Literal("read", "write"),
    cause: Schema.Defect,
  }
) {}

// =============================================================================
// Terminal Errors
// =============================================================================

/** Terminal emulator initialization failed */
export class TerminalInitError extends Schema.TaggedError<TerminalInitError>()(
  "TerminalInitError",
  {
    cause: Schema.Defect,
  }
) {}

/** Terminal emulator not found */
export class TerminalNotFoundError extends Schema.TaggedError<TerminalNotFoundError>()(
  "TerminalNotFoundError",
  {
    ptyId: PtyId,
  }
) {}
