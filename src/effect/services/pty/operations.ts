/**
 * PTY Operations - core operations for managing PTY sessions
 */
import { Effect, Ref, HashMap, Option } from "effect"
import type { TerminalState } from "../../../core/types"
import type { PtyNotFoundError } from "../../errors"
import type { PtyId} from "../../types";
import { Cols, Rows } from "../../types"
import { PtySession } from "../../models"
import type { InternalPtySession } from "./types"
import { notifySubscribers, notifyScrollSubscribers } from "./notification"
import type { SubscriptionRegistry } from "./subscription-manager"
import { tracePtyEvent, tracePtyChunk } from "../../../terminal/pty-trace"

const FOCUS_IN_SEQUENCE = "\x1b[I"
const FOCUS_OUT_SEQUENCE = "\x1b[O"

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

  const sendFocusEvent = Effect.fn("Pty.sendFocusEvent")(function* (
    id: PtyId,
    focused: boolean
  ) {
    const session = yield* getSessionOrFail(id)
    session.focusState = focused
    const sequence = focused ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE
    tracePtyEvent("pty-focus-send", {
      ptyId: id,
      focused,
      trackingEnabled: session.focusTrackingEnabled,
    })
    tracePtyChunk("pty-focus-seq", sequence, { ptyId: id })
    if (!session.focusTrackingEnabled) return
    session.pty.write(sequence)
  })

  const resize = Effect.fn("Pty.resize")(function* (
    id: PtyId,
    cols: Cols,
    rows: Rows,
    pixelWidth?: number,
    pixelHeight?: number
  ) {
    const session = yield* getSessionOrFail(id)

    const hasPixels = typeof pixelWidth === "number" && pixelWidth > 0
      && typeof pixelHeight === "number" && pixelHeight > 0

    if (hasPixels && "resizeWithPixels" in session.pty) {
      session.pty.resizeWithPixels(cols, rows, pixelWidth, pixelHeight)
    } else {
      session.pty.resize(cols, rows)
    }
    session.cols = cols
    session.rows = rows
    if (hasPixels) {
      session.pixelWidth = pixelWidth
      session.pixelHeight = pixelHeight
      session.cellWidth = Math.max(1, Math.floor(pixelWidth / cols))
      session.cellHeight = Math.max(1, Math.floor(pixelHeight / rows))
    } else {
      session.pixelWidth = cols * session.cellWidth
      session.pixelHeight = rows * session.cellHeight
    }
    session.emulator.resize(cols, rows)
    session.emulator.setPixelSize?.(session.pixelWidth, session.pixelHeight)

    // Check if DECSET 2048 (in-band resize notifications) is enabled
    yield* Effect.try(() => {
      const inBandResizeEnabled = session.emulator.getMode(2048)
      if (inBandResizeEnabled) {
        const resizeNotification =
          `\x1b[48;${rows};${cols};${session.pixelHeight};${session.pixelWidth}t`
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

    // Use native zig-pty method directly (no subprocess spawning)
    const cwd = session.pty.getCwd()
    return cwd ?? session.cwd
  })

  const destroy = Effect.fn("Pty.destroy")(function* (id: PtyId) {
    const sessions = yield* Ref.get(sessionsRef)
    const sessionOpt = HashMap.get(sessions, id)

    if (Option.isSome(sessionOpt)) {
      const session = sessionOpt.value
      if (session.closing) {
        return
      }
      session.closing = true

      // Clear subscribers
      for (const callback of session.subscribers) {
        callback(null as unknown as TerminalState)
      }
      session.subscribers.clear()

      // Kill PTY and dispose emulator
      session.pty.kill()
      session.emulator.dispose()
      session.kittyRelayDispose?.()
      session.queryPassthrough.dispose()

      // Remove from map BEFORE emitting lifecycle event
      yield* Ref.update(sessionsRef, HashMap.remove(id))

      // Emit lifecycle event AFTER removal
      yield* lifecycleRegistry.notify({ type: 'destroyed', ptyId: id })
    }
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

  const setUpdateEnabled = Effect.fn("Pty.setUpdateEnabled")(function* (
    id: PtyId,
    enabled: boolean
  ) {
    const session = yield* getSessionOrFail(id)
    session.emulator.setUpdateEnabled?.(enabled)
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

  const getLastCommand = Effect.fn("Pty.getLastCommand")(function* (id: PtyId) {
    const session = yield* getSessionOrFail(id)
    return session.lastCommand ?? undefined
  })

  return {
    write,
    sendFocusEvent,
    resize,
    getCwd,
    destroy,
    getSession,
    getTerminalState,
    getScrollState,
    setScrollOffset,
    setUpdateEnabled,
    getEmulator,
    destroyAll,
    listAll,
    getTitle,
    getLastCommand,
  }
}
