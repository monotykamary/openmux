/**
 * Key Processor - processes keyboard input in normal mode
 * Converts keyboard events to terminal escape sequences
 */
import type { ITerminalEmulator } from '../../terminal/emulator-interface'
import { encodeKeyForEmulator } from '../../terminal/key-encoder'

export interface KeyProcessorDeps {
  clearAllSelections: () => void
  getFocusedEmulator: () => ITerminalEmulator | null
  writeToFocused: (data: string) => void
}

export interface KeyEvent {
  name: string
  ctrl?: boolean
  shift?: boolean
  option?: boolean
  meta?: boolean
  sequence?: string
  baseCode?: number
}

/**
 * Process keyboard input in normal mode and forward to PTY
 */
export function processNormalModeKey(
  event: KeyEvent,
  deps: KeyProcessorDeps
): void {
  // Clear any active selection when user types
  deps.clearAllSelections()

  const emulator = deps.getFocusedEmulator()
  const sequence = encodeKeyForEmulator(
    {
      key: event.name,
      ctrl: event.ctrl,
      shift: event.shift,
      alt: event.option,
      meta: event.meta,
      sequence: event.sequence,
      baseCode: event.baseCode,
    },
    emulator
  )

  if (sequence) {
    deps.writeToFocused(sequence)
  }
}
