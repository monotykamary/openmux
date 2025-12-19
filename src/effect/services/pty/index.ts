/**
 * PTY service module
 * Re-exports all PTY service functionality
 */

export type { InternalPtySession } from "./types"
export { getForegroundProcess, getGitBranch, getProcessCwd } from "./helpers"
export { getCurrentScrollState, notifySubscribers, notifyScrollSubscribers } from "./notification"
export { createDataHandler } from "./data-handler"
export { setupQueryPassthrough } from "./query-setup"
export { makeSubscriptionRegistry, type SubscriptionRegistry, type SubscriptionId } from "./subscription-manager"
export { createSession, type SessionFactoryDeps, type CreateSessionOptions } from "./session-factory"
export { createOperations, type OperationsDeps } from "./operations"
export { createSubscriptions, type SubscriptionsDeps } from "./subscriptions"
