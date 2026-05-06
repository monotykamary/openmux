/**
 * State container for the shim client PTY registry.
 *
 * All subscriber maps, PTY caches, and emulator state are scoped to a
 * ShimPtyRegistry instance rather than bare module-level globals. A default
 * singleton is provided for production use; tests can create isolated instances
 * or call resetAllPtyState() to reset the default.
 */

import type {
  TerminalCell,
  TerminalScrollState,
  TerminalState,
  UnifiedTerminalUpdate,
} from '../../core/types';
import type {
  ITerminalEmulator,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
} from '../../terminal/emulator-interface';
import { tracePtyEvent } from '../../terminal/pty-trace';
import type { ShimPtyMetadata } from '../pty-metadata';

type ScrollbackAwareEmulator = ITerminalEmulator & {
  handleScrollbackChange?: (newLength: number, isAtScrollbackLimit: boolean) => void;
};

export type PtyState = {
  terminalState: TerminalState | null;
  cachedRows: TerminalCell[][];
  scrollState: TerminalScrollState;
  title: string;
};

export type KittyGraphicsImageEntry = {
  info: KittyGraphicsImageInfo;
  data: Uint8Array | null;
};

export type KittyGraphicsState = {
  images: Map<number, KittyGraphicsImageEntry>;
  placements: KittyGraphicsPlacement[];
  dirty: boolean;
  seedImageIds: Set<number>;
};

export type KittyScreenKey = 'main' | 'alt';
type KittyScreenState = {
  main: KittyGraphicsState;
  alt: KittyGraphicsState;
};

export type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: string };

export type TitleEvent = { ptyId: string; title: string };
export type ActivityEvent = { ptyId: string };

export type KittyTransmitEvent = { ptyId: string; sequence: string };
export type KittyUpdateEvent = { ptyId: string };

type UnifiedSubscriber = (update: UnifiedTerminalUpdate) => void;

export type MetadataCacheEntry = {
  value: ShimPtyMetadata;
  fetchedAt: number;
  stale: boolean;
};

const MAX_PENDING_KITTY_TRANSMITS = 2048;

/**
 * Isolated state container for the shim client PTY registry.
 *
 * Wraps all subscriber maps, PTY caches, and emulator state in a single object.
 * This enables proper test isolation (each test can create a fresh instance)
 * and future multi-instance support without rewriting call sites.
 *
 * The module-level exported functions delegate to a default singleton for
 * backward compatibility.
 */
export class ShimPtyRegistry {
  readonly unifiedSubscribers = new Map<string, Set<UnifiedSubscriber>>();
  readonly stateSubscribers = new Map<string, Set<(state: TerminalState) => void>>();
  readonly scrollSubscribers = new Map<string, Set<() => void>>();
  readonly exitSubscribers = new Map<string, Set<(exitCode: number) => void>>();
  readonly titleSubscribers = new Map<string, Set<(title: string) => void>>();
  readonly globalTitleSubscribers = new Set<(event: TitleEvent) => void>();
  readonly activitySubscribers = new Set<(event: ActivityEvent) => void>();
  readonly lifecycleSubscribers = new Set<(event: LifecycleEvent) => void>();
  readonly kittyTransmitSubscribers = new Set<(event: KittyTransmitEvent) => void>();
  readonly kittyUpdateSubscribers = new Set<(event: KittyUpdateEvent) => void>();
  readonly pendingKittyTransmitEvents: KittyTransmitEvent[] = [];

  readonly ptyStates = new Map<string, PtyState>();
  readonly emulatorCache = new Map<string, ScrollbackAwareEmulator>();
  emulatorFactory: ((ptyId: string) => ScrollbackAwareEmulator) | null = null;
  readonly kittyStates = new Map<string, KittyScreenState>();
  readonly metadataCache = new Map<string, MetadataCacheEntry>();

  /** Dispose all cached emulators and clear all state. */
  reset(): void {
    for (const emulator of this.emulatorCache.values()) {
      emulator.dispose?.();
    }
    this.unifiedSubscribers.clear();
    this.stateSubscribers.clear();
    this.scrollSubscribers.clear();
    this.exitSubscribers.clear();
    this.titleSubscribers.clear();
    this.ptyStates.clear();
    this.emulatorCache.clear();
    this.kittyStates.clear();
    this.metadataCache.clear();
    this.globalTitleSubscribers.clear();
    this.activitySubscribers.clear();
    this.lifecycleSubscribers.clear();
    this.kittyTransmitSubscribers.clear();
    this.kittyUpdateSubscribers.clear();
    this.pendingKittyTransmitEvents.length = 0;
    this.emulatorFactory = null;
  }

