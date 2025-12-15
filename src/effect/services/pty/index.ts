/**
 * PTY service module
 * Re-exports all PTY service functionality
 */

export type { InternalPtySession } from "./types"
export { getForegroundProcess, getGitBranch, getProcessCwd } from "./helpers"
export { getCurrentScrollState, notifySubscribers, notifyScrollSubscribers } from "./notification"
