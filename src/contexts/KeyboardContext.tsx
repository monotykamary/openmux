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
import { PREFIX_KEY, DEFAULT_CONFIG, RESIZE_STEP } from '../core/config';
import { useLayout } from './LayoutContext';
import { keyToDirection } from '../core/bsp-tree';

type KeyboardAction =
  | { type: 'ENTER_PREFIX_MODE' }
  | { type: 'EXIT_PREFIX_MODE' }
  | { type: 'ENTER_RESIZE_MODE' }
  | { type: 'EXIT_RESIZE_MODE' }
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

    case 'ENTER_RESIZE_MODE':
      return {
        ...state,
        mode: 'resize',
        prefixActivatedAt: undefined,
      };

    case 'EXIT_RESIZE_MODE':
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

/**
 * Hook for handling keyboard input across all modes
 */
export function useKeyboardHandler() {
  const { state: kbState, dispatch: kbDispatch } = useKeyboardState();
  const { dispatch: layoutDispatch } = useLayout();

  const handleKeyDown = useCallback((event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => {
    const { key, ctrl } = event;

    // Handle Ctrl+B to enter prefix mode (only in normal mode)
    if (kbState.mode === 'normal' && ctrl && key.toLowerCase() === PREFIX_KEY) {
      kbDispatch({ type: 'ENTER_PREFIX_MODE' });
      return true;
    }

    // Handle Escape to exit any mode
    if (key === 'Escape') {
      if (kbState.mode === 'prefix') {
        kbDispatch({ type: 'EXIT_PREFIX_MODE' });
        return true;
      } else if (kbState.mode === 'resize') {
        kbDispatch({ type: 'EXIT_RESIZE_MODE' });
        return true;
      }
      return false;
    }

    // Prefix mode commands
    if (kbState.mode === 'prefix') {
      return handlePrefixModeKey(key, kbDispatch, layoutDispatch);
    }

    // Resize mode commands
    if (kbState.mode === 'resize') {
      return handleResizeModeKey(key, kbDispatch, layoutDispatch);
    }

    // Normal mode - pass through to terminal
    return false;
  }, [kbState.mode, kbDispatch, layoutDispatch]);

  return { handleKeyDown, mode: kbState.mode };
}

function handlePrefixModeKey(
  key: string,
  kbDispatch: Dispatch<KeyboardAction>,
  layoutDispatch: ReturnType<typeof useLayout>['dispatch']
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
      layoutDispatch({ type: 'NEW_PANE' });
      exitPrefix();
      return true;

    // Close pane
    case 'x':
      layoutDispatch({ type: 'CLOSE_PANE' });
      exitPrefix();
      return true;

    // Enter resize mode
    case 'r':
      kbDispatch({ type: 'ENTER_RESIZE_MODE' });
      return true;

    // Layout mode: vertical (panes side by side)
    case 'v':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'vertical' });
      exitPrefix();
      return true;

    // Layout mode: horizontal (panes stacked top/bottom)
    case 's':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'horizontal' });
      exitPrefix();
      return true;

    // Layout mode: stacked (tabs)
    case 't':
      layoutDispatch({ type: 'SET_LAYOUT_MODE', mode: 'stacked' });
      exitPrefix();
      return true;

    // Toggle hints
    case '?':
      kbDispatch({ type: 'TOGGLE_HINTS' });
      return true;

    default:
      return false;
  }
}

function handleResizeModeKey(
  key: string,
  kbDispatch: Dispatch<KeyboardAction>,
  layoutDispatch: ReturnType<typeof useLayout>['dispatch']
): boolean {
  const direction = keyToDirection(key);

  if (direction) {
    layoutDispatch({ type: 'RESIZE', direction, delta: RESIZE_STEP });
    return true;
  }

  if (key === 'Enter' || key === 'Escape') {
    kbDispatch({ type: 'EXIT_RESIZE_MODE' });
    return true;
  }

  return false;
}
