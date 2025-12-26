/**
 * PTY Subscriptions - event subscription handlers
 */
import { Effect } from "effect"
import type { TerminalState, UnifiedTerminalUpdate } from "../../../core/types"
import type { PtyNotFoundError } from "../../errors"
import type { PtyId } from "../../types"
import type { InternalPtySession } from "./types"
import { getCurrentScrollState } from "./notification"
import { getGitBranch } from "./helpers"
import type { SubscriptionRegistry } from "./subscription-manager"

export interface SubscriptionsDeps {
  getSessionOrFail: (id: PtyId) => Effect.Effect<InternalPtySession, PtyNotFoundError>
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>
  globalTitleRegistry: SubscriptionRegistry<{ ptyId: PtyId; title: string }>
}

export function createSubscriptions(deps: SubscriptionsDeps) {
  const { getSessionOrFail, lifecycleRegistry, globalTitleRegistry } = deps

  const subscribe = Effect.fn("Pty.subscribe")(function* (
    id: PtyId,
    callback: (state: TerminalState) => void
  ) {
    const session = yield* getSessionOrFail(id)

    session.subscribers.add(callback)
    callback(session.emulator.getTerminalState())

    return () => {
      session.subscribers.delete(callback)
    }
  })

  const subscribeToScroll = Effect.fn("Pty.subscribeToScroll")(function* (
    id: PtyId,
    callback: () => void
  ) {
    const session = yield* getSessionOrFail(id)
    session.scrollSubscribers.add(callback)

    return () => {
      session.scrollSubscribers.delete(callback)
    }
  })

  const subscribeUnified = Effect.fn("Pty.subscribeUnified")(function* (
    id: PtyId,
    callback: (update: UnifiedTerminalUpdate) => void
  ) {
    const session = yield* getSessionOrFail(id)
    session.unifiedSubscribers.add(callback)

    // Send initial full state
    const scrollState = getCurrentScrollState(session)
    const fullState = session.emulator.getTerminalState()
    const initialUpdate: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: fullState.cursor,
        scrollState,
        cols: fullState.cols,
        rows: fullState.rows,
        isFull: true,
        fullState,
        alternateScreen: fullState.alternateScreen,
        mouseTracking: fullState.mouseTracking,
        cursorKeyMode: fullState.cursorKeyMode ?? 'normal',
        inBandResize: session.emulator.getMode(2048),
      },
      scrollState,
    }
    callback(initialUpdate)

    return () => {
      session.unifiedSubscribers.delete(callback)
    }
  })

  const onExit = Effect.fn("Pty.onExit")(function* (
    id: PtyId,
    callback: (exitCode: number) => void
  ) {
    const session = yield* getSessionOrFail(id)

    session.exitCallbacks.add(callback)

    return () => {
      session.exitCallbacks.delete(callback)
    }
  })

  const getForegroundProcessFn = Effect.fn("Pty.getForegroundProcess")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    // Use native zig-pty method directly (no subprocess spawning)
    return session.pty.getForegroundProcessName() ?? undefined
  })

  const getGitBranchFn = Effect.fn("Pty.getGitBranch")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    // Use native zig-pty method directly (no subprocess spawning)
    const cwd = session.pty.getCwd()
    if (!cwd) return undefined
    return yield* getGitBranch(cwd)
  })

  const subscribeToLifecycle = Effect.fn("Pty.subscribeToLifecycle")(function* (
    callback: (event: { type: 'created' | 'destroyed'; ptyId: PtyId }) => void
  ) {
    return yield* lifecycleRegistry.subscribe(callback)
  })

  const subscribeToTitleChange = Effect.fn("Pty.subscribeToTitleChange")(function* (
    id: PtyId,
    callback: (title: string) => void
  ) {
    const session = yield* getSessionOrFail(id)
    session.titleSubscribers.add(callback)
    // Immediately call with current title if set
    const currentTitle = session.emulator.getTitle()
    if (currentTitle) {
      callback(currentTitle)
    }
    return () => {
      session.titleSubscribers.delete(callback)
    }
  })

  const subscribeToAllTitleChanges = Effect.fn("Pty.subscribeToAllTitleChanges")(function* (
    callback: (event: { ptyId: PtyId; title: string }) => void
  ) {
    return yield* globalTitleRegistry.subscribe(callback)
  })

  return {
    subscribe,
    subscribeToScroll,
    subscribeUnified,
    onExit,
    getForegroundProcess: getForegroundProcessFn,
    getGitBranch: getGitBranchFn,
    subscribeToLifecycle,
    subscribeToTitleChange,
    subscribeToAllTitleChanges,
  }
}
