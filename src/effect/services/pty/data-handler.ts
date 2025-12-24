/**
 * PTY data handler factory - creates the data processing pipeline
 * Handles sync mode parsing, graphics passthrough, and query passthrough.
 */
import type { SyncModeParser } from "../../../terminal/sync-mode-parser"
import type { InternalPtySession } from "./types"

interface DataHandlerOptions {
  session: InternalPtySession
  syncParser: SyncModeParser
  syncTimeoutMs?: number
}

interface DataHandlerState {
  pendingData: string
  syncTimeout: ReturnType<typeof setTimeout> | null
}

/**
 * Creates the PTY data handler that processes incoming data
 * Returns the data handler function and cleanup function
 */
export function createDataHandler(options: DataHandlerOptions) {
  const { session, syncParser, syncTimeoutMs = 100 } = options

  const state: DataHandlerState = {
    pendingData: "",
    syncTimeout: null,
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

        // Write all pending data at once
        if (state.pendingData.length > 0) {
          session.emulator.write(state.pendingData)
          state.pendingData = ""
          // Note: Scroll position adjustment for maintaining view while scrolled back
          // is handled in getCurrentScrollState() in notification.ts. This works for
          // both sync and async emulators by tracking lastScrollbackLength in the session.
        }

        // Note: notifySubscribers is called via emulator.onUpdate() callback
        // This ensures proper timing for both sync and async emulators
        session.pendingNotify = false
      })
    }
  }

  // The data handler function
  const handleData = (data: string) => {
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
