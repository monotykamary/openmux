import type { KeyboardEvent } from '../../../effect/bridge';
import { eventToCombo, matchKeybinding } from '../../../core/keybindings';
import type { SearchDeps } from './types';
import { isBareEscape } from './helpers';

export function createAggregateSearchHandler(deps: SearchDeps) {
  const handleSearchAction = (action: string | null): boolean => {
    if (!action) return false;

    if (action === 'aggregate.search.cancel') {
      deps.exitSearchMode(true);
      deps.setInSearchMode(false);
      return true;
    }

    if (action === 'aggregate.search.confirm') {
      deps.exitSearchMode(false);
      deps.setInSearchMode(false);
      return true;
    }

    const currentSearchState = deps.getSearchState();
    if (!currentSearchState) {
      return true;
    }

    if (action === 'aggregate.search.next') {
      deps.nextMatch();
      return true;
    }

    if (action === 'aggregate.search.prev') {
      deps.prevMatch();
      return true;
    }

    if (action === 'aggregate.search.delete') {
      deps.setSearchQuery(currentSearchState.query.slice(0, -1));
      return true;
    }

    return false;
  };

  const handleSearchInput = (event: KeyboardEvent): boolean => {
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

  const handleSearchModeKeys = (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      return true;
    }

    const keybindings = deps.getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!deps.getVimEnabled()) {
      const action = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(action)) return true;
      return handleSearchInput(event);
    }

    if (deps.getSearchVimMode() === 'insert') {
      if (isBareEscape(event)) {
        deps.setSearchVimMode('normal');
        deps.getVimHandlers().search.reset();
        return true;
      }
      const action = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(action)) return true;
      return handleSearchInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      deps.setSearchVimMode('insert');
      deps.getVimHandlers().search.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = deps.getVimHandlers().search.handleCombo(combo);
    if (result.pending) return true;
    if (handleSearchAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings =
      !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.search, keyEvent);
      if (handleSearchAction(fallbackAction)) return true;
    }

    return true;
  };

  return { handleSearchModeKeys };
}
