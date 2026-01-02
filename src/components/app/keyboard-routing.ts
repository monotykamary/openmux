import { useKeyboard } from '@opentui/solid';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { OpenTuiKeyEvent } from './keyboard-utils';
import { normalizeKeyEvent } from './keyboard-utils';
import { handleSearchKeyboard } from './search-keyboard';
import { processNormalModeKey } from './key-processor';
import { routeKeyboardEventSync } from '../../effect/bridge';
import type { ResolvedKeybindingMap } from '../../core/keybindings';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { SearchState } from '../../contexts/search/types';

export function setupKeyboardRouting(params: {
  config: { keybindings: () => { search: ResolvedKeybindingMap } };
  keyboardHandler: {
    mode: string;
    handleKeyDown: (event: KeyboardEvent) => boolean;
  };
  keyboardExitSearchMode: () => void;
  exitSearchMode: () => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  getSearchState: () => SearchState | null;
  clearAllSelections: () => void;
  getFocusedEmulator: () => ITerminalEmulator | null;
  writeToFocused: (data: string) => void;
  isOverlayActive: () => boolean;
}) {
  const {
    config,
    keyboardHandler,
    keyboardExitSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState,
    clearAllSelections,
    getFocusedEmulator,
    writeToFocused,
    isOverlayActive,
  } = params;

  useKeyboard(
    (event: OpenTuiKeyEvent) => {
      const normalizedEvent = normalizeKeyEvent(event);
      // Route to overlays via KeyboardRouter (handles confirmation, session picker, aggregate view)
      // Use event.sequence for printable chars (handles shift for uppercase/symbols)
      // Fall back to event.name for special keys
      const charCode = normalizedEvent.sequence?.charCodeAt(0) ?? 0;
      const isPrintableChar = normalizedEvent.sequence?.length === 1 && charCode >= 32 && charCode < 127;
      const keyToPass = isPrintableChar ? normalizedEvent.sequence! : normalizedEvent.key;

      const routeResult = routeKeyboardEventSync({
        key: keyToPass,
        ctrl: normalizedEvent.ctrl,
        alt: normalizedEvent.alt,
        shift: normalizedEvent.shift,
        sequence: normalizedEvent.sequence,
        baseCode: normalizedEvent.baseCode,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If an overlay handled the key, don't process further
      if (routeResult.handled) {
        return;
      }

      // If in search mode, handle search-specific keys
      if (keyboardHandler.mode === 'search') {
        handleSearchKeyboard(normalizedEvent, {
          exitSearchMode,
          keyboardExitSearchMode,
          setSearchQuery,
          nextMatch,
          prevMatch,
          getSearchState,
          keybindings: config.keybindings().search,
        });
        return;
      }

      // First, check if this is a multiplexer command
      const handled = keyboardHandler.handleKeyDown({
        key: normalizedEvent.key,
        ctrl: normalizedEvent.ctrl,
        shift: normalizedEvent.shift,
        alt: normalizedEvent.alt,
        meta: normalizedEvent.meta,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If not handled by multiplexer and in normal mode, forward to PTY
      if (!handled && keyboardHandler.mode === 'normal' && !isOverlayActive()) {
        processNormalModeKey(normalizedEvent, {
          clearAllSelections,
          getFocusedEmulator,
          writeToFocused,
        });
      }
    },
    { release: true }
  );
}