  clearPtySubscribers(ptyId: string): void {
    this.unifiedSubscribers.delete(ptyId);
    this.stateSubscribers.delete(ptyId);
    this.scrollSubscribers.delete(ptyId);
    this.exitSubscribers.delete(ptyId);
    this.titleSubscribers.delete(ptyId);
  }

  deletePtyState(ptyId: string): void {
    this.ptyStates.delete(ptyId);
    this.emulatorCache.delete(ptyId);
    this.kittyStates.delete(ptyId);

    for (let i = this.pendingKittyTransmitEvents.length - 1; i >= 0; i--) {
      if (this.pendingKittyTransmitEvents[i]?.ptyId === ptyId) {
        this.pendingKittyTransmitEvents.splice(i, 1);
      }
    }
  }

  private createEmptyKittyState(): KittyGraphicsState {
    return { images: new Map(), placements: [], dirty: false, seedImageIds: new Set() };
  }

  private getKittyScreenState(ptyId: string, screen: KittyScreenKey): KittyGraphicsState {
    let state = this.kittyStates.get(ptyId);
    if (!state) {
      state = { main: this.createEmptyKittyState(), alt: this.createEmptyKittyState() };
      this.kittyStates.set(ptyId, state);
    }
    return state[screen];
  }

  private updateCachedMetadataTitle(ptyId: string, title: string): void {
    const cached = this.metadataCache.get(ptyId);
    if (cached) {
      cached.value.title = title;
    }
  }

  private applyUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
    const existing = this.ptyStates.get(ptyId);

    if (update.terminalUpdate.isFull && update.terminalUpdate.fullState) {
      const fullState = update.terminalUpdate.fullState;
      if (update.terminalUpdate.kittyKeyboardFlags !== undefined) {
        fullState.kittyKeyboardFlags = update.terminalUpdate.kittyKeyboardFlags;
      }
      this.ptyStates.set(ptyId, {
        terminalState: fullState,
        cachedRows: [...fullState.cells],
        scrollState: update.scrollState,
        title: existing?.title ?? '',
      });
    } else if (existing?.terminalState) {
      const cachedRows = existing.cachedRows;
      for (const [rowIdx, newRow] of update.terminalUpdate.dirtyRows) {
        cachedRows[rowIdx] = newRow;
      }

      const nextState: TerminalState = {
        ...existing.terminalState,
        cells: cachedRows,
        cursor: update.terminalUpdate.cursor,
        alternateScreen: update.terminalUpdate.alternateScreen,
        mouseTracking: update.terminalUpdate.mouseTracking,
        cursorKeyMode: update.terminalUpdate.cursorKeyMode,
        kittyKeyboardFlags:
          update.terminalUpdate.kittyKeyboardFlags ??
          existing.terminalState.kittyKeyboardFlags ??
          0,
      };

      this.ptyStates.set(ptyId, {
        terminalState: nextState,
        cachedRows,
        scrollState: update.scrollState,
        title: existing.title,
      });
    } else {
      this.ptyStates.set(ptyId, {
        terminalState: update.terminalUpdate.fullState ?? null,
        cachedRows: update.terminalUpdate.fullState?.cells
          ? [...update.terminalUpdate.fullState.cells]
          : [],
        scrollState: update.scrollState,
        title: existing?.title ?? '',
      });
    }

