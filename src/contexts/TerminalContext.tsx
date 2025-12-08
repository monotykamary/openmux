/**
 * Terminal context for managing PTY sessions and keyboard forwarding
 * Uses Effect services via bridge for all PTY operations.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { initGhostty, isGhosttyInitialized, detectHostCapabilities } from '../terminal';
import type { TerminalState, TerminalScrollState } from '../core/types';
import { useLayout } from './LayoutContext';
import {
  createPtySession,
  writeToPty,
  resizePty,
  destroyPty,
  destroyAllPtys,
  getPtyCwd,
  getTerminalState,
  onPtyExit,
  setPanePosition,
  getScrollState,
  setScrollOffset,
  scrollToBottom,
  subscribeToPty,
  readFromClipboard,
} from '../effect/bridge';

interface TerminalContextValue {
  /** Create a new PTY session for a pane */
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  /** Destroy a PTY session */
  destroyPTY: (ptyId: string) => void;
  /** Destroy all PTY sessions */
  destroyAllPTYs: () => void;
  /** Write input to the focused pane's PTY */
  writeToFocused: (data: string) => void;
  /** Write input to a specific PTY */
  writeToPTY: (ptyId: string, data: string) => void;
  /** Paste from clipboard to the focused pane's PTY */
  pasteToFocused: () => Promise<boolean>;
  /** Resize a PTY session */
  resizePTY: (ptyId: string, cols: number, rows: number) => void;
  /** Update pane position for graphics passthrough */
  setPanePosition: (ptyId: string, x: number, y: number) => void;
  /** Get the current working directory of the focused pane */
  getFocusedCwd: () => Promise<string | null>;
  /** Get the CWD for a specific PTY session */
  getSessionCwd: (ptyId: string) => Promise<string>;
  /** Get the cursor key mode (DECCKM) from the focused pane */
  getFocusedCursorKeyMode: () => 'normal' | 'application';
  /** Check if mouse tracking is enabled for a PTY */
  isMouseTrackingEnabled: (ptyId: string) => boolean;
  /** Check if terminal is in alternate screen mode (vim, htop, etc.) */
  isAlternateScreen: (ptyId: string) => boolean;
  /** Get scroll state for a PTY */
  getScrollState: (ptyId: string) => TerminalScrollState | undefined;
  /** Scroll terminal by delta lines (positive = scroll up into history) */
  scrollTerminal: (ptyId: string, delta: number) => void;
  /** Set absolute scroll offset for a PTY */
  setScrollOffset: (ptyId: string, offset: number) => void;
  /** Scroll terminal to bottom (live content) */
  scrollToBottom: (ptyId: string) => void;
  /** Check if ghostty is initialized */
  isInitialized: boolean;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

interface TerminalProviderProps {
  children: ReactNode;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const { activeWorkspace, dispatch } = useLayout();
  const initializedRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Track ptyId -> paneId mapping for exit handling
  const ptyToPaneMap = useRef<Map<string, string>>(new Map());

  // Cache terminal states for synchronous access (updated via subscription)
  const terminalStatesCache = useRef<Map<string, TerminalState>>(new Map());

  // Cache scroll states for synchronous access
  const scrollStatesCache = useRef<Map<string, TerminalScrollState>>(new Map());

  // Track unsubscribe functions for cleanup
  const unsubscribeFns = useRef<Map<string, () => void>>(new Map());

