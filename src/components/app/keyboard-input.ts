import { useKeyboard } from '@opentui/solid'
import type { Accessor } from 'solid-js'
import type { KeyMode } from '../../core/types'
import type { SearchKeyboardDeps, KeyEvent as SearchKeyEvent } from './search-keyboard'
import type { KeyProcessorDeps, KeyEvent as NormalKeyEvent } from './key-processor'

interface KeyboardHandler {
  mode: KeyMode
  handleKeyDown: (event: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => boolean
}

interface KeyboardInputDeps {
  keyboardHandler: KeyboardHandler
  sessionPickerVisible: Accessor<boolean>
  clearAllSelections: () => void
  getFocusedCursorKeyMode: () => 'normal' | 'application'
  writeToFocused: (data: string) => void
  handleSearchKeyboard: (event: SearchKeyEvent, deps: SearchKeyboardDeps) => boolean
  routeKeyboardEventSync: (event: {
    key: string
    ctrl?: boolean
    alt?: boolean
    shift?: boolean
    sequence?: string
  }) => { handled: boolean }
  exitSearchMode: () => void
  keyboardExitSearchMode: () => void
  setSearchQuery: (query: string) => void
  nextMatch: () => void
  prevMatch: () => void
  getSearchState: SearchKeyboardDeps['getSearchState']
  processNormalModeKey: (event: NormalKeyEvent, deps: KeyProcessorDeps) => void
}

export function useAppKeyboardInput(deps: KeyboardInputDeps): void {
  useKeyboard(
    (event: { name: string; ctrl?: boolean; shift?: boolean; option?: boolean; meta?: boolean; sequence?: string }) => {
      const charCode = event.sequence?.charCodeAt(0) ?? 0
      const isPrintableChar = event.sequence?.length === 1 && charCode >= 32 && charCode < 127
      const keyToPass = isPrintableChar ? event.sequence! : event.name

      const routeResult = deps.routeKeyboardEventSync({
        key: keyToPass,
        ctrl: event.ctrl,
        alt: event.option,
        shift: event.shift,
        sequence: event.sequence,
      })

      if (routeResult.handled) {
        return
      }

      if (deps.keyboardHandler.mode === 'search') {
        deps.handleSearchKeyboard(event, {
          exitSearchMode: deps.exitSearchMode,
          keyboardExitSearchMode: deps.keyboardExitSearchMode,
          setSearchQuery: deps.setSearchQuery,
          nextMatch: deps.nextMatch,
          prevMatch: deps.prevMatch,
          getSearchState: deps.getSearchState,
        })
        return
      }

      const handled = deps.keyboardHandler.handleKeyDown({
        key: event.name,
        ctrl: event.ctrl,
        shift: event.shift,
        alt: event.option,
        meta: event.meta,
      })

      if (!handled && deps.keyboardHandler.mode === 'normal' && !deps.sessionPickerVisible()) {
        deps.processNormalModeKey(event, {
          clearAllSelections: deps.clearAllSelections,
          getFocusedCursorKeyMode: deps.getFocusedCursorKeyMode,
          writeToFocused: deps.writeToFocused,
        })
      }
    }
  )
}
