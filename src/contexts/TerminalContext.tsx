/**
 * Terminal context for managing PTY sessions and keyboard forwarding
 * Uses Effect services via bridge for all PTY operations.
 */

import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
  type ParentProps,
} from 'solid-js';

import { detectHostCapabilities } from '../terminal';
import type { TerminalState, TerminalScrollState } from '../core/types';
import {
  createScrollHandlers,
  createPtyLifecycleHandlers,
  createCacheAccessors,
} from './terminal';
import { getFocusedPtyId as getWorkspaceFocusedPtyId } from '../core/workspace-utils';
import { useLayout } from './LayoutContext';
import { useTitle } from './TitleContext';
import {
  writeToPty,
  resizePty,
  destroyPty,
  destroyAllPtys,
  setPanePosition,
  readFromClipboard,
  subscribeToAllTitleChanges,
  subscribeToPtyLifecycle,
  getSessionPtyMapping,
} from '../effect/bridge';
import {
  subscribeToPtyWithCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../hooks/usePtySubscription';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { isShimClient } from '../shim/mode';
import { getPtyState as getShimPtyState } from '../shim/client/state';

interface TerminalContextValue {
  /** Create a new PTY session for a pane */
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  /** Create a new pane with PTY in single render (no stutter) */
  createPaneWithPTY: (cwd?: string, title?: string) => Promise<string>;
  /** Destroy a PTY session. Set skipPaneClose=true if pane is already closed. */
  destroyPTY: (ptyId: string, options?: { skipPaneClose?: boolean }) => void;
  /** Destroy all PTY sessions */
  destroyAllPTYs: () => void;
  /** Suspend a session (save PTY mapping, unsubscribe without destroying) */
  suspendSession: (sessionId: string) => void;
  /** Resume a session (resubscribe to saved PTYs, returns paneId→ptyId map + missing panes) */
  resumeSession: (sessionId: string) => Promise<{
    mapping: Map<string, string>;
    missingPaneIds: string[];
  } | undefined>;
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
  /** Get the foreground process name for a specific PTY session */
  getSessionForegroundProcess: (ptyId: string) => Promise<string | undefined>;
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
  getEmulatorSync: (ptyId: string) => ITerminalEmulator | null;
  /** Get focused emulator synchronously */
  getFocusedEmulator: () => ITerminalEmulator | null;
  /** Get cached terminal state synchronously (for selection text extraction) */
  getTerminalStateSync: (ptyId: string) => TerminalState | null;
  /** Check if ghostty-vt is initialized */
  isInitialized: boolean;
  /** Find which session owns a PTY (returns sessionId and paneId, or null if not found) */
  findSessionForPty: (ptyId: string) => { sessionId: string; paneId: string } | null;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

interface TerminalProviderProps extends ParentProps {}

export function TerminalProvider(props: TerminalProviderProps) {
  const layout = useLayout();
  const { setPanePty, closePaneById, newPaneWithPty, getNewPaneDimensions } = layout;
  const titleContext = useTitle();
  let initialized = false;
  const [isInitialized, setIsInitialized] = createSignal(false);

  // Track ptyId -> paneId mapping for exit handling (current session)
  const ptyToPaneMap = new Map<string, string>();

  // Track PTYs by session ID for persistence across session switches
  // sessionId → Map<paneId, ptyId>
  const sessionPtyMap = new Map<string, Map<string, string>>();

  // Reverse index: ptyId → { sessionId, paneId } for O(1) lookups
  const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();

  // Unified caches for PTY state (used by usePtySubscription)
  const ptyCaches: PtyCaches = {
    scrollStates: new Map<string, TerminalScrollState>(),
    emulators: new Map<string, ITerminalEmulator>(),
  };
  const shouldCacheScrollState = !isShimClient();
  const getScrollState = (ptyId: string): TerminalScrollState | undefined => {
    if (!shouldCacheScrollState) {
      return getShimPtyState(ptyId)?.scrollState;
    }
    return ptyCaches.scrollStates.get(ptyId);
  };

  // Track unsubscribe functions for cleanup
  const unsubscribeFns = new Map<string, () => void>();

  // Track global title subscription
  let titleSubscriptionUnsub: (() => void) | null = null;
  let lifecycleSubscriptionUnsub: (() => void) | null = null;

  // Helper to get focused PTY ID (uses centralized utility)
  const getFocusedPtyId = (): string | undefined => {
    return getWorkspaceFocusedPtyId(layout.activeWorkspace);
  };

  // Create scroll handlers (extracted for reduced file size)
  const scrollHandlers = createScrollHandlers(getScrollState);

  // Create PTY lifecycle handlers (extracted for reduced file size)
  const ptyLifecycleHandlers = createPtyLifecycleHandlers({
    ptyToPaneMap,
    sessionPtyMap,
    ptyToSessionMap,
    ptyCaches,
    unsubscribeFns,
    closePaneById,
    setPanePty,
    newPaneWithPty,
    getNewPaneDimensions,
    shouldCacheScrollState,
  });

  // Create cache accessors (extracted for reduced file size)
  const cacheAccessors = createCacheAccessors({
    ptyCaches,
    ptyToPaneMap,
    ptyToSessionMap,
    getFocusedPtyId,
  });

  // Initialize ghostty-vt and detect host terminal capabilities on mount
  onMount(() => {
    if (initialized) return;
    initialized = true;

    // Detect host capabilities first (for graphics passthrough)
    detectHostCapabilities()
      .then(() => {
        if (!isShimClient()) {
          // Clean up any orphaned PTYs from previous hot reloads (dev mode)
          return destroyAllPtys();
        }
      })
      .then(() => {
        setIsInitialized(true);
        // Subscribe to title changes across all PTYs
        // Titles are stored in TitleContext (plain Map) to avoid layout store updates
        // which cause SolidJS reactivity cascades and screen flash
        subscribeToAllTitleChanges((event) => {
          // Find the pane associated with this PTY
          const paneId = ptyToPaneMap.get(event.ptyId);
          if (paneId && event.title) {
            // Update title in TitleContext (doesn't trigger layout re-renders)
            titleContext.setTitle(paneId, event.title);
          }
        }).then((unsub) => {
          titleSubscriptionUnsub = unsub;
        });
        subscribeToPtyLifecycle((event) => {
          if (event.type === 'destroyed') {
            ptyLifecycleHandlers.handlePtyDestroyed(event.ptyId);
          }
        }).then((unsub) => {
          lifecycleSubscriptionUnsub = unsub;
        });
      })
      .catch((err) => {
        console.error('Failed to initialize terminal:', err);
      });
  });

  // Cleanup on unmount
  onCleanup(() => {
    // Unsubscribe title subscription
    if (titleSubscriptionUnsub) {
      titleSubscriptionUnsub();
      titleSubscriptionUnsub = null;
    }
    if (lifecycleSubscriptionUnsub) {
      lifecycleSubscriptionUnsub();
      lifecycleSubscriptionUnsub = null;
    }
    // Unsubscribe all PTY subscriptions
    for (const unsub of unsubscribeFns.values()) {
      unsub();
    }
    if (!isShimClient()) {
      destroyAllPtys();
    }
    // Worker pool cleanup happens via runtime disposal
  });

  // Suspend a session: save PTY mapping and unsubscribe (but don't destroy PTYs)
  const handleSuspendSession = (sessionId: string) => {
    // Save current pane→pty mapping for this session
    const mapping = new Map<string, string>();
    for (const [ptyId, paneId] of ptyToPaneMap) {
      mapping.set(paneId, ptyId);
      // Populate reverse index for O(1) lookups
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
    }
    sessionPtyMap.set(sessionId, mapping);

    // Unsubscribe from all PTYs (stop rendering, but keep alive)
    for (const unsub of unsubscribeFns.values()) {
      unsub();
    }
    unsubscribeFns.clear();
    clearAllPtyCaches(ptyCaches);
    ptyToPaneMap.clear();
    // Note: DO NOT call destroyAllPtys() - PTYs stay alive
  };

  // Resume a session: resubscribe to saved PTYs
  const handleResumeSession = async (
    sessionId: string
  ): Promise<{ mapping: Map<string, string>; missingPaneIds: string[] } | undefined> => {
    const shimMapping = await getSessionPtyMapping(sessionId);
    const missingPaneIds = new Set(shimMapping?.stalePaneIds ?? []);
    const savedMapping = shimMapping?.mapping ?? sessionPtyMap.get(sessionId);
    if (!savedMapping || (savedMapping.size === 0 && missingPaneIds.size === 0)) {
      return undefined;
    }

    // Resubscribe to each PTY
    for (const [paneId, ptyId] of savedMapping) {
      try {
        // Subscribe to PTY with unified caches
        const unsub = await subscribeToPtyWithCaches(
          ptyId,
          paneId,
          ptyCaches,
          ptyLifecycleHandlers.handlePtyExit,
          { cacheScrollState: shouldCacheScrollState }
        );

        // Store unsubscribe function
        unsubscribeFns.set(ptyId, unsub);

        // Restore pty→pane mapping
        ptyToPaneMap.set(ptyId, paneId);
        ptyToSessionMap.set(ptyId, { sessionId, paneId });
      } catch {
        // PTY may have exited while suspended - remove from mapping
        savedMapping.delete(paneId);
        missingPaneIds.add(paneId);
      }
    }

    if (shimMapping) {
      sessionPtyMap.set(sessionId, new Map(savedMapping));
    }

    return { mapping: savedMapping, missingPaneIds: Array.from(missingPaneIds) };
  };

  // Cleanup PTYs for a deleted session
  const handleCleanupSessionPtys = (sessionId: string) => {
    const savedMapping = sessionPtyMap.get(sessionId);
    if (savedMapping) {
      for (const ptyId of savedMapping.values()) {
        // Unsubscribe if currently subscribed
        const unsub = unsubscribeFns.get(ptyId);
        if (unsub) {
          unsub();
          unsubscribeFns.delete(ptyId);
        }
        // Clean up reverse index
        ptyToSessionMap.delete(ptyId);
        // Destroy the PTY directly (don't use lifecycle handler as it closes panes)
        destroyPty(ptyId);
      }
      sessionPtyMap.delete(sessionId);
      return;
    }

    getSessionPtyMapping(sessionId).then((mappingInfo) => {
      if (!mappingInfo) return;
      for (const ptyId of mappingInfo.mapping.values()) {
        const unsub = unsubscribeFns.get(ptyId);
        if (unsub) {
          unsub();
          unsubscribeFns.delete(ptyId);
        }
        ptyToSessionMap.delete(ptyId);
        destroyPty(ptyId);
      }
    });
  };

  // Write to the focused pane's PTY
  const writeToFocused = (data: string) => {
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      // Fire and forget for responsive typing
      writeToPty(focusedPtyId, data);
    }
  };

  // Resize a PTY session
  const handleResizePTY = (ptyId: string, cols: number, rows: number) => {
    // Fire and forget
    resizePty(ptyId, cols, rows);
  };

  // Update pane position for graphics passthrough
  const handleSetPanePosition = (ptyId: string, x: number, y: number) => {
    // Fire and forget
    setPanePosition(ptyId, x, y);
  };

  // Write to a specific PTY
  const handleWriteToPTY = (ptyId: string, data: string) => {
    // Fire and forget for responsive typing
    writeToPty(ptyId, data);
  };

  // Paste from clipboard to the focused PTY
  const pasteToFocused = async (): Promise<boolean> => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) return false;

    const clipboardText = await readFromClipboard();
    if (!clipboardText) return false;

    writeToPty(focusedPtyId, clipboardText);
    return true;
  };

  const value: TerminalContextValue = {
    createPTY: ptyLifecycleHandlers.createPTY,
    createPaneWithPTY: ptyLifecycleHandlers.createPaneWithPTY,
    destroyPTY: ptyLifecycleHandlers.handleDestroyPTY,
    destroyAllPTYs: ptyLifecycleHandlers.handleDestroyAllPTYs,
    suspendSession: handleSuspendSession,
    resumeSession: handleResumeSession,
    cleanupSessionPtys: handleCleanupSessionPtys,
    writeToFocused,
    writeToPTY: handleWriteToPTY,
    pasteToFocused,
    resizePTY: handleResizePTY,
    setPanePosition: handleSetPanePosition,
    getFocusedCwd: cacheAccessors.getFocusedCwd,
    getSessionCwd: cacheAccessors.getSessionCwd,
    getSessionForegroundProcess: cacheAccessors.getSessionForegroundProcess,
    getFocusedCursorKeyMode: cacheAccessors.getFocusedCursorKeyMode,
    isMouseTrackingEnabled: cacheAccessors.isMouseTrackingEnabled,
    isAlternateScreen: cacheAccessors.isAlternateScreen,
    getScrollState: scrollHandlers.handleGetScrollState,
    scrollTerminal: scrollHandlers.scrollTerminal,
    setScrollOffset: scrollHandlers.handleSetScrollOffset,
    scrollToBottom: scrollHandlers.handleScrollToBottom,
    getEmulatorSync: cacheAccessors.getEmulatorSync,
    getFocusedEmulator: cacheAccessors.getFocusedEmulator,
    getTerminalStateSync: cacheAccessors.getTerminalStateSync,
    get isInitialized() { return isInitialized(); },
    findSessionForPty: cacheAccessors.findSessionForPty,
  };

  return (
    <TerminalContext.Provider value={value}>
      {props.children}
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
