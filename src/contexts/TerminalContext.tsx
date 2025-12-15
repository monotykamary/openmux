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
import { clampScrollOffset, calculateScrollDelta, isAtBottom } from '../core/scroll-utils';
import { getFocusedPtyId as getWorkspaceFocusedPtyId } from '../core/workspace-utils';
import { useLayout } from './LayoutContext';
import {
  createPtySession,
  writeToPty,
  resizePty,
  destroyPty,
  destroyAllPtys,
  getPtyCwd,
  getTerminalState,
  setPanePosition,
  getScrollState,
  setScrollOffset,
  scrollToBottom,
  readFromClipboard,
} from '../effect/bridge';
import {
  subscribeToPtyWithCaches,
  clearPtyCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../hooks/usePtySubscription';
import type { GhosttyEmulator } from '../terminal/ghostty-emulator';

interface TerminalContextValue {
  /** Create a new PTY session for a pane */
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  /** Destroy a PTY session */
  destroyPTY: (ptyId: string) => void;
  /** Destroy all PTY sessions */
  destroyAllPTYs: () => void;
  /** Suspend a session (save PTY mapping, unsubscribe without destroying) */
  suspendSession: (sessionId: string) => void;
  /** Resume a session (resubscribe to saved PTYs, returns paneId→ptyId map) */
  resumeSession: (sessionId: string) => Promise<Map<string, string> | undefined>;
  /** Cleanup PTYs for a deleted session */
  cleanupSessionPtys: (sessionId: string) => void;
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
  /** Get cached emulator synchronously (for selection text extraction) */
  getEmulatorSync: (ptyId: string) => GhosttyEmulator | null;
  /** Get cached terminal state synchronously (for selection text extraction) */
  getTerminalStateSync: (ptyId: string) => TerminalState | null;
  /** Check if ghostty is initialized */
  isInitialized: boolean;
  /** Find which session owns a PTY (returns sessionId and paneId, or null if not found) */
  findSessionForPty: (ptyId: string) => { sessionId: string; paneId: string } | null;
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

  // Track PTYs by session ID for persistence across session switches
  // sessionId → Map<paneId, ptyId>
  const sessionPtyMapRef = useRef<Map<string, Map<string, string>>>(new Map());

  // Unified caches for PTY state (used by usePtySubscription)
  const ptyCaches = useRef<PtyCaches>({
    terminalStates: new Map<string, TerminalState>(),
    scrollStates: new Map<string, TerminalScrollState>(),
    emulators: new Map<string, GhosttyEmulator>(),
  });

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

  // Handle PTY exit callback
  const handlePtyExit = useCallback((ptyId: string, paneId: string) => {
    const mappedPaneId = ptyToPaneMap.current.get(ptyId);
    if (mappedPaneId) {
      dispatch({ type: 'CLOSE_PANE_BY_ID', paneId: mappedPaneId });
      ptyToPaneMap.current.delete(ptyId);
    }
    // Also remove from session mappings
    for (const [, mapping] of sessionPtyMapRef.current) {
      for (const [pid, ptid] of mapping) {
        if (ptid === ptyId) mapping.delete(pid);
      }
    }
  }, [dispatch]);

  // Create a PTY session
  const createPTY = useCallback(async (paneId: string, cols: number, rows: number, cwd?: string): Promise<string> => {
    if (!isGhosttyInitialized()) {
      throw new Error('Ghostty not initialized');
    }

    const ptyId = await createPtySession({ cols, rows, cwd });

    // Track the mapping
    ptyToPaneMap.current.set(ptyId, paneId);

    // Subscribe to PTY with unified caches
    const unsub = await subscribeToPtyWithCaches(
      ptyId,
      paneId,
      ptyCaches.current,
      handlePtyExit
    );

    // Store unsubscribe function
    unsubscribeFns.current.set(ptyId, unsub);

    // Update the pane with the PTY ID
    dispatch({ type: 'SET_PANE_PTY', paneId, ptyId });

    return ptyId;
  }, [dispatch, handlePtyExit]);

  // Destroy a PTY session
  const handleDestroyPTY = useCallback((ptyId: string) => {
    // Unsubscribe from updates
    const unsub = unsubscribeFns.current.get(ptyId);
    if (unsub) {
      unsub();
      unsubscribeFns.current.delete(ptyId);
    }

    // Clear caches
    clearPtyCaches(ptyId, ptyCaches.current);
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
    clearAllPtyCaches(ptyCaches.current);
    ptyToPaneMap.current.clear();

    // Destroy all PTYs (fire and forget)
    destroyAllPtys();
  }, []);

  // Suspend a session: save PTY mapping and unsubscribe (but don't destroy PTYs)
  const handleSuspendSession = useCallback((sessionId: string) => {
    // Save current pane→pty mapping for this session
    const mapping = new Map<string, string>();
    for (const [ptyId, paneId] of ptyToPaneMap.current) {
      mapping.set(paneId, ptyId);
    }
    sessionPtyMapRef.current.set(sessionId, mapping);

    // Unsubscribe from all PTYs (stop rendering, but keep alive)
    for (const unsub of unsubscribeFns.current.values()) {
      unsub();
    }
    unsubscribeFns.current.clear();
    clearAllPtyCaches(ptyCaches.current);
    ptyToPaneMap.current.clear();
    // Note: DO NOT call destroyAllPtys() - PTYs stay alive
  }, []);

  // Resume a session: resubscribe to saved PTYs
  const handleResumeSession = useCallback(async (sessionId: string): Promise<Map<string, string> | undefined> => {
    const savedMapping = sessionPtyMapRef.current.get(sessionId);
    if (!savedMapping || savedMapping.size === 0) {
      return undefined;
    }

    // Resubscribe to each PTY
    for (const [paneId, ptyId] of savedMapping) {
      try {
        // Subscribe to PTY with unified caches
        const unsub = await subscribeToPtyWithCaches(
          ptyId,
          paneId,
          ptyCaches.current,
          handlePtyExit
        );

        // Store unsubscribe function
        unsubscribeFns.current.set(ptyId, unsub);

        // Restore pty→pane mapping
        ptyToPaneMap.current.set(ptyId, paneId);
      } catch (err) {
        // PTY may have exited while suspended - remove from mapping
        savedMapping.delete(paneId);
      }
    }

    return savedMapping;
  }, [handlePtyExit]);

  // Cleanup PTYs for a deleted session
  const handleCleanupSessionPtys = useCallback((sessionId: string) => {
    const savedMapping = sessionPtyMapRef.current.get(sessionId);
    if (savedMapping) {
      for (const ptyId of savedMapping.values()) {
        // Unsubscribe if currently subscribed
        const unsub = unsubscribeFns.current.get(ptyId);
        if (unsub) {
          unsub();
          unsubscribeFns.current.delete(ptyId);
        }
        // Destroy the PTY
        destroyPty(ptyId);
      }
      sessionPtyMapRef.current.delete(sessionId);
    }
  }, []);

  // Get CWD for a specific PTY session
  const getSessionCwd = useCallback(async (ptyId: string): Promise<string> => {
    return getPtyCwd(ptyId);
  }, []);

  // Helper to get focused PTY ID (uses centralized utility)
  const getFocusedPtyId = useCallback((): string | undefined => {
    return getWorkspaceFocusedPtyId(activeWorkspace);
  }, [activeWorkspace]);

  // Write to the focused pane's PTY
  const writeToFocused = useCallback((data: string) => {
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      // Reset scroll cache to bottom (typing auto-scrolls)
      const cached = ptyCaches.current.scrollStates.get(focusedPtyId);
      if (cached && cached.viewportOffset > 0) {
        ptyCaches.current.scrollStates.set(focusedPtyId, {
          ...cached,
          viewportOffset: 0,
          isAtBottom: true,
        });
      }
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
    // Reset scroll cache to bottom (typing auto-scrolls)
    const cached = ptyCaches.current.scrollStates.get(ptyId);
    if (cached && cached.viewportOffset > 0) {
      ptyCaches.current.scrollStates.set(ptyId, {
        ...cached,
        viewportOffset: 0,
        isAtBottom: true,
      });
    }
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

    // Reset scroll cache to bottom (pasting auto-scrolls)
    const cached = ptyCaches.current.scrollStates.get(focusedPtyId);
    if (cached && cached.viewportOffset > 0) {
      ptyCaches.current.scrollStates.set(focusedPtyId, {
        ...cached,
        viewportOffset: 0,
        isAtBottom: true,
      });
    }
    writeToPty(focusedPtyId, clipboardText);
    return true;
  }, [getFocusedPtyId]);

  // Get the cursor key mode from the focused pane (sync - uses cache)
  const getFocusedCursorKeyMode = useCallback((): 'normal' | 'application' => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return 'normal';

    const terminalState = ptyCaches.current.terminalStates.get(focusedPtyId);
    return terminalState?.cursorKeyMode ?? 'normal';
  }, [getFocusedPtyId]);

  // Check if mouse tracking is enabled for a PTY (sync - uses cache)
  const handleIsMouseTrackingEnabled = useCallback((ptyId: string): boolean => {
    const terminalState = ptyCaches.current.terminalStates.get(ptyId);
    return terminalState?.mouseTracking ?? false;
  }, []);

  // Check if terminal is in alternate screen mode (sync - uses cache)
  const handleIsAlternateScreen = useCallback((ptyId: string): boolean => {
    const terminalState = ptyCaches.current.terminalStates.get(ptyId);
    return terminalState?.alternateScreen ?? false;
  }, []);

  // Get scroll state for a PTY (sync - uses cache only for performance)
  // Cache is kept fresh by: optimistic updates in scrollTerminal/setScrollOffset,
  // and PTY subscription updates when terminal state changes
  const handleGetScrollState = useCallback((ptyId: string): TerminalScrollState | undefined => {
    return ptyCaches.current.scrollStates.get(ptyId);
  }, []);

  // Scroll terminal by delta lines
  const scrollTerminal = useCallback((ptyId: string, delta: number): void => {
    const cached = ptyCaches.current.scrollStates.get(ptyId);
    if (cached) {
      // Use utility for clamped scroll calculation
      const clampedOffset = calculateScrollDelta(cached.viewportOffset, delta, cached.scrollbackLength);
      setScrollOffset(ptyId, clampedOffset);
      // Update cache optimistically with clamped value
      ptyCaches.current.scrollStates.set(ptyId, {
        ...cached,
        viewportOffset: clampedOffset,
        isAtBottom: isAtBottom(clampedOffset),
      });
    } else {
      // Fallback: fetch state and then scroll (handles edge cases where cache isn't populated)
      getScrollState(ptyId).then((state) => {
        if (state) {
          // Use utility for clamped scroll calculation
          const clampedOffset = calculateScrollDelta(state.viewportOffset, delta, state.scrollbackLength);
          setScrollOffset(ptyId, clampedOffset);
          // Populate cache with clamped value
          ptyCaches.current.scrollStates.set(ptyId, {
            viewportOffset: clampedOffset,
            scrollbackLength: state.scrollbackLength,
            isAtBottom: isAtBottom(clampedOffset),
          });
        }
      });
    }
  }, []);

  // Set absolute scroll offset
  const handleSetScrollOffset = useCallback((ptyId: string, offset: number): void => {
    const cached = ptyCaches.current.scrollStates.get(ptyId);
    // Use utility for clamping to valid range
    const clampedOffset = cached
      ? clampScrollOffset(offset, cached.scrollbackLength)
      : Math.max(0, offset);
    setScrollOffset(ptyId, clampedOffset);
    // Update cache optimistically with clamped value
    if (cached) {
      ptyCaches.current.scrollStates.set(ptyId, {
        ...cached,
        viewportOffset: clampedOffset,
        isAtBottom: isAtBottom(clampedOffset),
      });
    }
  }, []);

  // Scroll terminal to bottom
  const handleScrollToBottom = useCallback((ptyId: string): void => {
    scrollToBottom(ptyId);
    // Update cache optimistically
    const cached = ptyCaches.current.scrollStates.get(ptyId);
    if (cached) {
      ptyCaches.current.scrollStates.set(ptyId, {
        ...cached,
        viewportOffset: 0,
        isAtBottom: true,
      });
    }
  }, []);

  // Get cached emulator synchronously (for selection text extraction)
  const getEmulatorSync = useCallback((ptyId: string): GhosttyEmulator | null => {
    return ptyCaches.current.emulators.get(ptyId) ?? null;
  }, []);

  // Get cached terminal state synchronously (for selection text extraction)
  const getTerminalStateSync = useCallback((ptyId: string): TerminalState | null => {
    return ptyCaches.current.terminalStates.get(ptyId) ?? null;
  }, []);

  // Find which session owns a PTY
  const findSessionForPty = useCallback((ptyId: string): { sessionId: string; paneId: string } | null => {
    // First check current session's ptyToPaneMap (active PTYs)
    const currentPaneId = ptyToPaneMap.current.get(ptyId);
    if (currentPaneId) {
      // PTY is in the current session - find which session that is
      // by checking sessionPtyMapRef for a session that has this mapping
      for (const [sessionId, mapping] of sessionPtyMapRef.current) {
        for (const [paneId, mappedPtyId] of mapping) {
          if (mappedPtyId === ptyId) {
            return { sessionId, paneId };
          }
        }
      }
      // If not found in sessionPtyMapRef, it's in the current unsaved session
      // Return null for now - the caller should handle current session separately
      return null;
    }

    // Search through all session PTY mappings
    for (const [sessionId, mapping] of sessionPtyMapRef.current) {
      for (const [paneId, mappedPtyId] of mapping) {
        if (mappedPtyId === ptyId) {
          return { sessionId, paneId };
        }
      }
    }

    return null;
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
    suspendSession: handleSuspendSession,
    resumeSession: handleResumeSession,
    cleanupSessionPtys: handleCleanupSessionPtys,
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
    getEmulatorSync,
    getTerminalStateSync,
    isInitialized,
    findSessionForPty,
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
