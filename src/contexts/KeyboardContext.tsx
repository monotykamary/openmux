/**
 * Keyboard context for prefix-key system and mode management
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { KeyMode, KeyboardState, WorkspaceId } from '../core/types';
import { PREFIX_KEY, DEFAULT_CONFIG } from '../core/config';
import { useLayout } from './LayoutContext';
import { keyToDirection } from '../core/keyboard-utils';

type KeyboardAction =
  | { type: 'ENTER_PREFIX_MODE' }
  | { type: 'EXIT_PREFIX_MODE' }
  | { type: 'ENTER_SEARCH_MODE' }
  | { type: 'EXIT_SEARCH_MODE' }
  | { type: 'TOGGLE_HINTS' };

function keyboardReducer(state: KeyboardState, action: KeyboardAction): KeyboardState {
  switch (action.type) {
    case 'ENTER_PREFIX_MODE':
      return {
        ...state,
        mode: 'prefix',
        prefixActivatedAt: Date.now(),
      };

    case 'EXIT_PREFIX_MODE':
      return {
        ...state,
        mode: 'normal',
        prefixActivatedAt: undefined,
      };

    case 'ENTER_SEARCH_MODE':
      return {
        ...state,
        mode: 'search',
        prefixActivatedAt: undefined,
      };

    case 'EXIT_SEARCH_MODE':
      return {
        ...state,
        mode: 'normal',
      };

    case 'TOGGLE_HINTS':
      return {
        ...state,
        showHints: !state.showHints,
      };

    default:
      return state;
  }
}

interface KeyboardContextValue {
  state: KeyboardState;
  dispatch: Dispatch<KeyboardAction>;
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

interface KeyboardProviderProps {
  children: ReactNode;
}

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const initialState: KeyboardState = {
    mode: 'normal',
    showHints: false,
  };

  const [state, dispatch] = useReducer(keyboardReducer, initialState);

  // Prefix mode timeout
  useEffect(() => {
    if (state.mode !== 'prefix' || !state.prefixActivatedAt) return;

    const timeout = setTimeout(() => {
      dispatch({ type: 'EXIT_PREFIX_MODE' });
    }, DEFAULT_CONFIG.prefixTimeout);

    return () => clearTimeout(timeout);
  }, [state.mode, state.prefixActivatedAt]);

  return (
    <KeyboardContext.Provider value={{ state, dispatch }}>
      {children}
    </KeyboardContext.Provider>
  );
}

export function useKeyboardState(): KeyboardContextValue {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboardState must be used within KeyboardProvider');
  }
  return context;
}

/** Layout modes for cycling */
const LAYOUT_MODES: Array<'vertical' | 'horizontal' | 'stacked'> = ['vertical', 'horizontal', 'stacked'];

interface KeyboardHandlerOptions {
  onPaste?: () => void;
  onNewPane?: () => void;
  onQuit?: () => void;
  onToggleSessionPicker?: () => void;
  onEnterSearch?: () => void;
  onToggleConsole?: () => void;
}

/**
 * Hook for handling keyboard input across all modes
 */
