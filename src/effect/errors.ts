/**
 * Domain errors using errore for type-safe, tagged errors.
 *
 * These classes are returned as values from services and bridges. They are not
 * used as control-flow exceptions for expected failures.
 *
 * @example
 * const result = await storage.loadSession(id).catch(
 *   (cause) =>
 *     new SessionStorageError({
 *       operation: 'load',
 *       path: id,
 *       reason: 'read failed',
 *       cause,
 *     })
 * )
 * if (result instanceof Error) return result
 *
 * @example
 * const session = await sessionManager.loadSession(id)
 * if (session instanceof Error) {
 *   return new AggregateBridgeError({
 *     operation: 'load session for aggregate view',
 *     target: id,
 *     reason: session.message,
 *     cause: session,
 *   })
 * }
 *
 * @example
 * const metadata = await fetchPtyMetadata(...)
 * if (metadata instanceof PtyMetadataError) {
 *   console.warn('Non-fatal PTY metadata refresh failed:', metadata.message)
 *   return existingSnapshot
 * }
 */
import * as errore from 'errore';

/**
 * Use when PTY creation fails at the shell/process boundary.
 * Return this from PTY factory code after wrapping the native spawn failure in `cause`.
 */
export class PtySpawnError extends errore.createTaggedError({
  name: 'PtySpawnError',
  message: 'Failed to spawn PTY shell $shell in $cwd: $reason',
}) {}

/**
 * Use when a PTY id does not resolve to an active session.
 * Return this from lookup helpers instead of silently ignoring missing PTYs.
 */
export class PtyNotFoundError extends errore.createTaggedError({
  name: 'PtyNotFoundError',
  message: 'PTY session $ptyId not found',
}) {}

/**
 * Use when a PTY exists but its current working directory cannot be resolved.
 * Prefer returning this over falling back to `process.cwd()` inside the service layer.
 */
export class PtyCwdError extends errore.createTaggedError({
  name: 'PtyCwdError',
  message: 'Failed to get CWD for PTY $ptyId: $reason',
}) {}

/**
 * Use when a requested session id does not exist in the session index.
 * Return this from CRUD operations that require the session to already exist.
 */
export class SessionNotFoundError extends errore.createTaggedError({
  name: 'SessionNotFoundError',
  message: 'Session $sessionId not found',
}) {}

/**
 * Use when persisted session data exists but cannot be parsed or is internally inconsistent.
 * Wrap lower-level parse/validation errors in `cause` so callers can inspect the chain.
 */
export class SessionCorruptedError extends errore.createTaggedError({
  name: 'SessionCorruptedError',
  message: 'Session $sessionId is corrupted: $reason',
}) {}

/**
 * Use at file-system boundaries for session index/session file read-write failures.
 * This is the storage-layer error that higher-level session errors usually wrap with `cause`.
 */
export class SessionStorageError extends errore.createTaggedError({
  name: 'SessionStorageError',
  message: 'Session storage $operation failed for $path: $reason',
}) {}

/** Union of all session-related errors. */
export type SessionError = SessionNotFoundError | SessionCorruptedError | SessionStorageError;

/**
 * Use when bridge code is called before the application wires up service instances.
 * This is one of the few programming-boundary errors that bridge helpers may throw.
 */
export class ServicesNotInitializedError extends errore.createTaggedError({
  name: 'ServicesNotInitializedError',
  message: 'Services not initialized for $operation',
}) {}

/**
 * Use when aggregate-view orchestration fails after composing lower-level services.
 * Wrap the underlying PTY/session error in `cause` so callers keep the original context.
 */
export class AggregateBridgeError extends errore.createTaggedError({
  name: 'AggregateBridgeError',
  message: 'Aggregate bridge $operation failed for $target: $reason',
}) {}

/**
 * Use for clipboard read/write or OSC-52 translation failures.
 * Return this from clipboard bridges when the failure is expected and user-facing.
 */
export class ClipboardError extends errore.createTaggedError({
  name: 'ClipboardError',
  message: 'Clipboard $operation failed: $reason',
}) {}

/**
 * Use at template persistence boundaries for template file/index I/O errors.
 * This mirrors SessionStorageError but keeps template failures distinct for callers.
 */
export class TemplateStorageError extends errore.createTaggedError({
  name: 'TemplateStorageError',
  message: 'Template storage $operation failed for $path: $reason',
}) {}

/**
 * Use for invalid or unsupported configuration values after parsing succeeds.
 * Wrap underlying parse errors in `cause` when escalating from file loading code.
 */
export class ConfigError extends errore.createTaggedError({
  name: 'ConfigError',
  message: 'Configuration error: $reason',
}) {}

/**
 * Use for schema or invariant validation failures on otherwise well-formed data.
 * This is the right error when data is readable but semantically unacceptable.
 */
export class ValidationError extends errore.createTaggedError({
  name: 'ValidationError',
  message: 'Validation failed: $reason',
}) {}

/**
 * Use for general filesystem operations outside session/template persistence.
 * Prefer this over SessionStorageError/TemplateStorageError when the path is not session-specific.
 */
export class FileSystemError extends errore.createTaggedError({
  name: 'FileSystemError',
  message: 'File system $operation failed for $path: $reason',
}) {}

/**
 * Use when the detach/attach shim connection cannot be established or maintained.
 * Wrap lower-level socket/process failures in `cause` so reconnect logic can inspect them.
 */
export class ShimConnectionError extends errore.createTaggedError({
  name: 'ShimConnectionError',
  message: 'Shim connection failed: $reason',
}) {}

/**
 * Use for generic update/refresh operations that do not deserve their own domain error.
 * Prefer a more specific error class when the failing subsystem is known.
 */
