/**
 * Search Mode Keyboard Handler
 * Handles keyboard input when the terminal is in search mode
 */
import type { SearchState } from '../../contexts/search/types';
import { eventToCombo, matchKeybinding, type ResolvedKeybindingMap } from '../../core/keybindings';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { VimInputMode } from '../../core/vim-sequences';

type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface SearchKeyboardDeps {
  exitSearchMode: (restore: boolean) => void;
  keyboardExitSearchMode: () => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  getSearchState: () => SearchState | null;
  keybindings: ResolvedKeybindingMap;
  vimEnabled: () => boolean;
  getVimMode: () => VimInputMode;
  setVimMode: (mode: VimInputMode) => void;
  getVimHandler: () => VimSequenceHandler;
}

/**
 * Handle keyboard input in search mode
 * @returns true if the key was handled, false if not
 */
export function handleSearchKeyboard(event: KeyboardEvent, deps: SearchKeyboardDeps): boolean {
  if (event.eventType === 'release') {
    return true;
  }

  const keyEvent = {
    key: event.key,
    ctrl: event.ctrl,
    alt: event.alt,
    shift: event.shift,
    meta: event.meta,
  };

  const isBareEscape =
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleAction = (action: string | null): boolean => {
    if (!action) return false;
    switch (action) {
      case 'search.cancel':
        deps.exitSearchMode(true);
        deps.keyboardExitSearchMode();
        return true;
      case 'search.confirm':
        deps.exitSearchMode(false);
        deps.keyboardExitSearchMode();
        return true;
      default:
        break;
    }

    const currentSearchState = deps.getSearchState();
    if (!currentSearchState) {
      return true;
    }

    if (action === 'search.next') {
      deps.nextMatch();
      return true;
    }

    if (action === 'search.prev') {
      deps.prevMatch();
      return true;
    }

    if (action === 'search.delete') {
      deps.setSearchQuery(currentSearchState.query.slice(0, -1));
      return true;
    }

    return false;
  };

  const handleInput = (): boolean => {
    const currentSearchState = deps.getSearchState();
    if (!currentSearchState) {
      return true;
    }
    const printableChar =
      event.key.length === 1 &&
      event.key.charCodeAt(0) >= 32 &&
      event.key.charCodeAt(0) < 127 &&
      !event.ctrl &&
      !event.alt &&
      !event.meta
        ? event.key
        : null;
    if (printableChar) {
      deps.setSearchQuery(currentSearchState.query + printableChar);
      return true;
    }
    return true;
  };

  if (!deps.vimEnabled()) {
    const action = matchKeybinding(deps.keybindings, keyEvent);
    if (handleAction(action)) return true;
    return handleInput();
  }

  if (deps.getVimMode() === 'insert') {
    if (isBareEscape) {
      deps.setVimMode('normal');
      deps.getVimHandler().reset();
      return true;
    }
    const action = matchKeybinding(deps.keybindings, keyEvent);
    if (handleAction(action)) return true;
    return handleInput();
  }

  if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
    deps.setVimMode('insert');
    deps.getVimHandler().reset();
    return true;
  }

  const combo = eventToCombo(keyEvent);
  const result = deps.getVimHandler().handleCombo(combo);
  if (result.pending) return true;
  if (handleAction(result.action)) return true;

  const isBackspace = event.key === 'backspace';
  const shouldMatchBindings =
    !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
  if (shouldMatchBindings && !isBareEscape) {
    const fallbackAction = matchKeybinding(deps.keybindings, keyEvent);
    if (handleAction(fallbackAction)) return true;
  }

  return true;
}
