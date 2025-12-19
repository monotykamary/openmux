/**
 * Key Processor - processes keyboard input in normal mode
 * Converts keyboard events to terminal escape sequences
 */
import { inputHandler } from '../../terminal'

export interface KeyProcessorDeps {
  clearAllSelections: () => void
  getFocusedCursorKeyMode: () => 'normal' | 'application'
  writeToFocused: (data: string) => void
}

export interface KeyEvent {
  name: string
  ctrl?: boolean
  shift?: boolean
  option?: boolean
  meta?: boolean
  sequence?: string
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

  // Get the focused pane's cursor key mode (DECCKM)
  // This affects how arrow keys are encoded (application vs normal mode)
  const cursorKeyMode = deps.getFocusedCursorKeyMode()
  inputHandler.setCursorMode(cursorKeyMode)

  // Convert keyboard event to terminal escape sequence
  // Use event.sequence for single printable chars (handles shift for uppercase/symbols)
  // Fall back to event.name for special keys (arrows, function keys, etc.)
  // Don't use sequence for control chars (< 32) or DEL (127) as we need name for Shift+Tab etc.
  const keyCharCode = event.sequence?.charCodeAt(0) ?? 0
  const isPrintable = event.sequence?.length === 1 && keyCharCode >= 32 && keyCharCode < 127
  const keyToEncode = isPrintable ? event.sequence! : event.name
  const sequence = inputHandler.encodeKey({
    key: keyToEncode,
    ctrl: event.ctrl,
    shift: event.shift,
    alt: event.option,
    meta: event.meta,
  })

  if (sequence) {
    deps.writeToFocused(sequence)
  }
}