  // Initialize ghostty and detect host terminal capabilities on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Detect host capabilities first (for graphics passthrough)
    detectHostCapabilities()
      .then(() => initGhostty())
      .then(() => {
        setIsInitialized(true);
      })
      .catch((err) => {
        console.error('Failed to initialize terminal:', err);
      });
  }, []);

  // Create a PTY session
  const createPTY = useCallback(async (paneId: string, cols: number, rows: number, cwd?: string): Promise<string> => {
    if (!isGhosttyInitialized()) {
      throw new Error('Ghostty not initialized');
    }

    const ptyId = await createPtySession({ cols, rows, cwd });

    // Track the mapping
    ptyToPaneMap.current.set(ptyId, paneId);

    // Register exit callback to close pane when shell exits
    const unsubExit = await onPtyExit(ptyId, () => {
      const mappedPaneId = ptyToPaneMap.current.get(ptyId);
      if (mappedPaneId) {
        dispatch({ type: 'CLOSE_PANE_BY_ID', paneId: mappedPaneId });
        ptyToPaneMap.current.delete(ptyId);
      }
    });

    // Subscribe to terminal state updates for caching
    const unsubState = await subscribeToPty(ptyId, (state) => {
      terminalStatesCache.current.set(ptyId, state);
    });

    // Store unsubscribe functions
    unsubscribeFns.current.set(ptyId, () => {
      unsubExit();
      unsubState();
    });

    // Update the pane with the PTY ID
    dispatch({ type: 'SET_PANE_PTY', paneId, ptyId });

    return ptyId;
  }, [dispatch]);

  // Destroy a PTY session
  const handleDestroyPTY = useCallback((ptyId: string) => {
    // Unsubscribe from updates
    const unsub = unsubscribeFns.current.get(ptyId);
    if (unsub) {
      unsub();
      unsubscribeFns.current.delete(ptyId);
    }

    // Clear caches
    terminalStatesCache.current.delete(ptyId);
    scrollStatesCache.current.delete(ptyId);
    ptyToPaneMap.current.delete(ptyId);

    // Destroy the PTY (fire and forget)
    destroyPty(ptyId);
  }, []);

  // Destroy all PTY sessions
  const handleDestroyAllPTYs = useCallback(() => {
    // Unsubscribe all
    for (const unsub of unsubscribeFns.current.values()) {
      unsub();
    }
    unsubscribeFns.current.clear();
    terminalStatesCache.current.clear();
    scrollStatesCache.current.clear();
    ptyToPaneMap.current.clear();

    // Destroy all PTYs (fire and forget)
    destroyAllPtys();
  }, []);

  // Get CWD for a specific PTY session
  const getSessionCwd = useCallback(async (ptyId: string): Promise<string> => {
    return getPtyCwd(ptyId);
  }, []);

  // Helper to get focused PTY ID
  const getFocusedPtyId = useCallback((): string | undefined => {
    const focusedPaneId = activeWorkspace.focusedPaneId;
    if (!focusedPaneId) return undefined;

    if (activeWorkspace.mainPane?.id === focusedPaneId) {
      return activeWorkspace.mainPane.ptyId;
    }

    const stackPane = activeWorkspace.stackPanes.find(p => p.id === focusedPaneId);
    return stackPane?.ptyId;
  }, [activeWorkspace]);

  // Write to the focused pane's PTY
  const writeToFocused = useCallback((data: string) => {
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      // Fire and forget for responsive typing
      writeToPty(focusedPtyId, data);
    }
  }, [getFocusedPtyId]);

  // Resize a PTY session
  const handleResizePTY = useCallback((ptyId: string, cols: number, rows: number) => {
    // Fire and forget
    resizePty(ptyId, cols, rows);
  }, []);

  // Update pane position for graphics passthrough
  const handleSetPanePosition = useCallback((ptyId: string, x: number, y: number) => {
    // Fire and forget
    setPanePosition(ptyId, x, y);
  }, []);

  // Write to a specific PTY
  const handleWriteToPTY = useCallback((ptyId: string, data: string) => {
    // Fire and forget for responsive typing
    writeToPty(ptyId, data);
  }, []);

  // Get the current working directory of the focused pane
  const getFocusedCwd = useCallback(async (): Promise<string | null> => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return null;
    return getPtyCwd(focusedPtyId);
  }, [getFocusedPtyId]);

  // Paste from clipboard to the focused PTY
  const pasteToFocused = useCallback(async (): Promise<boolean> => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return false;

    const clipboardText = await readFromClipboard();
    if (!clipboardText) return false;

    writeToPty(focusedPtyId, clipboardText);
    return true;
  }, [getFocusedPtyId]);

  // Get the cursor key mode from the focused pane (sync - uses cache)
  const getFocusedCursorKeyMode = useCallback((): 'normal' | 'application' => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return 'normal';

    const terminalState = terminalStatesCache.current.get(focusedPtyId);
    return terminalState?.cursorKeyMode ?? 'normal';
  }, [getFocusedPtyId]);

  // Check if mouse tracking is enabled for a PTY (sync - uses cache)
  const handleIsMouseTrackingEnabled = useCallback((ptyId: string): boolean => {
    const terminalState = terminalStatesCache.current.get(ptyId);
    return terminalState?.mouseTracking ?? false;
  }, []);

  // Check if terminal is in alternate screen mode (sync - uses cache)
  const handleIsAlternateScreen = useCallback((ptyId: string): boolean => {
    const terminalState = terminalStatesCache.current.get(ptyId);
    return terminalState?.alternateScreen ?? false;
  }, []);

  // Get scroll state for a PTY (sync - uses cache, but also fetches async)
  const handleGetScrollState = useCallback((ptyId: string): TerminalScrollState | undefined => {
    // Return cached value immediately
    const cached = scrollStatesCache.current.get(ptyId);

    // Also fetch fresh state async and update cache
    getScrollState(ptyId).then((state) => {
      if (state) {
        scrollStatesCache.current.set(ptyId, {
          viewportOffset: state.viewportOffset,
          scrollbackLength: state.scrollbackLength,
          isAtBottom: state.isAtBottom,
        });
      }
    });

    return cached;
  }, []);

  // Scroll terminal by delta lines
  const scrollTerminal = useCallback((ptyId: string, delta: number): void => {
    const cached = scrollStatesCache.current.get(ptyId);
    if (cached) {
      const newOffset = cached.viewportOffset + delta;
      setScrollOffset(ptyId, newOffset);
      // Update cache optimistically
      scrollStatesCache.current.set(ptyId, {
        ...cached,
        viewportOffset: Math.max(0, newOffset),
        isAtBottom: newOffset <= 0,
      });
    }
  }, []);

  // Set absolute scroll offset
  const handleSetScrollOffset = useCallback((ptyId: string, offset: number): void => {
    setScrollOffset(ptyId, offset);
    // Update cache optimistically
    const cached = scrollStatesCache.current.get(ptyId);
    if (cached) {
      scrollStatesCache.current.set(ptyId, {
        ...cached,
        viewportOffset: Math.max(0, offset),
        isAtBottom: offset <= 0,
      });
    }
  }, []);

  // Scroll terminal to bottom
  const handleScrollToBottom = useCallback((ptyId: string): void => {
    scrollToBottom(ptyId);
    // Update cache optimistically
    const cached = scrollStatesCache.current.get(ptyId);
    if (cached) {
      scrollStatesCache.current.set(ptyId, {
        ...cached,
        viewportOffset: 0,
        isAtBottom: true,
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Unsubscribe all
      for (const unsub of unsubscribeFns.current.values()) {
        unsub();
      }
      destroyAllPtys();
    };
  }, []);

  const value: TerminalContextValue = {
    createPTY,
    destroyPTY: handleDestroyPTY,
    destroyAllPTYs: handleDestroyAllPTYs,
    writeToFocused,
    writeToPTY: handleWriteToPTY,
    pasteToFocused,
    resizePTY: handleResizePTY,
    setPanePosition: handleSetPanePosition,
    getFocusedCwd,
    getSessionCwd,
    getFocusedCursorKeyMode,
    isMouseTrackingEnabled: handleIsMouseTrackingEnabled,
    isAlternateScreen: handleIsAlternateScreen,
    getScrollState: handleGetScrollState,
    scrollTerminal,
    setScrollOffset: handleSetScrollOffset,
    scrollToBottom: handleScrollToBottom,
    isInitialized,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }
  return context;
}
