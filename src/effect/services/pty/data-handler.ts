/**
 * PTY data handler factory - creates the data processing pipeline
 * Handles sync mode parsing and query passthrough.
 */
import type { SyncModeParser } from "../../../terminal/sync-mode-parser"
import type { InternalPtySession } from "./types"
import { deferMacrotask } from "../../../core/scheduling"
import { tracePtyChunk, tracePtyEvent } from "../../../terminal/pty-trace"

interface DataHandlerOptions {
  session: InternalPtySession
  syncParser: SyncModeParser
  commandParser?: { processData: (data: string) => void }
  syncTimeoutMs?: number
}

interface DataHandlerState {
  pendingSegments: string[]
  syncTimeout: ReturnType<typeof setTimeout> | null
  pendingResponses: { fence: number; responses: string[] }[]
  segmentCounter: number
  processedCounter: number
}

const ESC = "\x1b"
const APC_C1 = "\x9f"
const FOCUS_TRACKING_ENABLE = "\x1b[?1004h"
const FOCUS_TRACKING_DISABLE = "\x1b[?1004l"
const FOCUS_TRACKING_ENABLE_C1 = "\x9b?1004h"
const FOCUS_TRACKING_DISABLE_C1 = "\x9b?1004l"
const FOCUS_IN_SEQUENCE = "\x1b[I"
const FOCUS_OUT_SEQUENCE = "\x1b[O"
const FOCUS_TRACKING_PROBE_LEN = 16

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
    pendingResponses: [],
    segmentCounter: 0,
    processedCounter: 0,
  }
  let kittyProbeBuffer = ""
  let focusProbeBuffer = ""

  const analyzeKitty = (data: string): { hasKittyApc: boolean; hasKittyQuery: boolean } => {
    if (data.length === 0) return { hasKittyApc: false, hasKittyQuery: false }
    const combined = kittyProbeBuffer + data
    kittyProbeBuffer = combined.slice(-256)
    const hasKittyApc = combined.includes(`${ESC}_G`) || combined.includes(`${APC_C1}G`)
    const hasKittyQuery = hasKittyApc && combined.includes("a=q")
    return { hasKittyApc, hasKittyQuery }
  }

  const updateFocusTracking = (data: string) => {
    if (data.length === 0) return
    const combined = focusProbeBuffer + data

    const lastEnable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE),
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE_C1)
    )
    const lastDisable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE),
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE_C1)
    )

    if (lastEnable !== -1 || lastDisable !== -1) {
      const wasEnabled = session.focusTrackingEnabled
      session.focusTrackingEnabled = lastEnable > lastDisable

      if (session.focusTrackingEnabled !== wasEnabled) {
        tracePtyEvent("pty-focus-tracking", {
          ptyId: session.id,
          enabled: session.focusTrackingEnabled,
        })
      }

      if (!wasEnabled && session.focusTrackingEnabled) {
        tracePtyEvent("pty-focus-sync", {
          ptyId: session.id,
          focused: session.focusState,
        })
        session.pty.write(session.focusState ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE)
      }
    }

    focusProbeBuffer = combined.slice(-FOCUS_TRACKING_PROBE_LEN)
  }

  const flushPendingResponses = () => {
    while (state.pendingResponses.length > 0) {
      const next = state.pendingResponses[0]
      if (next.fence > state.processedCounter) break
      state.pendingResponses.shift()
      for (const response of next.responses) {
        session.pty.write(response)
      }
    }
  }

  const drainPending = (options?: { force?: boolean }) => {
    session.pendingNotify = false

    if (session.emulator.isDisposed) {
      state.pendingSegments = []
      return
    }

    if (state.pendingSegments.length === 0) {
      flushPendingResponses()
      return
    }

    const force = options?.force ?? false
    const start = now()
    let batch = ""
    let batchLen = 0
    let segmentsProcessed = 0
    let wrote = false

    if (force) {
      while (state.pendingSegments.length > 0) {
        const segment = state.pendingSegments.shift() ?? ""
        if (segment.length === 0) continue
        session.emulator.write(segment)
        wrote = true
        segmentsProcessed += 1
      }
    } else {
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
        wrote = true
      }
    }

    if (wrote && !session.emulator.isDisposed) {
      const responses = session.emulator.drainResponses?.()
      if (responses && responses.length > 0) {
        for (const response of responses) {
          tracePtyChunk("emulator-response", response, { ptyId: session.id })
          session.pty.write(response)
        }
      }
    }

    if (segmentsProcessed > 0) {
      state.processedCounter += segmentsProcessed
      flushPendingResponses()
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
    tracePtyChunk("pty-in", data, { ptyId: session.id })
    updateFocusTracking(data)
    const kittySignals = analyzeKitty(data)
    const hasKittyQuery = kittySignals.hasKittyQuery
    let textData: string
    let deferredResponses: string[] | null = null

    // Handle terminal queries (cursor position, device attributes, colors, etc.)
    if (hasKittyQuery && "processWithResponses" in session.queryPassthrough) {
      const processed = session.queryPassthrough.processWithResponses(data)
      textData = processed.text
      deferredResponses = processed.responses
    } else {
      textData = session.queryPassthrough.process(data)
    }

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
    let segmentsAdded = 0
    for (const segment of readySegments) {
      if (segment.length > 0) {
        state.pendingSegments.push(segment)
        segmentsAdded += 1
      }
    }
    if (segmentsAdded > 0) {
      state.segmentCounter += segmentsAdded
    }

    if (deferredResponses && deferredResponses.length > 0) {
      for (const response of deferredResponses) {
        tracePtyChunk("pty-query-response", response, {
          ptyId: session.id,
          deferred: true,
        })
      }
      state.pendingResponses.push({
        fence: state.segmentCounter,
        responses: deferredResponses,
      })
      if (state.pendingSegments.length === 0) {
        flushPendingResponses()
      }
    }

    // Only schedule notification if we have data and aren't buffering
    // When buffering, we wait for the complete frame before notifying
    if (!isBuffering && state.pendingSegments.length > 0) {
      if (kittySignals.hasKittyApc) {
        drainPending({ force: true })
      } else {
        scheduleNotify()
      }
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
