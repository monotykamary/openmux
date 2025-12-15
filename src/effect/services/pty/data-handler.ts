/**
 * PTY data handler factory - creates the data processing pipeline
 * Handles sync mode parsing, graphics passthrough, query passthrough,
 * and DECSET 2048 (in-band resize) mode detection.
 */
import type { IPty } from "../../../../zig-pty/src/index"
import type { SyncModeParser } from "../../../terminal/sync-mode-parser"
import type { InternalPtySession } from "./types"
import { notifySubscribers } from "./notification"

interface DataHandlerOptions {
  session: InternalPtySession
  pty: IPty
  syncParser: SyncModeParser
  syncTimeoutMs?: number
}

interface DataHandlerState {
  pendingData: string
  syncTimeout: ReturnType<typeof setTimeout> | null
  lastInBandResizeMode: boolean
  pendingMightEnable2048: boolean
}

/**
 * Creates the PTY data handler that processes incoming data
 * Returns the data handler function and cleanup function
 */
export function createDataHandler(options: DataHandlerOptions) {
  const { session, pty, syncParser, syncTimeoutMs = 100 } = options

  const state: DataHandlerState = {
    pendingData: "",
    syncTimeout: null,
    lastInBandResizeMode: false,
    pendingMightEnable2048: false,
  }

  // Helper to schedule notification (uses queueMicrotask for tight timing)
  const scheduleNotify = () => {
    if (!session.pendingNotify) {
      session.pendingNotify = true
      queueMicrotask(() => {
        // Guard: check if emulator was disposed before microtask ran
        if (session.emulator.isDisposed) {
          session.pendingNotify = false
          state.pendingData = ""
          return
        }

        // Capture whether we need to check for DECSET 2048 mode transition
        const checkFor2048 = state.pendingMightEnable2048
        state.pendingMightEnable2048 = false

        // Write all pending data at once
        if (state.pendingData.length > 0) {
          // Capture scrollback length before write to detect new lines
          const scrollbackBefore = session.emulator.getScrollbackLength()

          session.emulator.write(state.pendingData)
          state.pendingData = ""

          // If user is scrolled back, adjust offset to maintain view position
          // when new lines are added to scrollback (prevents content from shifting up)
          if (session.scrollState.viewportOffset > 0) {
            const scrollbackAfter = session.emulator.getScrollbackLength()
            const scrollbackDelta = scrollbackAfter - scrollbackBefore
            if (scrollbackDelta > 0) {
              session.scrollState.viewportOffset += scrollbackDelta
            }
          }
        }

        // Check for DECSET 2048 mode transition AFTER data is written to emulator
        // Per the spec, when mode 2048 is enabled, we must immediately send
        // a report of the current terminal size (CSI 48 notification)
        if (checkFor2048) {
          try {
            const currentInBandMode = session.emulator.getMode(2048)
            if (currentInBandMode && !state.lastInBandResizeMode) {
              // Mode just got enabled - send initial size notification
              const cellWidth = 8
              const cellHeight = 16
              const pixelWidth = session.cols * cellWidth
              const pixelHeight = session.rows * cellHeight
              const resizeNotification = `\x1b[48;${session.rows};${session.cols};${pixelHeight};${pixelWidth}t`
              pty.write(resizeNotification)
            }
            state.lastInBandResizeMode = currentInBandMode
          } catch {
            // Mode query may fail, ignore
          }
        }

        notifySubscribers(session)
        session.pendingNotify = false
      })
    }
  }

  // The data handler function
  const handleData = (data: string) => {
    // Check if this data contains DECSET 2048 (CSI ? 2048 h) - in-band resize enable
    // We need to detect mode transitions to send the initial size report
    const decset2048Pattern = /\x1b\[\?2048h/
    if (decset2048Pattern.test(data)) {
      state.pendingMightEnable2048 = true
    }

    // First, handle terminal queries (cursor position, device attributes, colors, etc.)
    // This must happen before graphics passthrough to intercept queries
    const afterQueries = session.queryPassthrough.process(data)

    // Then handle graphics passthrough (Kitty graphics, Sixel)
    const textData = session.graphicsPassthrough.process(afterQueries)

    // Process through sync mode parser to respect frame boundaries
    // This buffers content between CSI ? 2026 h and CSI ? 2026 l
    const { readySegments, isBuffering } = syncParser.process(textData)

    // Handle sync buffering timeout (safety valve)
    if (isBuffering) {
      if (!state.syncTimeout) {
        state.syncTimeout = setTimeout(() => {
          // Safety flush - sync mode took too long (app may have crashed)
          const flushed = syncParser.flush()
          if (flushed.length > 0) {
            state.pendingData += flushed
            scheduleNotify()
          }
          state.syncTimeout = null
        }, syncTimeoutMs)
      }
    } else if (state.syncTimeout) {
      clearTimeout(state.syncTimeout)
      state.syncTimeout = null
    }

    // Add ready segments to pending data
    for (const segment of readySegments) {
      if (segment.length > 0) {
        state.pendingData += segment
      }
    }

    // Only schedule notification if we have data and aren't buffering
    // When buffering, we wait for the complete frame before notifying
    if (!isBuffering && state.pendingData.length > 0) {
      scheduleNotify()
    }
  }

  // Cleanup function to clear any pending timeouts
  const cleanup = () => {
    if (state.syncTimeout) {
      clearTimeout(state.syncTimeout)
      state.syncTimeout = null
    }
  }

  return { handleData, cleanup, scheduleNotify }
}
