/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, onCleanup, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import type { OptimizedBuffer } from '@opentui/core';
import { useSelection } from '../contexts/SelectionContext';
import { useSearch } from '../contexts/SearchContext';
import { useTerminal } from '../contexts/TerminalContext';
import { TerminalViewState } from './terminal-view/terminal-view-state';
import { renderTerminal, type RenderDeps } from './terminal-view/terminal-renderer';
import { setupPtySubscription } from './terminal-view/pty-subscription';

interface TerminalViewProps {
  ptyId: string;
  width: number;
  height: number;
  isFocused: boolean;
  offsetX?: number;
  offsetY?: number;
}

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export function TerminalView(props: TerminalViewProps) {
  const renderer = useRenderer();
  const selection = useSelection();
  const { isCellSelected, getSelectedColumnsForRow, getSelection } = selection;
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch, getSearchMatchRanges } = search;
  const terminal = useTerminal();
  const { getTerminalStateSync, getScrollState, getEmulatorSync } = terminal;

  const state = new TerminalViewState(props.isFocused);
  const initialState = getTerminalStateSync(props.ptyId);
  if (initialState) {
    state.terminalState = initialState;
    const cachedScroll = getScrollState(props.ptyId);
    if (cachedScroll) {
      state.scrollState = cachedScroll;
    }
    const cachedEmulator = getEmulatorSync(props.ptyId);
    if (cachedEmulator) {
      state.emulator = cachedEmulator;
    }
    state.dirtyAll = true;
    state.markAllRowsDirty(initialState.rows);
  }
  const [version, setVersion] = createSignal(initialState ? 1 : 0);

  onCleanup(() => state.cleanup());

  // Subscribe to PTY updates when ptyId changes
  createEffect(
    on(
      () => props.ptyId,
      (ptyId) => {
        let mounted = true;
        let renderRequested = false;

        const requestRenderFrame = () => {
          if (!renderRequested && mounted) {
            renderRequested = true;
            setTimeout(() => {
              if (mounted) {
                renderRequested = false;
                setVersion(v => v + 1);
                renderer.requestRender();
              }
            }, 0);
          }
        };

        const cachedState = getTerminalStateSync(ptyId);
        if (!state.terminalState && cachedState) {
          state.terminalState = cachedState;
          const cachedScroll = getScrollState(ptyId);
          if (cachedScroll) {
            state.scrollState = cachedScroll;
          }
          const cachedEmulator = getEmulatorSync(ptyId);
          if (cachedEmulator) {
            state.emulator = cachedEmulator;
          }
          state.dirtyAll = true;
          state.markAllRowsDirty(cachedState.rows);
          setVersion(v => v + 1);
          renderer.requestRender();
        }

        setupPtySubscription(
          ptyId,
          state,
          { requestRenderFrame },
          () => mounted
        );

        onCleanup(() => {
          mounted = false;
          state.resetForPtyChange();
        });
      },
      { defer: false }
    )
  );

  // Render callback
  const render = (buffer: OptimizedBuffer) => {
    const renderDeps: RenderDeps = {
      isCellSelected,
      getSelectedColumnsForRow,
      isSearchMatch,
      isCurrentMatch,
      getSelection,
      getSearchMatchRanges,
      searchState: search.searchState,
    };

    renderTerminal(
      buffer,
      state,
      {
        ptyId: props.ptyId,
        width: props.width,
        height: props.height,
        offsetX: props.offsetX ?? 0,
        offsetY: props.offsetY ?? 0,
        isFocused: props.isFocused,
      },
      renderDeps
    );
  };

  // Request render when selection or search version changes
  createEffect(
    on(
      [() => selection.selectionVersion, () => search.searchVersion],
      () => {
        const selectionRef = getSelection(props.ptyId) ?? null;
        const searchState = search.searchState;
        const searchPtyId = searchState?.ptyId ?? null;
        const affectsSearch = searchPtyId === props.ptyId || state.lastSearchPtyId === props.ptyId;

        const selectionChanged = selectionRef !== state.lastSelectionRef;
        const searchChanged = affectsSearch && searchState !== state.lastSearchRef;

        if (selectionChanged || searchChanged) {
          state.dirtyAll = true;
          renderer.requestRender();
        }

        state.lastSelectionRef = selectionRef;
        if (affectsSearch) {
          state.lastSearchRef = searchState;
        }
        state.lastSearchPtyId = searchPtyId;
      }
    )
  );

  return (
    <Show
      when={version() > 0}
      fallback={
        <box
          style={{
            width: props.width,
            height: props.height,
          }}
        />
      }
    >
      <box
        style={{
          width: props.width,
          height: props.height,
        }}
        renderAfter={render}
      />
    </Show>
  );
}

export default TerminalView;
