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
