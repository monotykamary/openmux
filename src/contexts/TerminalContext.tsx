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
import { useRenderer, useTerminalDimensions } from '@opentui/solid';

import { detectHostCapabilities, getKittyGraphicsRenderer } from '../terminal';
import type { TerminalState, TerminalScrollState } from '../core/types';
import {
  createScrollHandlers,
  createPtyLifecycleHandlers,
  createCacheAccessors,
  createHostColorSync,
} from './terminal';
import { getFocusedPtyId as getWorkspaceFocusedPtyId } from '../core/workspace-utils';
import { useLayout } from './LayoutContext';
import { useTitle } from './TitleContext';
import {
  writeToPty,
  resizePty,
  destroyPty,
  destroyAllPtys,
  readFromClipboard,
  subscribeToAllTitleChanges,
  subscribeToPtyLifecycle,
  getSessionPtyMapping,
  waitForShimClient,
} from '../effect/bridge';
import {
  subscribeToPtyWithCaches,
  clearAllPtyCaches,
  type PtyCaches,
} from '../hooks/usePtySubscription';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { isShimClient } from '../shim/mode';
import { defaultRegistry as shimPtyRegistry } from '../shim/client/state';

export interface TerminalContextValue {
  /** Create a new PTY session for a pane */
  createPTY: (paneId: string, cols: number, rows: number, cwd?: string) => Promise<string>;
  /** Create a new pane with PTY in single render (no stutter) */
  createPaneWithPTY: (
    cwd?: string,
    title?: string,
    options?: {
      onCreated?: (created: { paneId: string; ptyId: string }) => void;
    }
  ) => Promise<{ paneId: string; ptyId: string } | null>;
  /** Destroy a PTY session. Set skipPaneClose=true if pane is already closed. */
  destroyPTY: (ptyId: string, options?: { skipPaneClose?: boolean }) => void;
  /** Destroy all PTY sessions */
  destroyAllPTYs: () => void;
  /** Suspend a session (save PTY mapping, unsubscribe without destroying) */
  suspendSession: (sessionId: string) => void;
  /** Resume a session (resubscribe to saved PTYs, returns paneId→ptyId map + missing panes) */
  resumeSession: (sessionId: string) => Promise<
    | {
        mapping: Map<string, string>;
        missingPaneIds: string[];
      }
    | undefined
  >;
  /** Cleanup PTYs for a deleted session */
  cleanupSessionPtys: (sessionId: string) => Promise<void>;
  /** Write input to the focused pane's PTY */
  writeToFocused: (data: string) => void;
  /** Write input to a specific PTY */
  writeToPTY: (ptyId: string, data: string) => void;
  /** Paste from clipboard to the focused pane's PTY */
  pasteToFocused: () => Promise<boolean>;
  /** Resize a PTY session */
  resizePTY: (
    ptyId: string,
    cols: number,
    rows: number,
    pixelWidth?: number,
    pixelHeight?: number
  ) => void;
  /** Get the current working directory of the focused pane */
  getFocusedCwd: () => Promise<string | null>;
  /** Get the CWD for a specific PTY session */
  getSessionCwd: (ptyId: string) => Promise<string>;
  /** Get the foreground process name for a specific PTY session */
  getSessionForegroundProcess: (ptyId: string) => Promise<string | undefined>;
  /** Get the last shell command captured for a specific PTY session */
  getSessionLastCommand: (ptyId: string) => Promise<string | undefined>;
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
  /** Refresh cached host terminal colors and apply to emulators */
  refreshHostColors: (options?: {
    timeoutMs?: number;
    forceApply?: boolean;
    oscMode?: 'fast' | 'full';
  }) => Promise<boolean>;
  /** Version counter for host color changes */
  hostColorsVersion: number;
  /** Find which session owns a PTY (returns sessionId and paneId, or null if not found) */
  findSessionForPty: (ptyId: string) => { sessionId: string; paneId: string } | null;
  /** Check if a PTY is currently tracked */
  isPtyActive: (ptyId: string) => boolean;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

interface TerminalProviderProps extends ParentProps {}

export function TerminalProvider(props: TerminalProviderProps) {
  const layout = useLayout();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const { setPanePty, closePaneById, newPaneWithPty, getNewPaneDimensions } = layout;
  const titleContext = useTitle();
  let isActive = true;
  let initialized = false;
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [hostColorsVersion, setHostColorsVersion] = createSignal(0);

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
      return shimPtyRegistry.getPtyState(ptyId)?.scrollState;
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
    getCellMetrics: () => {
      const r = renderer as {
        resolution?: { width: number; height: number } | null;
        terminalWidth?: number;
        terminalHeight?: number;
        width?: number;
        height?: number;
      };
      const resolution = r?.resolution ?? null;
      const terminalWidth = dimensions().width || r?.terminalWidth || r?.width || 0;
      const terminalHeight = dimensions().height || r?.terminalHeight || r?.height || 0;
      if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;
      return {
        cellWidth: Math.max(1, Math.floor(resolution.width / terminalWidth)),
        cellHeight: Math.max(1, Math.floor(resolution.height / terminalHeight)),
      };
    },
    shouldCacheScrollState,
    onPtyDestroyed: (ptyId) => {
      getKittyGraphicsRenderer()?.markPtyDestroyed(ptyId);
      scrollHandlers.removeAnimation(ptyId);
    },
  });

  // Create cache accessors (extracted for reduced file size)
  const cacheAccessors = createCacheAccessors({
    ptyCaches,
    ptyToPaneMap,
    ptyToSessionMap,
    getFocusedPtyId,
  });

  const hostColorSync = createHostColorSync({
    renderer,
    isActive: () => isActive,
    bumpHostColorsVersion: () => setHostColorsVersion((version) => version + 1),
  });
  const { refreshHostColors } = hostColorSync;

  const isPtyActive = (ptyId: string): boolean =>
    ptyToPaneMap.has(ptyId) || ptyToSessionMap.has(ptyId);

  // Initialize ghostty-vt and detect host terminal capabilities on mount
  onMount(() => {
    if (initialized) return;
    initialized = true;

    if (isShimClient()) {
      waitForShimClient().catch((e) => {
        console.warn('[TerminalContext] Shim client wait failed:', e);
      });
    }

    // Detect host capabilities first (for graphics passthrough)
    detectHostCapabilities()
      .then(() => {
        if (!isActive) return;
        if (!isShimClient()) {
          // Clean up any orphaned PTYs from previous hot reloads (dev mode)
          return destroyAllPtys();
        }
      })
      .then(() => {
        if (!isActive) return;
        setIsInitialized(true);
        hostColorSync.start();
        // Subscribe to title changes across all PTYs
        // Titles are stored in TitleContext (plain Map) to avoid layout store updates
        // which cause SolidJS reactivity cascades and screen flash
        subscribeToAllTitleChanges((event) => {
          // Find the pane associated with this PTY
          const paneId = ptyToPaneMap.get(event.ptyId);
          if (!paneId) return;
          const trimmed = event.title.trim();
          if (trimmed) {
            // Update title in TitleContext (doesn't trigger layout re-renders)
            titleContext.setTitle(paneId, trimmed);
          } else {
            titleContext.clearAutoTitle(paneId);
          }
        }).then((unsub) => {
          if (!isActive) {
            unsub();
            return;
          }
          titleSubscriptionUnsub = unsub;
        });
        subscribeToPtyLifecycle((event) => {
          if (event.type === 'destroyed') {
            ptyLifecycleHandlers.handlePtyDestroyed(event.ptyId);
          }
        }).then((unsub) => {
          if (!isActive) {
            unsub();
            return;
          }
          lifecycleSubscriptionUnsub = unsub;
        });
      })
      .catch((err) => {
        if (isActive) {
          console.error('Failed to initialize terminal:', err);
        }
      });
  });

  // Cleanup on unmount
  onCleanup(() => {
    isActive = false;
    hostColorSync.stop();
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
    // Clean up scroll animation loop
    scrollHandlers.cleanup();
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
    const baseSavedMapping = shimMapping?.mapping ?? sessionPtyMap.get(sessionId);
    if (!baseSavedMapping || (baseSavedMapping.size === 0 && missingPaneIds.size === 0)) {
      return undefined;
    }

    const savedMapping = new Map(baseSavedMapping);
    sessionPtyMap.set(sessionId, new Map(savedMapping));

    // Restore the pane/session ownership synchronously so layout loading can proceed
    // immediately. Subscription/cache hydration happens in the background.
    for (const [paneId, ptyId] of savedMapping) {
      ptyToPaneMap.set(ptyId, paneId);
      ptyToSessionMap.set(ptyId, { sessionId, paneId });
    }

    for (const [paneId, ptyId] of savedMapping) {
      void subscribeToPtyWithCaches(ptyId, paneId, ptyCaches, ptyLifecycleHandlers.handlePtyExit, {
        cacheScrollState: shouldCacheScrollState,
      })
        .then((unsub) => {
          const currentPtyId = sessionPtyMap.get(sessionId)?.get(paneId);
          const currentOwner = ptyToSessionMap.get(ptyId);
          if (
            currentPtyId !== ptyId ||
            !currentOwner ||
            currentOwner.sessionId !== sessionId ||
            currentOwner.paneId !== paneId
          ) {
            unsub();
            return;
          }

          const previousUnsub = unsubscribeFns.get(ptyId);
          if (previousUnsub) {
            previousUnsub();
          }
          unsubscribeFns.set(ptyId, unsub);
        })
        .catch((error) => {
          console.warn(`[TerminalContext] Failed to resume PTY ${ptyId}:`, error);
        });
    }

    return { mapping: savedMapping, missingPaneIds: Array.from(missingPaneIds) };
  };

  // Cleanup PTYs for a deleted session
  const handleCleanupSessionPtys = (sessionId: string): Promise<void> => {
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
      return Promise.resolve();
    }

    return getSessionPtyMapping(sessionId).then((mappingInfo) => {
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
  const handleResizePTY = (
    ptyId: string,
    cols: number,
    rows: number,
    pixelWidth?: number,
    pixelHeight?: number
  ) => {
    // Fire and forget
    resizePty(ptyId, cols, rows, pixelWidth, pixelHeight);
  };

  // Write to a specific PTY
  const handleWriteToPTY = (ptyId: string, data: string) => {
    // Fire and forget for responsive typing
    writeToPty(ptyId, data);
  };

  // Paste from clipboard to the focused PTY
  const pasteToFocused = async (): Promise<boolean> => {
    const focusedPtyId = getFocusedPtyId();
    if (!focusedPtyId) {
      console.warn('[paste] No focused pane to paste into');
      return false;
    }

    const clipboardText = await readFromClipboard();
    if (!clipboardText) {
      console.warn(
        '[paste] Clipboard is empty or unavailable. On Linux, install wl-clipboard (Wayland) or xclip/xsel (X11).'
      );
      return false;
    }

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
    getFocusedCwd: cacheAccessors.getFocusedCwd,
    getSessionCwd: cacheAccessors.getSessionCwd,
    getSessionForegroundProcess: cacheAccessors.getSessionForegroundProcess,
    getSessionLastCommand: cacheAccessors.getSessionLastCommand,
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
    get isInitialized() {
      return isInitialized();
    },
    refreshHostColors,
    get hostColorsVersion() {
      return hostColorsVersion();
    },
    findSessionForPty: cacheAccessors.findSessionForPty,
    isPtyActive,
  };

  return <TerminalContext.Provider value={value}>{props.children}</TerminalContext.Provider>;
}

export function useTerminal(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within TerminalProvider');
  }
  return context;
}
