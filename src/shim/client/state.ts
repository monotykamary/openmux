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
};

export type LifecycleEvent = { type: 'created' | 'destroyed'; ptyId: string };

export type TitleEvent = { ptyId: string; title: string };

export type KittyTransmitEvent = { ptyId: string; sequence: string };

type UnifiedSubscriber = (update: UnifiedTerminalUpdate) => void;

const unifiedSubscribers = new Map<string, Set<UnifiedSubscriber>>();
const stateSubscribers = new Map<string, Set<(state: TerminalState) => void>>();
const scrollSubscribers = new Map<string, Set<() => void>>();
const exitSubscribers = new Map<string, Set<(exitCode: number) => void>>();
const titleSubscribers = new Map<string, Set<(title: string) => void>>();
const globalTitleSubscribers = new Set<(event: TitleEvent) => void>();
const lifecycleSubscribers = new Set<(event: LifecycleEvent) => void>();
const kittyTransmitSubscribers = new Set<(event: KittyTransmitEvent) => void>();

const ptyStates = new Map<string, PtyState>();
const emulatorCache = new Map<string, ScrollbackAwareEmulator>();
let emulatorFactory: ((ptyId: string) => ScrollbackAwareEmulator) | null = null;
const kittyStates = new Map<string, KittyGraphicsState>();

function clearPtySubscribers(ptyId: string): void {
  unifiedSubscribers.delete(ptyId);
  stateSubscribers.delete(ptyId);
  scrollSubscribers.delete(ptyId);
  exitSubscribers.delete(ptyId);
  titleSubscribers.delete(ptyId);
}

export function registerEmulatorFactory(factory: (ptyId: string) => ScrollbackAwareEmulator): void {
  emulatorFactory = factory;
}

export function getEmulator(ptyId: string): ITerminalEmulator {
  let emulator = emulatorCache.get(ptyId);
  if (!emulator) {
    if (!emulatorFactory) {
      throw new Error('Emulator factory not registered');
    }
    emulator = emulatorFactory(ptyId);
    emulatorCache.set(ptyId, emulator);
  }
  return emulator;
}

export function getPtyState(ptyId: string): PtyState | undefined {
  return ptyStates.get(ptyId);
}

export function setPtyState(ptyId: string, state: PtyState): void {
  ptyStates.set(ptyId, state);
}

export function deletePtyState(ptyId: string): void {
  ptyStates.delete(ptyId);
  emulatorCache.delete(ptyId);
  kittyStates.delete(ptyId);
}

export function handleUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
  applyUnifiedUpdate(ptyId, update);
  notifySubscribers(ptyId, update);
}

export function handlePtyExit(ptyId: string, exitCode: number): void {
  const subscribers = exitSubscribers.get(ptyId);
  if (subscribers) {
    for (const callback of subscribers) {
      callback(exitCode);
    }
  }
}

export function handlePtyTitle(ptyId: string, title: string): void {
  const existing = ptyStates.get(ptyId);
  if (existing) {
    existing.title = title;
  } else {
    ptyStates.set(ptyId, {
      terminalState: null,
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title,
    });
  }

  const perPty = titleSubscribers.get(ptyId);
  if (perPty) {
    for (const callback of perPty) {
      callback(title);
    }
  }
  for (const callback of globalTitleSubscribers) {
    callback({ ptyId, title });
  }
}

export function handlePtyLifecycle(ptyId: string, eventType: 'created' | 'destroyed'): void {
  if (eventType === 'destroyed') {
    deletePtyState(ptyId);
    clearPtySubscribers(ptyId);
  }
  for (const callback of lifecycleSubscribers) {
    callback({ type: eventType, ptyId });
  }
}

export function handlePtyKittyUpdate(
  ptyId: string,
  update: {
    images: KittyGraphicsImageInfo[];
    placements: KittyGraphicsPlacement[];
    removedImageIds: number[];
    imageData: Map<number, Uint8Array>;
  }
): void {
  const existing = kittyStates.get(ptyId);
  const incomingIds = new Set(update.images.map((info) => info.id));
  const nextImages = new Map<number, KittyGraphicsImageEntry>();

  for (const info of update.images) {
    const previous = existing?.images.get(info.id);
    const data = update.imageData.get(info.id) ?? previous?.data ?? null;
    nextImages.set(info.id, { info, data });
  }

  for (const id of update.removedImageIds) {
    nextImages.delete(id);
  }

  kittyStates.set(ptyId, {
    images: nextImages,
    placements: update.placements,
    dirty: true,
  });
}

export function handlePtyKittyTransmit(ptyId: string, sequence: string): void {
  for (const callback of kittyTransmitSubscribers) {
    callback({ ptyId, sequence });
  }
}