export class UpdateError extends errore.createTaggedError({
  name: 'UpdateError',
  message: 'Update $operation failed: $reason',
}) {}

/**
 * Use when Kitty graphics transmission/offload work fails.
 * This keeps image-transport issues separate from core PTY or terminal failures.
 */
export class KittyOffloadError extends errore.createTaggedError({
  name: 'KittyOffloadError',
  message: 'Kitty graphics offload $operation failed: $reason',
}) {}

/**
 * Use for scrollback archive persistence, rotation, or cache failures.
 * Wrap archive filesystem failures in `cause` so callers can downgrade gracefully.
 */
export class ScrollbackArchiveError extends errore.createTaggedError({
  name: 'ScrollbackArchiveError',
  message: 'Scrollback archive $operation failed: $reason',
}) {}

/**
 * Use when host-terminal color probing or application fails.
 * This is specific to color-query flows, not general terminal initialization.
 */
export class TerminalColorError extends errore.createTaggedError({
  name: 'TerminalColorError',
  message: 'Terminal color $operation failed: $reason',
}) {}

/**
 * Use for PTY trace capture/serialization failures.
 * Treat this as observability tooling failure, not core PTY lifecycle failure.
 */
export class PtyTraceError extends errore.createTaggedError({
  name: 'PtyTraceError',
  message: 'PTY trace $operation failed: $reason',
}) {}

/**
 * Use when PTY subscription setup/teardown fails for a specific session.
 * This is appropriate for stream wiring errors around unified terminal updates.
 */
export class TerminalSubscriptionError extends errore.createTaggedError({
  name: 'TerminalSubscriptionError',
  message: 'Terminal $operation failed for PTY $ptyId: $reason',
}) {}

/**
 * Use for session-list/template refresh loops that intentionally continue after logging.
 * This is a good fit when a refresh failure should not crash the UI but must stay visible.
 */
export class SessionRefreshError extends errore.createTaggedError({
  name: 'SessionRefreshError',
  message: 'Session refresh $operation failed: $reason',
}) {}

/**
 * Use for best-effort PTY metadata enrichment that should not abort the main workflow.
 * This is intentionally non-fatal: log it, preserve the existing snapshot, and continue rendering.
 *
 * @example
 * const result = await fetchPtyMetadataSafe(pty, ptyId)
 * if (result instanceof PtyMetadataError) {
 *   console.warn(result.message)
 *   return cachedMetadata
 * }
 */
export class PtyMetadataError extends errore.createTaggedError({
  name: 'PtyMetadataError',
  message: 'PTY metadata $operation failed for $ptyId: $reason',
}) {}

/**
 * Use when PTY data handler operations (clipboard copy, sync parsing) fail.
 * This is for the data processing pipeline, not PTY lifecycle errors.
 */
export class DataHandlerError extends errore.createTaggedError({
  name: 'DataHandlerError',
  message: 'Data handler $operation failed: $reason',
}) {}

/**
 * Use when PTY subscription setup/teardown fails in the subscription manager.
 * Distinct from TerminalSubscriptionError which is for the unified terminal layer.
 */
export class SubscriptionError extends errore.createTaggedError({
  name: 'SubscriptionError',
  message: 'Subscription $operation failed: $reason',
}) {}

/**
 * Use when scrollback archiver operations (persist, rotate, cache) fail.
 * Wrap lower-level filesystem errors in `cause`.
 */
export class ArchiverError extends errore.createTaggedError({
  name: 'ArchiverError',
  message: 'Scrollback archiver $operation failed: $reason',
}) {}

/**
 * Use when PTY service operations (resize, write, kill) fail.
 * This is for the operations layer, not spawn/lifecycle errors.
 */
export class PtyOperationError extends errore.createTaggedError({
  name: 'PtyOperationError',
  message: 'PTY operation $operation failed: $reason',
}) {}

/**
 * Use when PTY query setup (title, cwd detection) fails.
 * This is for the initial query configuration, not ongoing queries.
 */
export class QuerySetupError extends errore.createTaggedError({
  name: 'QuerySetupError',
  message: 'Query setup $operation failed: $reason',
}) {}

/**
 * Use when scrollback chunk parsing or serialization fails.
 * This is for the chunks module's internal parsing operations.
 */
export class ChunkParseError extends errore.createTaggedError({
  name: 'ChunkParseError',
  message: 'Chunk parse $operation failed: $reason',
}) {}

/**
 * Use when stream utility operations (async iterable handling) fail.
 * This is for the stream-utils module's pipeline operations.
 */
export class StreamError extends errore.createTaggedError({
  name: 'StreamError',
  message: 'Stream $operation failed: $reason',
}) {}

/**
 * Use when native key encoder operations fail.
 * This is for the native key encoder's FFI operations.
 */
export class NativeKeyError extends errore.createTaggedError({
  name: 'NativeKeyError',
  message: 'Native key encoder $operation failed: $reason',
}) {}

/**
 * Use for libghostty-vt shared library loading or terminal creation failures.
 * These are typically fatal at startup or emulator init; the message includes
 * diagnostic paths for the library.
 */
export class GhosttyVtInitError extends errore.createTaggedError({
  name: 'GhosttyVtInitError',
  message: 'Ghostty VT $operation failed: $reason',
}) {}

/**
 * Use when session operations (create, update, delete) fail.
 * This is for the session-operations context, not storage errors.
 */
export class SessionOpError extends errore.createTaggedError({
  name: 'SessionOpError',
  message: 'Session operation $operation failed: $reason',
}) {}

/**
 * Use when terminal query passthrough operations fail.
 * This is for the query passthrough handlers and registry.
 */
export class QueryPassthroughError extends errore.createTaggedError({
  name: 'QueryPassthroughError',
  message: 'Query passthrough $operation failed: $reason',
}) {}
