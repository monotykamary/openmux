/**
 * Centralized app action handlers.
 *
 * Creates the complete set of action handlers used by both keyboard
 * input (`useKeyboardHandler`) and command palette (`executeCommandAction`).
 * Eliminates the duplication of the same 15+ callbacks across both consumers.
 */

import { createEffect } from 'solid-js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as errore from 'errore';
import { FileSystemError } from '../../effect/errors';
import { getFocusedPane, getFocusedPtyId } from '../../core/workspace-utils';
import { setKeyboardVimMode, setKeyboardPrefixOnly } from '../../core/user-config';
import { handleNormalModeAction } from '../../contexts/keyboard/handlers';
import type { KeyboardContextValue, KeyboardHandlerOptions } from '../../contexts/keyboard/types';
import type { CommandPaletteCommand } from '../../core/command-palette';
import { createSearchVimState } from './search-vim';
import { createCopyModeVimState } from './copy-mode-vim';
import { createCopyModeKeyHandler } from './copy-mode-keyboard';
import { setCopyModeExitCallback } from '../../terminal/focused-pty-registry';
import type { VimInputMode } from '../../core/vim-sequences';
import type { useConfig } from '../../contexts/ConfigContext';
import type { useSearch } from '../../contexts/SearchContext';
import type { LayoutContextValue } from '../../contexts/LayoutContext';
import type { TerminalContextValue } from '../../contexts/TerminalContext';
import type { SessionContextValue } from '../../contexts/SessionContext';
import type { TitleContextValue } from '../../contexts/TitleContext';
import type { CopyModeContextValue } from '../../contexts/copy-mode/types';
import type { SelectionContextValue } from '../../contexts/SelectionContext';
import type { OverlayContextValue } from '../../contexts/OverlayContext';
import type { AggregateViewState } from '../../contexts/aggregate-view-types';
import type { KeyboardEvent } from '../../core/keyboard-event';

type VimHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface AppActionsDeps {
  config: ReturnType<typeof useConfig>;
  layout: LayoutContextValue;
  terminal: TerminalContextValue;
  session: SessionContextValue;
  titleContext: TitleContextValue;
  copyMode: CopyModeContextValue;
  selection: SelectionContextValue;
  search: ReturnType<typeof useSearch>;
  keyboardState: KeyboardContextValue;
  overlays: OverlayContextValue;
  aggregateState: AggregateViewState;
  renderer: { console: { toggle: () => void; getCachedLogs: () => string } };
  openAggregateView: () => void;
  getActivePtyId: () => string | undefined;
  handleNewPane: () => void;
  handleSplitPane: (direction: 'horizontal' | 'vertical') => void;
}

