/**
 * Query passthrough setup for PTY sessions
 * Configures the TerminalQueryPassthrough with all necessary getters/setters
 */
import type { IPty } from "../../../../zig-pty/ts/index"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"
import type { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"

interface QuerySetupOptions {
  queryPassthrough: TerminalQueryPassthrough
  emulator: ITerminalEmulator
  pty: IPty
  getSessionDimensions: () => { cols: number; rows: number }
  terminalVersion?: string
}

/**
 * Sets up the query passthrough with all necessary callbacks
 * This handles terminal queries like cursor position, device attributes, colors, etc.
 */
export function setupQueryPassthrough(options: QuerySetupOptions): void {
  const {
    queryPassthrough,
    emulator,
    pty,
    getSessionDimensions,
    terminalVersion = "0.1.16",
  } = options

  // Set up query passthrough - writes responses back to PTY
  queryPassthrough.setPtyWriter((response: string) => {
    pty.write(response)
  })

  queryPassthrough.setCursorGetter(() => {
    const cursor = emulator.getCursor()
    return { x: cursor.x, y: cursor.y }
  })

  queryPassthrough.setColorsGetter(() => {
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
      return emulator.getMode(mode)
    } catch {
      return null
    }
  })

  // Set Kitty keyboard flags getter (for ESC[?u queries)
  queryPassthrough.setKittyKeyboardFlagsGetter(() => {
    return emulator.getKittyKeyboardFlags()
  })

  // Set terminal version for XTVERSION responses
  queryPassthrough.setTerminalVersion(terminalVersion)

  // Set size getter for XTWINOPS queries
  queryPassthrough.setSizeGetter(() => {
    const { cols, rows } = getSessionDimensions()
    // Estimate cell size (typical terminal font is ~8x16 pixels)
    const cellWidth = 8
    const cellHeight = 16
    return {
      cols,
      rows,
      pixelWidth: cols * cellWidth,
      pixelHeight: rows * cellHeight,
      cellWidth,
      cellHeight,
    }
  })
}