    const emulator = this.emulatorCache.get(ptyId);
    emulator?.handleScrollbackChange?.(
      update.scrollState.scrollbackLength,
      update.scrollState.isAtScrollbackLimit ?? false
    );
  }

  private notifySubscribers(ptyId: string, update: UnifiedTerminalUpdate): void {
    const unified = this.unifiedSubscribers.get(ptyId);
    if (unified) {
      for (const callback of unified) {
        callback(update);
      }
    }

    const state = this.ptyStates.get(ptyId)?.terminalState;
    if (state) {
      const legacy = this.stateSubscribers.get(ptyId);
      if (legacy) {
        for (const callback of legacy) {
          callback(state);
        }
      }
    }

    const scroll = this.scrollSubscribers.get(ptyId);
    if (scroll) {
      for (const callback of scroll) {
        callback();
      }
    }
  }

  // --- Public API methods ---

  registerEmulatorFactory(factory: (ptyId: string) => ScrollbackAwareEmulator): void {
    this.emulatorFactory = factory;
  }

  getEmulator(ptyId: string): ITerminalEmulator {
    let emulator = this.emulatorCache.get(ptyId);
    if (!emulator) {
      if (!this.emulatorFactory) {
        throw new Error('Emulator factory not registered');
      }
      emulator = this.emulatorFactory(ptyId);
      this.emulatorCache.set(ptyId, emulator);
    }
    return emulator;
  }

  getPtyState(ptyId: string): PtyState | undefined {
    return this.ptyStates.get(ptyId);
  }

  setPtyState(ptyId: string, state: PtyState): void {
    this.ptyStates.set(ptyId, state);
  }

  handleUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
    this.applyUnifiedUpdate(ptyId, update);
    this.notifySubscribers(ptyId, update);
  }

  handlePtyExit(ptyId: string, exitCode: number): void {
    const subscribers = this.exitSubscribers.get(ptyId);
    if (subscribers) {
      for (const callback of subscribers) {
        callback(exitCode);
      }
    }
  }

  handlePtyTitle(ptyId: string, title: string): void {
    const existing = this.ptyStates.get(ptyId);
    if (existing) {
      existing.title = title;
    } else {
      this.ptyStates.set(ptyId, {
        terminalState: null,
        cachedRows: [],
        scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
        title,
      });
    }

    this.updateCachedMetadataTitle(ptyId, title);

    const perPty = this.titleSubscribers.get(ptyId);
    if (perPty) {
      for (const callback of perPty) {
        callback(title);
      }
    }
    for (const callback of this.globalTitleSubscribers) {
      callback({ ptyId, title });
    }
  }

  handlePtyActivity(ptyId: string): void {
    const cached = this.metadataCache.get(ptyId);
    if (cached) {
      cached.stale = true;
    }

    for (const callback of this.activitySubscribers) {
      callback({ ptyId });
    }
  }

  setCachedPtyMetadata(ptyId: string, metadata: ShimPtyMetadata): void {
    this.metadataCache.set(ptyId, {
      value: metadata,
      fetchedAt: Date.now(),
      stale: false,
    });
  }

  getCachedPtyMetadata(
    ptyId: string
  ): { value: ShimPtyMetadata; fetchedAt: number; stale: boolean } | undefined {
    const entry = this.metadataCache.get(ptyId);
    if (!entry) {
      return undefined;
    }
    return {
      value: entry.value,
      fetchedAt: entry.fetchedAt,
      stale: entry.stale,
    };
  }

  handlePtyLifecycle(ptyId: string, eventType: 'created' | 'destroyed'): void {
    if (eventType === 'destroyed') {
      this.deletePtyState(ptyId);
      this.clearPtySubscribers(ptyId);
    }
    for (const callback of this.lifecycleSubscribers) {
      callback({ type: eventType, ptyId });
    }
  }

  handlePtyKittyUpdate(
    ptyId: string,
    update: {
      images: KittyGraphicsImageInfo[];
      placements: KittyGraphicsPlacement[];
      removedImageIds: number[];
      imageData: Map<number, Uint8Array>;
      alternateScreen: boolean;
    }
  ): void {
    const screen: KittyScreenKey = update.alternateScreen ? 'alt' : 'main';
    const existing = this.getKittyScreenState(ptyId, screen);
    const nextImages = new Map<number, KittyGraphicsImageEntry>();

    for (const info of update.images) {
      const previous = existing?.images.get(info.id);
      const data = update.imageData.get(info.id) ?? previous?.data ?? null;
      nextImages.set(info.id, { info, data });
    }

    for (const id of update.removedImageIds) {
      nextImages.delete(id);
    }

    const nextState: KittyGraphicsState = {
      images: nextImages,
      placements: update.placements,
      dirty: true,
      seedImageIds: new Set(update.imageData.keys()),
    };
    const bundle = this.kittyStates.get(ptyId) ?? {
      main: this.createEmptyKittyState(),
      alt: this.createEmptyKittyState(),
    };
    bundle[screen] = nextState;
    this.kittyStates.set(ptyId, bundle);

    tracePtyEvent('kitty-client-update', {
      ptyId,
      screen,
      images: nextImages.size,
      placements: update.placements.length,
      removed: update.removedImageIds.length,
      imageData: update.imageData.size,
    });

    for (const callback of this.kittyUpdateSubscribers) {
      callback({ ptyId });
    }
  }

  handlePtyKittyTransmit(ptyId: string, sequence: string): void {
    const event: KittyTransmitEvent = { ptyId, sequence };

    if (this.kittyTransmitSubscribers.size === 0) {
      this.pendingKittyTransmitEvents.push(event);
      if (this.pendingKittyTransmitEvents.length > MAX_PENDING_KITTY_TRANSMITS) {
        this.pendingKittyTransmitEvents.splice(
          0,
          this.pendingKittyTransmitEvents.length - MAX_PENDING_KITTY_TRANSMITS
        );
      }
      return;
    }

    for (const callback of this.kittyTransmitSubscribers) {
      callback(event);
    }
  }

  getKittyState(ptyId: string, alternateScreen: boolean = false): KittyGraphicsState | undefined {
    const state = this.kittyStates.get(ptyId);
    if (!state) return undefined;
    return alternateScreen ? state.alt : state.main;
  }

  subscribeUnified(ptyId: string, callback: UnifiedSubscriber): () => void {
    const set = this.unifiedSubscribers.get(ptyId) ?? new Set<UnifiedSubscriber>();
    set.add(callback);
    this.unifiedSubscribers.set(ptyId, set);

    const cached = this.ptyStates.get(ptyId);
    if (cached?.terminalState) {
      const fullState = cached.terminalState;
      const scrollState = cached.scrollState;
      const initialUpdate: UnifiedTerminalUpdate = {
        terminalUpdate: {
          dirtyRows: new Map(),
          cursor: fullState.cursor,
          scrollState,
          cols: fullState.cols,
          rows: fullState.rows,
          isFull: true,
          fullState,
          alternateScreen: fullState.alternateScreen,
          mouseTracking: fullState.mouseTracking,
          cursorKeyMode: fullState.cursorKeyMode ?? 'normal',
          kittyKeyboardFlags: fullState.kittyKeyboardFlags ?? 0,
          inBandResize: false,
        },
        scrollState,
      };
      callback(initialUpdate);
    }

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.unifiedSubscribers.delete(ptyId);
      }
    };
  }

  subscribeState(ptyId: string, callback: (state: TerminalState) => void): () => void {
    const set = this.stateSubscribers.get(ptyId) ?? new Set<(state: TerminalState) => void>();
    set.add(callback);
    this.stateSubscribers.set(ptyId, set);

    const cached = this.ptyStates.get(ptyId)?.terminalState;
    if (cached) {
      callback(cached);
    }

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.stateSubscribers.delete(ptyId);
      }
    };
  }

  subscribeScroll(ptyId: string, callback: () => void): () => void {
    const set = this.scrollSubscribers.get(ptyId) ?? new Set<() => void>();
    set.add(callback);
    this.scrollSubscribers.set(ptyId, set);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.scrollSubscribers.delete(ptyId);
      }
    };
  }

  subscribeExit(ptyId: string, callback: (exitCode: number) => void): () => void {
    const set = this.exitSubscribers.get(ptyId) ?? new Set<(exitCode: number) => void>();
    set.add(callback);
    this.exitSubscribers.set(ptyId, set);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.exitSubscribers.delete(ptyId);
      }
    };
  }

  subscribeToTitle(ptyId: string, callback: (title: string) => void): () => void {
    const set = this.titleSubscribers.get(ptyId) ?? new Set<(title: string) => void>();
    set.add(callback);
    this.titleSubscribers.set(ptyId, set);

    const cached = this.ptyStates.get(ptyId)?.title;
    if (cached) {
      callback(cached);
    }

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.titleSubscribers.delete(ptyId);
      }
    };
  }

  subscribeToAllTitles(callback: (event: TitleEvent) => void): () => void {
    this.globalTitleSubscribers.add(callback);
    return () => {
      this.globalTitleSubscribers.delete(callback);
    };
  }

  subscribeToActivity(callback: (event: ActivityEvent) => void): () => void {
    this.activitySubscribers.add(callback);
    return () => {
      this.activitySubscribers.delete(callback);
    };
  }

  subscribeToLifecycle(callback: (event: LifecycleEvent) => void): () => void {
    this.lifecycleSubscribers.add(callback);
    return () => {
      this.lifecycleSubscribers.delete(callback);
    };
  }

  subscribeKittyTransmit(callback: (event: KittyTransmitEvent) => void): () => void {
    this.kittyTransmitSubscribers.add(callback);

    if (this.pendingKittyTransmitEvents.length > 0) {
      const pending = this.pendingKittyTransmitEvents.splice(
        0,
        this.pendingKittyTransmitEvents.length
      );
      for (const event of pending) {
        callback(event);
      }
    }

    return () => {
      this.kittyTransmitSubscribers.delete(callback);
    };
  }

  subscribeKittyUpdate(callback: (event: KittyUpdateEvent) => void): () => void {
    this.kittyUpdateSubscribers.add(callback);
    return () => {
      this.kittyUpdateSubscribers.delete(callback);
    };
  }
}

/** Default singleton registry for production use. */
export const defaultRegistry = new ShimPtyRegistry();

/**
 * Resets all global state. Used for test isolation.
 * @internal
 */
export function resetAllPtyState(): void {
  defaultRegistry.reset();
}