export function useAppActions(deps: AppActionsDeps): {
  /** Single source of truth for all action handlers */
  actions: KeyboardHandlerOptions;
  /** Dispatch a command-palette action */
  executeCommandAction(action: string): void;
  /** Execute a command palette command */
  handleCommandPaletteExecute(command: CommandPaletteCommand): void;
  /** Paste from clipboard */
  handlePaste(): void;
  /** Enter search mode */
  handleEnterSearch(): Promise<void>;
  /** Enter copy mode */
  handleEnterCopyMode(): void;
  /** Exit copy mode */
  handleExitCopyMode(): void;
  /** Handle keyboard input in copy mode */
  handleCopyModeKey(event: KeyboardEvent): void;
  /** Get current search vim input mode */
  getSearchVimMode(): VimInputMode;
  /** Set search vim input mode */
  setSearchVimMode(mode: VimInputMode): void;
  /** Get the vim handler for search keyboard input */
  getSearchVimHandler(): VimHandler;
  /** Get the vim handler for copy mode keyboard input */
  getCopyVimHandler(): VimHandler;
} {
  const {
    config,
    layout,
    terminal,
    session,
    titleContext,
    copyMode,
    selection,
    search,
    keyboardState,
    overlays,
    aggregateState,
    renderer,
    openAggregateView,
    getActivePtyId,
    handleNewPane,
    handleSplitPane,
  } = deps;

  const handlePaste = () => {
    terminal.pasteToFocused();
  };

  const handlePaneRenameOpen = () => {
    const focusedPane = getFocusedPane(layout.activeWorkspace);
    if (!focusedPane) return;
    const currentTitle = titleContext.getTitle(focusedPane.id) ?? focusedPane.title ?? 'shell';
    overlays.setPaneRenameState({
      show: true,
      paneId: focusedPane.id,
      value: currentTitle,
    });
  };

  const handleWorkspaceLabelOpen = () => {
    const workspace = layout.activeWorkspace;
    const currentLabel = workspace.label ?? '';
    overlays.setWorkspaceLabelState({
      show: true,
      workspaceId: workspace.id,
      value: currentLabel,
    });
  };

  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  const handleDumpConsoleLogs = () => {
    const result = errore.try<void, FileSystemError>({
      try: () => {
        const logs = renderer.console.getCachedLogs();
        const timestamp = Date.now();
        const filename = `openmux-console-${timestamp}.log`;
        const filepath = path.join(os.tmpdir(), filename);
        fs.writeFileSync(filepath, logs, 'utf8');
        console.info(`Console logs dumped to: ${filepath}`);
      },
      catch: (cause) =>
        new FileSystemError({
          operation: 'write',
          path: os.tmpdir(),
          reason: `Failed to dump console logs: ${String(cause)}`,
          cause,
        }),
    });
    if (result instanceof FileSystemError) {
      console.error(result.message, result.cause);
    }
  };

  const handleToggleVimMode = () => {
    const current = config.config().keyboard.vimMode;
    const next = current === 'overlays' ? 'off' : 'overlays';
    setKeyboardVimMode(next);
    config.reloadConfig();
  };

  const handleTogglePrefixOnly = () => {
    const current = config.config().keyboard.prefixOnly;
    setKeyboardPrefixOnly(!current);
    config.reloadConfig();
  };

  const handleRefreshHostColors = () => {
    terminal.refreshHostColors({ forceApply: true }).catch((error: unknown) => {
      console.warn('[openmux] Failed to refresh host colors:', error);
    });
  };

  const searchVimState = createSearchVimState({ config, search });
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => keyboardState.state.mode === 'copy',
  });

  const handleEnterSearch = async () => {
    selection.clearAllSelections();
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    if (focusedPtyId) {
      await search.enterSearchMode(focusedPtyId);
    }
  };

  const handleEnterCopyMode = () => {
    selection.clearAllSelections();
    const focusedPtyId = getActivePtyId();
    if (!focusedPtyId) {
      keyboardState.exitCopyMode();
      return;
    }
    copyMode.enterCopyMode(focusedPtyId);
  };

  const handleExitCopyMode = () => {
    copyMode.exitCopyMode();
    keyboardState.exitCopyMode();
  };

  // Wire copy mode exit so bracketed paste can exit copy mode before pasting
  createEffect(() => {
    const active = keyboardState.state.mode === 'copy';
    setCopyModeExitCallback(active ? handleExitCopyMode : null);
  });

  const handleCopyModeKey = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: handleExitCopyMode,
    pasteCallback: handlePaste,
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  const executeCommandAction = (action: string) => {
    if (aggregateState.showAggregateView && aggregateState.previewMode && action === 'pane.zoom') {
      return;
    }

    handleNormalModeAction(
      action,
      keyboardState,
      layout,
      layout.activeWorkspace.layoutMode,
      actions
    );
  };

  const handleCommandPaletteExecute = (command: CommandPaletteCommand) => {
    executeCommandAction(command.action);
  };

  // Single source of truth for all action handlers
  const actions: KeyboardHandlerOptions = {
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: overlays.handleQuit,
    onDetach: overlays.handleDetach,
    onRequestQuit: overlays.confirmationHandlers.handleRequestQuit,
    onRequestClosePane: overlays.confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: session.togglePicker,
    onToggleTemplateOverlay: session.toggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onEnterCopyMode: handleEnterCopyMode,
    onToggleConsole: handleToggleConsole,
    onDumpConsoleLogs: handleDumpConsoleLogs,
    onToggleAggregateView: openAggregateView,
    onToggleCommandPalette: overlays.toggleCommandPalette,
    onToggleVimMode: handleToggleVimMode,
    onTogglePrefixOnly: handleTogglePrefixOnly,
    onRefreshHostColors: handleRefreshHostColors,
    onRenamePane: handlePaneRenameOpen,
    onLabelWorkspace: handleWorkspaceLabelOpen,
  };

  return {
    actions,
    executeCommandAction,
    handleCommandPaletteExecute,
    handlePaste,
    handleEnterSearch,
    handleEnterCopyMode,
    handleExitCopyMode,
    handleCopyModeKey,
    getSearchVimMode: searchVimState.getSearchVimMode,
    setSearchVimMode: searchVimState.setSearchVimMode,
    getSearchVimHandler: searchVimState.getSearchVimHandler,
    getCopyVimHandler: copyModeVimState.getCopyVimHandler,
  };
}
