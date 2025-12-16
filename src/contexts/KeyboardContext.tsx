/**
 * Keyboard context for prefix-key system and mode management
 */

import {
  createContext,
  useContext,
  createEffect,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { KeyMode, KeyboardState, WorkspaceId, ConfirmationType } from '../core/types';
import { PREFIX_KEY, DEFAULT_CONFIG } from '../core/config';
import { useLayout } from './LayoutContext';
import { keyToDirection } from '../core/keyboard-utils';

// =============================================================================
// Context
// =============================================================================

interface KeyboardContextValue {
  state: KeyboardState;
  enterPrefixMode: () => void;
  exitPrefixMode: () => void;
  enterSearchMode: () => void;
  exitSearchMode: () => void;
  enterAggregateMode: () => void;
  exitAggregateMode: () => void;
  enterConfirmMode: (confirmationType: ConfirmationType) => void;
  exitConfirmMode: () => void;
  toggleHints: () => void;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface KeyboardProviderProps extends ParentProps {}

export function KeyboardProvider(props: KeyboardProviderProps) {
  const initialState: KeyboardState = {
    mode: 'normal',
    showHints: false,
  };

  const [state, setState] = createStore<KeyboardState>(initialState);

  // Prefix mode timeout
  createEffect(() => {
    if (state.mode !== 'prefix' || !state.prefixActivatedAt) return;

    const timeout = setTimeout(() => {
      setState(produce((s) => {
        s.mode = 'normal';
        s.prefixActivatedAt = undefined;
      }));
    }, DEFAULT_CONFIG.prefixTimeout);

    onCleanup(() => clearTimeout(timeout));
  });

  // Actions
  const enterPrefixMode = () => {
    setState(produce((s) => {
      s.mode = 'prefix';
      s.prefixActivatedAt = Date.now();
    }));
  };

  const exitPrefixMode = () => {
    setState(produce((s) => {
      s.mode = 'normal';
      s.prefixActivatedAt = undefined;
    }));
  };

  const enterSearchMode = () => {
    setState(produce((s) => {
      s.mode = 'search';
      s.prefixActivatedAt = undefined;
    }));
  };

  const exitSearchMode = () => {
    setState('mode', 'normal');
  };

  const enterAggregateMode = () => {
    setState(produce((s) => {
      s.mode = 'aggregate';
      s.prefixActivatedAt = undefined;
    }));
  };

  const exitAggregateMode = () => {
    setState('mode', 'normal');
  };

  const enterConfirmMode = (confirmationType: ConfirmationType) => {
    setState(produce((s) => {
      s.mode = 'confirm';
      s.prefixActivatedAt = undefined;
      s.confirmationType = confirmationType;
    }));
  };

  const exitConfirmMode = () => {
    setState(produce((s) => {
      s.mode = 'normal';
      s.confirmationType = undefined;
    }));
  };

  const toggleHints = () => {
    setState('showHints', (prev) => !prev);
  };

  const value: KeyboardContextValue = {
    state,
    enterPrefixMode,
    exitPrefixMode,
    enterSearchMode,
    exitSearchMode,
    enterAggregateMode,
    exitAggregateMode,
    enterConfirmMode,
    exitConfirmMode,
    toggleHints,
  };

  return (
    <KeyboardContext.Provider value={value}>
      {props.children}
    </KeyboardContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useKeyboardState(): KeyboardContextValue {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardState must be used within KeyboardProvider');
  }
  return context;
}

// =============================================================================
// Keyboard Handler Hook
// =============================================================================

/** Layout modes for cycling */
const LAYOUT_MODES: Array<'vertical' | 'horizontal' | 'stacked'> = ['vertical', 'horizontal', 'stacked'];

interface KeyboardHandlerOptions {
  onPaste?: () => void;
  onNewPane?: () => void;
  onQuit?: () => void;
  onRequestQuit?: () => void;
  onRequestClosePane?: () => void;
  onToggleSessionPicker?: () => void;
  onEnterSearch?: () => void;
  onToggleConsole?: () => void;
  onToggleAggregateView?: () => void;
}

/**
 * Hook for handling keyboard input across all modes
 */
export function useKeyboardHandler(options: KeyboardHandlerOptions = {}) {
  const keyboard = useKeyboardState();
  const layout = useLayout();
  const {
    onPaste,
    onNewPane,
    onQuit,
    onRequestQuit,
    onRequestClosePane,
    onToggleSessionPicker,
    onEnterSearch,
    onToggleConsole,
    onToggleAggregateView,
  } = options;

  const handleKeyDown = (event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => {
    const { key, ctrl, alt } = event;

    // Note: We do NOT intercept Ctrl+V here. Applications like Claude Code need to
    // receive Ctrl+V directly so they can trigger their own clipboard reading (which
    // supports images). For text paste, use prefix+] or prefix+p, or Cmd+V on macOS
    // (which triggers bracketed paste via PasteEvent handled in App.tsx).

    // Handle Alt keybindings (prefix-less actions) in normal mode
    if (keyboard.state.mode === 'normal' && alt) {
      return handleAltKey(
        key,
        keyboard,
        layout,
        layout.activeWorkspace.layoutMode,
        onNewPane,
        onToggleSessionPicker,
        onEnterSearch,
        onToggleAggregateView,
        onRequestClosePane
      );
    }

    // Handle Ctrl+B to enter prefix mode (only in normal mode)
    if (keyboard.state.mode === 'normal' && ctrl && key.toLowerCase() === PREFIX_KEY) {
      keyboard.enterPrefixMode();
      return true;
    }

    // Handle Escape to exit prefix mode
    if (key === 'Escape' || key === 'escape') {
      if (keyboard.state.mode === 'prefix') {
        keyboard.exitPrefixMode();
        return true;
      }
      return false;
    }

    // Prefix mode commands
    if (keyboard.state.mode === 'prefix') {
      return handlePrefixModeKey(
        key,
        keyboard,
        layout,
        onPaste,
        onNewPane,
        onQuit,
        onRequestQuit,
        onRequestClosePane,
        onToggleSessionPicker,
        onEnterSearch,
        onToggleConsole,
        onToggleAggregateView
      );
    }

    // Normal mode - pass through to terminal
    return false;
  };

  return { handleKeyDown, mode: keyboard.state.mode };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Handle Alt key combinations (prefix-less actions)
 */
function handleAltKey(
  key: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  onNewPane?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void,
  onToggleAggregateView?: () => void,
  onRequestClosePane?: () => void
): boolean {
  // Alt+hjkl for navigation
  const direction = keyToDirection(key);
  if (direction) {
    layout.navigate(direction);
    return true;
  }

  // Alt+1-9 for workspace switching
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layout.switchWorkspace(workspaceId);
    return true;
  }

  switch (key) {
    // Alt+n or Alt+Enter for new pane
    case 'n':
    case 'Enter':
      if (onNewPane) {
        onNewPane();
      } else {
        layout.newPane();
      }
      return true;

    // Alt+[ to cycle layout mode backward
    case '[':
      {
        const currentIndex = LAYOUT_MODES.indexOf(currentLayoutMode);
        const newIndex = (currentIndex - 1 + LAYOUT_MODES.length) % LAYOUT_MODES.length;
        layout.setLayoutMode(LAYOUT_MODES[newIndex]!);
      }
      return true;

    // Alt+] to cycle layout mode forward
    case ']':
      {
        const currentIndex = LAYOUT_MODES.indexOf(currentLayoutMode);
        const newIndex = (currentIndex + 1) % LAYOUT_MODES.length;
        layout.setLayoutMode(LAYOUT_MODES[newIndex]!);
      }
      return true;

    // Alt+x to close pane (with confirmation)
    case 'x':
      if (onRequestClosePane) {
        onRequestClosePane();
      } else {
        layout.closePane();
      }
      return true;

    // Alt+z to toggle zoom
    case 'z':
      layout.toggleZoom();
      return true;

    // Alt+s to toggle session picker
    case 's':
      onToggleSessionPicker?.();
      return true;

    // Alt+f to open search
    case 'f':
      if (onEnterSearch) {
        keyboard.enterSearchMode();
        onEnterSearch();
        return true;
      }
      return false;

    // Alt+g to toggle aggregate view (global view)
    case 'g':
      if (onToggleAggregateView) {
        keyboard.enterAggregateMode();
        onToggleAggregateView();
        return true;
      }
      return false;

    default:
      return false;
  }
}

function handlePrefixModeKey(
  key: string,
  keyboard: KeyboardContextValue,
  layout: ReturnType<typeof useLayout>,
  onPaste?: () => void,
  onNewPane?: () => void,
  onQuit?: () => void,
  onRequestQuit?: () => void,
  onRequestClosePane?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void,
  onToggleConsole?: () => void,
  onToggleAggregateView?: () => void
): boolean {
  const exitPrefix = () => keyboard.exitPrefixMode();

  // Navigation (hjkl like vim/i3)
  const direction = keyToDirection(key);
  if (direction) {
    layout.navigate(direction);
    exitPrefix();
    return true;
  }

  // Workspace switching (1-9)
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layout.switchWorkspace(workspaceId);
    exitPrefix();
    return true;
  }

  switch (key) {
    // New pane (single key instead of | and -)
    case 'n':
    case 'Enter':
      if (onNewPane) {
        onNewPane();
      } else {
        layout.newPane();
      }
      exitPrefix();
      return true;

    // Close pane (with confirmation)
    case 'x':
      if (onRequestClosePane) {
        onRequestClosePane();
      } else {
        layout.closePane();
      }
      exitPrefix();
      return true;

    // Layout mode: vertical (panes side by side)
    case 'v':
      layout.setLayoutMode('vertical');
      exitPrefix();
      return true;

    // Session picker (prefix + s)
    case 's':
      onToggleSessionPicker?.();
      exitPrefix();
      return true;

    // Layout mode: horizontal (panes stacked top/bottom) - now 'h' instead of 's'
    case 'H':
      layout.setLayoutMode('horizontal');
      exitPrefix();
      return true;

    // Layout mode: stacked (tabs)
    case 't':
      layout.setLayoutMode('stacked');
      exitPrefix();
      return true;

    // Paste from clipboard (like tmux prefix + ])
    case ']':
    case 'p':
      onPaste?.();
      exitPrefix();
      return true;

    // Toggle zoom on focused pane
    case 'z':
      layout.toggleZoom();
      exitPrefix();
      return true;

    // Toggle hints
    case '?':
      keyboard.toggleHints();
      return true;

    // Quit openmux (with confirmation)
    case 'q':
      if (onRequestQuit) {
        onRequestQuit();
      } else {
        onQuit?.();
      }
      return true;

    // Toggle debug console
    case '`':
      onToggleConsole?.();
      exitPrefix();
      return true;

    // Search mode (vim-style)
    case '/':
      if (onEnterSearch) {
        keyboard.enterSearchMode();
        onEnterSearch();
        // Don't call exitPrefix() here - enterSearchMode already handles the mode transition
        return true;
      }
      exitPrefix();
      return true;

    // Aggregate view (global view)
    case 'g':
      if (onToggleAggregateView) {
        keyboard.enterAggregateMode();
        onToggleAggregateView();
        // Don't call exitPrefix() here - enterAggregateMode already handles the mode transition
        return true;
      }
      exitPrefix();
      return true;

    default:
      return false;
  }
}
