/**
 * Session manager module exports
 */

export type { SessionError, WorkspaceState } from "./types"

export {
  getAutoName,
  shouldUpdateAutoName,
  collectCwdMap,
  serializeWorkspace,
  serializeSession,
} from "./serialization"

export {
  createLifecycleOperations,
  type LifecycleDeps,
} from "./lifecycle"

export {
  createMetadataOperations,
  type MetadataDeps,
} from "./metadata"

export {
  createActiveSessionOperations,
  type ActiveSessionDeps,
} from "./active-session"

export {
  createQuickSaveOperations,
  type QuickSaveDeps,
} from "./quick-save"
