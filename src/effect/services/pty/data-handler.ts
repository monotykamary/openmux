/**
 * PTY data handler factory - creates the data processing pipeline
 * Handles sync mode parsing, graphics passthrough, and query passthrough.
 */
import type { SyncModeParser } from "../../../terminal/sync-mode-parser"
import type { InternalPtySession } from "./types"
import { deferMacrotask } from "../../../core/scheduling"

interface DataHandlerOptions {
  session: InternalPtySession
  syncParser: SyncModeParser
  commandParser?: { processData: (data: string) => void }
  syncTimeoutMs?: number
}

interface DataHandlerState {
  pendingSegments: string[]
  syncTimeout: ReturnType<typeof setTimeout> | null
}

/**
 * Creates the PTY data handler that processes incoming data
 * Returns the data handler function and cleanup function
 */
export function createDataHandler(options: DataHandlerOptions) {
  const { session, syncParser, commandParser, syncTimeoutMs = 100 } = options
  const maxSegmentsPerTick = 8
  const maxCharsPerTick = 32_768
  const maxBudgetMs = 4
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

  const state: DataHandlerState = {
    pendingSegments: [],
    syncTimeout: null,
  }

  const drainPending = () => {
    session.pendingNotify = false

    if (session.emulator.isDisposed) {
      state.pendingSegments = []
      return
    }

    if (state.pendingSegments.length === 0) {
      return
    }

    const start = now()
    let batch = ""
    let batchLen = 0
    let segmentsProcessed = 0

    while (state.pendingSegments.length > 0) {
      const segment = state.pendingSegments[0]
      if (segment.length === 0) {
        state.pendingSegments.shift()
        continue
      }

      if (batchLen > 0 && batchLen + segment.length > maxCharsPerTick) {
        break
      }

      batch += segment
      batchLen += segment.length
      segmentsProcessed += 1
      state.pendingSegments.shift()

      if (segmentsProcessed >= maxSegmentsPerTick) break
      if (batchLen >= maxCharsPerTick) break
      if (now() - start >= maxBudgetMs) break
    }

    if (batchLen === 0 && state.pendingSegments.length > 0) {
      batch = state.pendingSegments.shift() ?? ""
    }

    if (batch.length > 0) {
      session.emulator.write(batch)
    }

    if (state.pendingSegments.length > 0) {
      scheduleNotify()
    }
  }

  // Helper to schedule notification (uses macrotask to yield for rendering)
  const scheduleNotify = () => {
    if (!session.pendingNotify) {
      session.pendingNotify = true
      deferMacrotask(drainPending)
    }
  }

  // The data handler function
  const handleData = (data: string) => {
    // First, handle terminal queries (cursor position, device attributes, colors, etc.)
    // This must happen before graphics passthrough to intercept queries
    const afterQueries = session.queryPassthrough.process(data)

    // Then handle graphics passthrough (Kitty graphics, Sixel)
    const textData = session.graphicsPassthrough.process(afterQueries)
    if (commandParser) {
      commandParser.processData(textData)
    }

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
            state.pendingSegments.push(flushed)
            scheduleNotify()
          }
          state.syncTimeout = null
        }, syncTimeoutMs)
      }
    } else if (state.syncTimeout) {
      clearTimeout(state.syncTimeout)
      state.syncTimeout = null
    }

    // Add ready segments to pending queue
    for (const segment of readySegments) {
      if (segment.length > 0) {
        state.pendingSegments.push(segment)
      }
    }

    // Only schedule notification if we have data and aren't buffering
    // When buffering, we wait for the complete frame before notifying
    if (!isBuffering && state.pendingSegments.length > 0) {
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
