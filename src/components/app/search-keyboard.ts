/**
 * Search Mode Keyboard Handler
 * Handles keyboard input when the terminal is in search mode
 */
import type { SearchState } from '../../contexts/search/types'

export interface SearchKeyboardDeps {
  exitSearchMode: (restore: boolean) => void
  keyboardExitSearchMode: () => void
  setSearchQuery: (query: string) => void
  nextMatch: () => void
  prevMatch: () => void
  getSearchState: () => SearchState | null
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
 * Handle keyboard input in search mode
 * @returns true if the key was handled, false if not
 */
export function handleSearchKeyboard(
  event: KeyEvent,
  deps: SearchKeyboardDeps
): boolean {
  const key = event.name.toLowerCase()

  if (key === 'escape') {
    // Cancel search, restore original scroll position
    deps.exitSearchMode(true)
    deps.keyboardExitSearchMode()
    return true
  }

  if (key === 'return' || key === 'enter') {
    // Confirm search, stay at current position
    deps.exitSearchMode(false)
    deps.keyboardExitSearchMode()
    return true
  }

  // Wait for searchState to be initialized before handling navigation/input
  const currentSearchState = deps.getSearchState()
  if (!currentSearchState) {
    return true // Consume key but don't process
  }

  if (key === 'n' && event.ctrl && !event.shift && !event.option) {
    // Next match (Ctrl+n)
    deps.nextMatch()
    return true
  }

  if ((key === 'n' && event.ctrl && event.shift) || (key === 'p' && event.ctrl)) {
    // Previous match (Ctrl+Shift+N or Ctrl+p)
    deps.prevMatch()
    return true
  }

  if (key === 'backspace') {
    // Delete last character from query
    deps.setSearchQuery(currentSearchState.query.slice(0, -1))
    return true
  }

  // Single printable character - add to search query
  const searchCharCode = event.sequence?.charCodeAt(0) ?? 0
  const isPrintable = event.sequence?.length === 1 && searchCharCode >= 32 && searchCharCode < 127
  if (isPrintable && !event.ctrl && !event.option && !event.meta) {
    deps.setSearchQuery(currentSearchState.query + event.sequence)
    return true
  }

  // Consume all other keys in search mode
  return true
}
