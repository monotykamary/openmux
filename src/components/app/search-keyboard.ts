/**
 * Search Mode Keyboard Handler
 * Handles keyboard input when the terminal is in search mode
 */
import type { SearchState } from '../../contexts/search/types'
import { matchKeybinding, type ResolvedKeybindingMap } from '../../core/keybindings'

export interface SearchKeyboardDeps {
  exitSearchMode: (restore: boolean) => void
  keyboardExitSearchMode: () => void
  setSearchQuery: (query: string) => void
  nextMatch: () => void
  prevMatch: () => void
  getSearchState: () => SearchState | null
  keybindings: ResolvedKeybindingMap
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
  const action = matchKeybinding(deps.keybindings, {
    key: event.name,
    ctrl: event.ctrl,
    alt: event.option,
    shift: event.shift,
    meta: event.meta,
  })

  switch (action) {
    case 'search.cancel':
      deps.exitSearchMode(true)
      deps.keyboardExitSearchMode()
      return true
    case 'search.confirm':
      deps.exitSearchMode(false)
      deps.keyboardExitSearchMode()
      return true
    default:
      break
  }

  // Wait for searchState to be initialized before handling navigation/input
  const currentSearchState = deps.getSearchState()
  if (!currentSearchState) {
    return true // Consume key but don't process
  }

  if (action === 'search.next') {
    deps.nextMatch()
    return true
  }

  if (action === 'search.prev') {
    deps.prevMatch()
    return true
  }

  if (action === 'search.delete') {
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