export function getKittyState(ptyId: string): KittyGraphicsState | undefined {
  return kittyStates.get(ptyId);
}

export function subscribeUnified(ptyId: string, callback: UnifiedSubscriber): () => void {
  const set = unifiedSubscribers.get(ptyId) ?? new Set<UnifiedSubscriber>();
  set.add(callback);
  unifiedSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId);
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
      unifiedSubscribers.delete(ptyId);
    }
  };
}

export function subscribeState(ptyId: string, callback: (state: TerminalState) => void): () => void {
  const set = stateSubscribers.get(ptyId) ?? new Set<(state: TerminalState) => void>();
  set.add(callback);
  stateSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId)?.terminalState;
  if (cached) {
    callback(cached);
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      stateSubscribers.delete(ptyId);
    }
  };
}

export function subscribeScroll(ptyId: string, callback: () => void): () => void {
  const set = scrollSubscribers.get(ptyId) ?? new Set<() => void>();
  set.add(callback);
  scrollSubscribers.set(ptyId, set);

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      scrollSubscribers.delete(ptyId);
    }
  };
}

export function subscribeExit(ptyId: string, callback: (exitCode: number) => void): () => void {
  const set = exitSubscribers.get(ptyId) ?? new Set<(exitCode: number) => void>();
  set.add(callback);
  exitSubscribers.set(ptyId, set);

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      exitSubscribers.delete(ptyId);
    }
  };
}

export function subscribeToTitle(ptyId: string, callback: (title: string) => void): () => void {
  const set = titleSubscribers.get(ptyId) ?? new Set<(title: string) => void>();
  set.add(callback);
  titleSubscribers.set(ptyId, set);

  const cached = ptyStates.get(ptyId)?.title;
  if (cached) {
    callback(cached);
  }

  return () => {
    set.delete(callback);
    if (set.size === 0) {
      titleSubscribers.delete(ptyId);
    }
  };
}

export function subscribeToAllTitles(callback: (event: TitleEvent) => void): () => void {
  globalTitleSubscribers.add(callback);
  return () => {
    globalTitleSubscribers.delete(callback);
  };
}

export function subscribeToLifecycle(callback: (event: LifecycleEvent) => void): () => void {
  lifecycleSubscribers.add(callback);
  return () => {
    lifecycleSubscribers.delete(callback);
  };
}

export function subscribeKittyTransmit(callback: (event: KittyTransmitEvent) => void): () => void {
  kittyTransmitSubscribers.add(callback);
  return () => {
    kittyTransmitSubscribers.delete(callback);
  };
}

function applyUnifiedUpdate(ptyId: string, update: UnifiedTerminalUpdate): void {
  const existing = ptyStates.get(ptyId);

  if (update.terminalUpdate.isFull && update.terminalUpdate.fullState) {
    const fullState = update.terminalUpdate.fullState;
    if (update.terminalUpdate.kittyKeyboardFlags !== undefined) {
      fullState.kittyKeyboardFlags = update.terminalUpdate.kittyKeyboardFlags;
    }
    ptyStates.set(ptyId, {
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
      kittyKeyboardFlags: update.terminalUpdate.kittyKeyboardFlags ?? existing.terminalState.kittyKeyboardFlags ?? 0,
    };

    ptyStates.set(ptyId, {
      terminalState: nextState,
      cachedRows,
      scrollState: update.scrollState,
      title: existing.title,
    });
  } else {
    ptyStates.set(ptyId, {
      terminalState: update.terminalUpdate.fullState ?? null,
      cachedRows: update.terminalUpdate.fullState?.cells ? [...update.terminalUpdate.fullState.cells] : [],
      scrollState: update.scrollState,
      title: existing?.title ?? '',
    });
  }

  const emulator = emulatorCache.get(ptyId);
  emulator?.handleScrollbackChange?.(
    update.scrollState.scrollbackLength,
    update.scrollState.isAtScrollbackLimit ?? false
  );
}

function notifySubscribers(ptyId: string, update: UnifiedTerminalUpdate): void {
  const unified = unifiedSubscribers.get(ptyId);
  if (unified) {
    for (const callback of unified) {
      callback(update);
    }
  }

  const state = ptyStates.get(ptyId)?.terminalState;
  if (state) {
    const legacy = stateSubscribers.get(ptyId);
    if (legacy) {
      for (const callback of legacy) {
        callback(state);
      }
    }
  }

  const scroll = scrollSubscribers.get(ptyId);
  if (scroll) {
    for (const callback of scroll) {
      callback();
    }
  }
}