export function useKeyboardHandler(options: KeyboardHandlerOptions = {}) {
  const { state: kbState, dispatch: kbDispatch } = useKeyboardState();
  const { dispatch: layoutDispatch, activeWorkspace } = useLayout();
  const { onPaste, onNewPane, onQuit, onToggleSessionPicker, onEnterSearch, onToggleConsole } = options;

  const handleKeyDown = useCallback((event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => {
    const { key, ctrl, alt, shift, meta } = event;

    // Note: We do NOT intercept Ctrl+V here. Applications like Claude Code need to
    // receive Ctrl+V directly so they can trigger their own clipboard reading (which
    // supports images). For text paste, use prefix+] or prefix+p, or Cmd+V on macOS
    // (which triggers bracketed paste via PasteEvent handled in App.tsx).

    // Handle Alt keybindings (prefix-less actions) in normal mode
    if (kbState.mode === 'normal' && alt) {
      return handleAltKey(key, kbDispatch, layoutDispatch, activeWorkspace.layoutMode, onNewPane, onToggleSessionPicker, onEnterSearch);
    }

    // Handle Ctrl+B to enter prefix mode (only in normal mode)
    if (kbState.mode === 'normal' && ctrl && key.toLowerCase() === PREFIX_KEY) {
      kbDispatch({ type: 'ENTER_PREFIX_MODE' });
      return true;
    }

    // Handle Escape to exit prefix mode
    if (key === 'Escape' || key === 'escape') {
      if (kbState.mode === 'prefix') {
        kbDispatch({ type: 'EXIT_PREFIX_MODE' });
        return true;
      }
      return false;
    }

    // Prefix mode commands
    if (kbState.mode === 'prefix') {
      return handlePrefixModeKey(key, kbDispatch, layoutDispatch, onPaste, onNewPane, onQuit, onToggleSessionPicker, onEnterSearch, onToggleConsole);
    }

    // Normal mode - pass through to terminal
    return false;
  }, [kbState.mode, kbDispatch, layoutDispatch, activeWorkspace.layoutMode, onPaste, onNewPane, onQuit, onToggleSessionPicker, onEnterSearch, onToggleConsole]);

  return { handleKeyDown, mode: kbState.mode };
}

/**
 * Handle Alt key combinations (prefix-less actions)
 */
function handleAltKey(
  key: string,
  kbDispatch: Dispatch<KeyboardAction>,
  layoutDispatch: ReturnType<typeof useLayout>['dispatch'],
  currentLayoutMode: 'vertical' | 'horizontal' | 'stacked',
  onNewPane?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void
): boolean {
  // Alt+hjkl for navigation
  const direction = keyToDirection(key);
  if (direction) {
    layoutDispatch({ type: 'NAVIGATE', direction });
    return true;
  }

  // Alt+1-9 for workspace switching
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layoutDispatch({ type: 'SWITCH_WORKSPACE', workspaceId });
    return true;
  }

  switch (key) {
    // Alt+n or Alt+Enter for new pane
    case 'n':
    case 'Enter':
      if (onNewPane) {
        onNewPane();
      } else {
        layoutDispatch({ type: 'NEW_PANE' });
      }
      return true;

    // Alt+[ to cycle layout mode backward
    case '[':
      {
        const currentIndex = LAYOUT_MODES.indexOf(currentLayoutMode);
        const newIndex = (currentIndex - 1 + LAYOUT_MODES.length) % LAYOUT_MODES.length;
        layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: LAYOUT_MODES[newIndex]! });
      }
      return true;

    // Alt+] to cycle layout mode forward
    case ']':
      {
        const currentIndex = LAYOUT_MODES.indexOf(currentLayoutMode);
        const newIndex = (currentIndex + 1) % LAYOUT_MODES.length;
        layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: LAYOUT_MODES[newIndex]! });
      }
      return true;

    // Alt+x to close pane
    case 'x':
      layoutDispatch({ type: 'CLOSE_PANE' });
      return true;

    // Alt+z to toggle zoom
    case 'z':
      layoutDispatch({ type: 'TOGGLE_ZOOM' });
      return true;

    // Alt+s to toggle session picker
    case 's':
      onToggleSessionPicker?.();
      return true;

    // Alt+f to open search
    case 'f':
      if (onEnterSearch) {
        kbDispatch({ type: 'ENTER_SEARCH_MODE' });
        onEnterSearch();
        return true;
      }
      return false;

    default:
      return false;
  }
}

function handlePrefixModeKey(
  key: string,
  kbDispatch: Dispatch<KeyboardAction>,
  layoutDispatch: ReturnType<typeof useLayout>['dispatch'],
  onPaste?: () => void,
  onNewPane?: () => void,
  onQuit?: () => void,
  onToggleSessionPicker?: () => void,
  onEnterSearch?: () => void,
  onToggleConsole?: () => void
): boolean {
  const exitPrefix = () => kbDispatch({ type: 'EXIT_PREFIX_MODE' });

  // Navigation (hjkl like vim/i3)
  const direction = keyToDirection(key);
  if (direction) {
    layoutDispatch({ type: 'NAVIGATE', direction });
    exitPrefix();
    return true;
  }

  // Workspace switching (1-9)
  if (/^[1-9]$/.test(key)) {
    const workspaceId = parseInt(key, 10) as WorkspaceId;
    layoutDispatch({ type: 'SWITCH_WORKSPACE', workspaceId });
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
        layoutDispatch({ type: 'NEW_PANE' });
      }
      exitPrefix();
      return true;

    // Close pane
    case 'x':
      layoutDispatch({ type: 'CLOSE_PANE' });
      exitPrefix();
      return true;

    // Layout mode: vertical (panes side by side)
    case 'v':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'vertical' });
      exitPrefix();
      return true;

    // Session picker (prefix + s)
    case 's':
      onToggleSessionPicker?.();
      exitPrefix();
      return true;

    // Layout mode: horizontal (panes stacked top/bottom) - now 'h' instead of 's'
    case 'H':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      exitPrefix();
      return true;

    // Layout mode: stacked (tabs)
    case 't':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'stacked' });
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
      layoutDispatch({ type: 'TOGGLE_ZOOM' });
      exitPrefix();
      return true;

    // Toggle hints
    case '?':
      kbDispatch({ type: 'TOGGLE_HINTS' });
      return true;

    // Quit openmux
    case 'q':
      onQuit?.();
      return true;

    // Toggle debug console
    case '`':
      onToggleConsole?.();
      exitPrefix();
      return true;

    // Search mode (vim-style)
    case '/':
      if (onEnterSearch) {
        kbDispatch({ type: 'ENTER_SEARCH_MODE' });
        onEnterSearch();
        // Don't call exitPrefix() here - ENTER_SEARCH_MODE already handles the mode transition
        return true;
      }
      exitPrefix();
      return true;

    default:
      return false;
  }
}
