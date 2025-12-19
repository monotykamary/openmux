/**
 * PTY Operations - core operations for managing PTY sessions
 */
import { Effect, Ref, HashMap, Option } from "effect"
import type { TerminalState } from "../../../core/types"
import { PtyNotFoundError, PtyCwdError } from "../../errors"
import { PtyId, Cols, Rows } from "../../types"
import { PtySession } from "../../models"
import type { InternalPtySession } from "./types"
import { notifySubscribers, notifyScrollSubscribers } from "./notification"
import { getProcessCwd } from "./helpers"
import type { SubscriptionRegistry } from "./subscription-manager"

export interface OperationsDeps {
  sessionsRef: Ref.Ref<HashMap.HashMap<PtyId, InternalPtySession>>
  getSessionOrFail: (id: PtyId) => Effect.Effect<InternalPtySession, PtyNotFoundError>
  lifecycleRegistry: SubscriptionRegistry<{ type: 'created' | 'destroyed'; ptyId: PtyId }>
}

export function createOperations(deps: OperationsDeps) {
  const { sessionsRef, getSessionOrFail, lifecycleRegistry } = deps

  const write = Effect.fn("Pty.write")(function* (id: PtyId, data: string) {
    const session = yield* getSessionOrFail(id)

    // Auto-scroll to bottom when user types
    if (session.scrollState.viewportOffset > 0) {
      session.scrollState.viewportOffset = 0
      notifySubscribers(session)
      notifyScrollSubscribers(session)
    }

    session.pty.write(data)
  })

  const resize = Effect.fn("Pty.resize")(function* (
    id: PtyId,
    cols: Cols,
    rows: Rows
  ) {
    const session = yield* getSessionOrFail(id)

    session.pty.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    session.emulator.resize(cols, rows)

    // Check if DECSET 2048 (in-band resize notifications) is enabled
    yield* Effect.try(() => {
      const inBandResizeEnabled = session.emulator.getMode(2048)
      if (inBandResizeEnabled) {
        const cellWidth = 8
        const cellHeight = 16
        const pixelWidth = cols * cellWidth
        const pixelHeight = rows * cellHeight
        const resizeNotification = `\x1b[48;${rows};${cols};${pixelHeight};${pixelWidth}t`
        session.pty.write(resizeNotification)
      }
    }).pipe(Effect.ignore)

    notifySubscribers(session)
  })

  const getCwd = Effect.fn("Pty.getCwd")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)

    if (session.pty.pid === undefined) {
      return session.cwd
    }

    return yield* getProcessCwd(session.pty.pid).pipe(
      Effect.catchAll(() => Effect.succeed(session.cwd))
    )
  })

  const destroy = Effect.fn("Pty.destroy")(function* (id: PtyId) {
    const destroyStart = performance.now()
    const sessions = yield* Ref.get(sessionsRef)
    const sessionOpt = HashMap.get(sessions, id)

    if (Option.isSome(sessionOpt)) {
      const session = sessionOpt.value

      // Clear subscribers
      const subStart = performance.now()
      for (const callback of session.subscribers) {
        callback(null as unknown as TerminalState)
      }
      session.subscribers.clear()
      console.log(`[PTY.destroy] clearSubscribers: ${(performance.now() - subStart).toFixed(2)}ms`)

      // Kill PTY and dispose emulator
      const killStart = performance.now()
      session.pty.kill()
      console.log(`[PTY.destroy] pty.kill: ${(performance.now() - killStart).toFixed(2)}ms`)

      const disposeStart = performance.now()
      session.emulator.dispose()
      console.log(`[PTY.destroy] emulator.dispose: ${(performance.now() - disposeStart).toFixed(2)}ms`)

      const queryStart = performance.now()
      session.queryPassthrough.dispose()
      console.log(`[PTY.destroy] queryPassthrough.dispose: ${(performance.now() - queryStart).toFixed(2)}ms`)

      // Remove from map BEFORE emitting lifecycle event
      const refStart = performance.now()
      yield* Ref.update(sessionsRef, HashMap.remove(id))
      console.log(`[PTY.destroy] Ref.update: ${(performance.now() - refStart).toFixed(2)}ms`)

      // Emit lifecycle event AFTER removal
      const notifyStart = performance.now()
      yield* lifecycleRegistry.notify({ type: 'destroyed', ptyId: id })
      console.log(`[PTY.destroy] lifecycleRegistry.notify: ${(performance.now() - notifyStart).toFixed(2)}ms`)
    }
    console.log(`[PTY.destroy] total: ${(performance.now() - destroyStart).toFixed(2)}ms`)
  })

  const getSession = Effect.fn("Pty.getSession")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)

    return PtySession.make({
      id: session.id,
      pid: session.pty.pid ?? 0,
      cols: Cols.make(session.cols),
      rows: Rows.make(session.rows),
      cwd: session.cwd,
      shell: session.shell,
    })
  })

  const getTerminalState = Effect.fn("Pty.getTerminalState")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    return session.emulator.getTerminalState()
  })

  const setPanePosition = Effect.fn("Pty.setPanePosition")(function* (
    id: PtyId,
    x: number,
    y: number
  ) {
    const session = yield* getSessionOrFail(id)
    session.graphicsPassthrough.setPanePosition(x, y)
  })

  const getScrollState = Effect.fn("Pty.getScrollState")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    const scrollbackLength = session.emulator.getScrollbackLength()

    return {
      viewportOffset: session.scrollState.viewportOffset,
      scrollbackLength,
      isAtBottom: session.scrollState.viewportOffset === 0,
    }
  })

  const setScrollOffset = Effect.fn("Pty.setScrollOffset")(function* (
    id: PtyId,
    offset: number
  ) {
    const session = yield* getSessionOrFail(id)
    const maxOffset = session.emulator.getScrollbackLength()
    session.scrollState.viewportOffset = Math.max(0, Math.min(offset, maxOffset))
    notifyScrollSubscribers(session)
  })

  const getEmulator = Effect.fn("Pty.getEmulator")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    return session.emulator
  })

  const destroyAll = Effect.fn("Pty.destroyAll")(function* () {
    const sessions = yield* Ref.get(sessionsRef)
    const ids = Array.from(HashMap.keys(sessions))

    for (const id of ids) {
      yield* destroy(id)
    }
  })

  const listAll = Effect.fn("Pty.listAll")(function* () {
    const sessions = yield* Ref.get(sessionsRef)
    return Array.from(HashMap.keys(sessions))
  })

  const getTitle = Effect.fn("Pty.getTitle")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    return session.emulator.getTitle()
  })

  return {
    write,
    resize,
    getCwd,
    destroy,
    getSession,
    getTerminalState,
    setPanePosition,
    getScrollState,
    setScrollOffset,
    getEmulator,
    destroyAll,
    listAll,
    getTitle,
  }
}
