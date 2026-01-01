/**
 * Query passthrough setup for PTY sessions
 * Configures the TerminalQueryPassthrough with all necessary getters/setters
 */
import type { IPty } from "../../../../native/zig-pty/ts/index"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"
import type { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"
import { tracePtyChunk, tracePtyEvent } from "../../../terminal/pty-trace"
import { getKittyTransmitBroker, KittyTransmitRelay } from "../../../terminal/kitty-graphics"
import { isShimProcess } from "../../../shim/mode"
import { getKittyTransmitForwarder, getKittyUpdateForwarder } from "../../../shim/kitty-forwarder"

interface QuerySetupOptions {
  queryPassthrough: TerminalQueryPassthrough
  emulator: ITerminalEmulator
  pty: IPty
  ptyId?: string
  getSessionDimensions: () => { cols: number; rows: number }
  getPixelDimensions?: () => { pixelWidth: number; pixelHeight: number; cellWidth: number; cellHeight: number }
  terminalVersion?: string
}

/**
 * Sets up the query passthrough with all necessary callbacks
 * This handles terminal queries like cursor position, device attributes, colors, etc.
 */
export function setupQueryPassthrough(options: QuerySetupOptions): (() => void) | null {
  const {
    queryPassthrough,
    emulator,
    pty,
    ptyId,
    getSessionDimensions,
    getPixelDimensions,
    terminalVersion = "0.1.16",
  } = options

  // Set up query passthrough - writes responses back to PTY
  queryPassthrough.setPtyWriter((response: string) => {
    tracePtyChunk("pty-query-response", response, { ptyId })
    pty.write(response)
    tracePtyEvent("pty-write-complete", { ptyId, responseLen: response.length })
  })

  queryPassthrough.setCursorGetter(() => {
    if (emulator.isDisposed) return { x: 0, y: 0 }
    const cursor = emulator.getCursor()
    return { x: cursor.x, y: cursor.y }
  })

  queryPassthrough.setColorsGetter(() => {
    if (emulator.isDisposed) {
      return { foreground: 0xFFFFFF, background: 0x000000 }
    }
    const termColors = emulator.getColors()
    return {
      foreground: termColors.foreground,
      background: termColors.background,
    }
  })

  // Set mode getter to query DEC private modes from emulator
  queryPassthrough.setModeGetter((mode: number) => {
    // Query the mode from ghostty emulator
    // Returns true if set, false if reset
    try {
      if (emulator.isDisposed) return null
      return emulator.getMode(mode)
    } catch {
      return null
    }
  })

  // Set Kitty keyboard flags getter (for ESC[?u queries)
  queryPassthrough.setKittyKeyboardFlagsGetter(() => {
    if (emulator.isDisposed) return 0
    return emulator.getKittyKeyboardFlags()
  })

  let relayCleanup: (() => void) | null = null
  if (ptyId) {
    if (isShimProcess()) {
      const relay = new KittyTransmitRelay({ stubPng: true })
      queryPassthrough.setKittySequenceHandler((sequence) => {
        const result = relay.handleSequence(String(ptyId), sequence)
        const forwarder = getKittyTransmitForwarder()
        if (forwarder && result.forwardSequence) {
          forwarder(String(ptyId), result.forwardSequence)
        }
        const updateForwarder = getKittyUpdateForwarder()
        if (updateForwarder) {
          queueMicrotask(() => updateForwarder(String(ptyId)))
        }
        return result.emuSequence
      })
      relayCleanup = () => relay.dispose()
    } else {
      queryPassthrough.setKittySequenceHandler((sequence) => {
        const broker = getKittyTransmitBroker()
        return broker ? broker.handleSequence(String(ptyId), sequence) : sequence
      })
    }
  }

  // Set terminal version for XTVERSION responses
  queryPassthrough.setTerminalVersion(terminalVersion)

  // Set size getter for XTWINOPS queries
  queryPassthrough.setSizeGetter(() => {
    const { cols, rows } = getSessionDimensions()
    const pixels = getPixelDimensions?.()
    if (emulator.isDisposed) {
      const fallbackWidth = pixels?.cellWidth || 8
      const fallbackHeight = pixels?.cellHeight || 16
      return {
        cols,
        rows,
        pixelWidth: cols * fallbackWidth,
        pixelHeight: rows * fallbackHeight,
        cellWidth: fallbackWidth,
        cellHeight: fallbackHeight,
      }
    }
    const cellWidth = pixels?.cellWidth || 8
    const cellHeight = pixels?.cellHeight || 16
    return {
      cols,
      rows,
      pixelWidth: pixels?.pixelWidth || cols * cellWidth,
      pixelHeight: pixels?.pixelHeight || rows * cellHeight,
      cellWidth,
      cellHeight,
    }
  })

  return relayCleanup
}
