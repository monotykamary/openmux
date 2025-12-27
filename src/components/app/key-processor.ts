/**
 * Key Processor - processes keyboard input in normal mode
 * Converts keyboard events to terminal escape sequences
 */
import type { ITerminalEmulator } from '../../terminal/emulator-interface'
import type { KeyboardEvent } from '../../core/keyboard-event'
import { encodeKeyForEmulator } from '../../terminal/key-encoder'

export interface KeyProcessorDeps {
  clearAllSelections: () => void
  getFocusedEmulator: () => ITerminalEmulator | null
  writeToFocused: (data: string) => void
  closePane: () => void
}

/**
 * Process keyboard input in normal mode and forward to PTY
 */
export function processNormalModeKey(
  event: KeyboardEvent,
  deps: KeyProcessorDeps
): void {
  // Detect Ctrl+D and close pane immediately
  if (
    event.ctrl &&
    !event.alt &&
    !event.shift &&
    !event.meta &&
    event.key.toLowerCase() === 'd' &&
    event.eventType !== 'release'
  ) {
    deps.closePane()
    return
  }

  // Clear any active selection when user types
  if (event.eventType !== "release") {
    deps.clearAllSelections()
  }

  const emulator = deps.getFocusedEmulator()
  const sequence = encodeKeyForEmulator(
    {
      key: event.key,
      ctrl: event.ctrl,
      shift: event.shift,
      alt: event.alt,
      meta: event.meta,
      sequence: event.sequence,
      baseCode: event.baseCode,
      eventType: event.eventType,
      repeated: event.repeated,
    },
    emulator
  )

  if (sequence) {
    deps.writeToFocused(sequence)
  }
}
