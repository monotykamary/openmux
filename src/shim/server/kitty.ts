import { Buffer } from 'buffer';
import fs from 'node:fs';
import {
  isKittyGraphicsEmulator,
  type ITerminalEmulator,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
} from '../../terminal/emulator-interface';
import {
  buildGuestKey,
  decodeKittyFilePayload,
  normalizeParamId,
  parseKittySequence,
  parseTransmitParams,
  rebuildControl,
} from '../../terminal/kitty-graphics/sequence-utils';
import { tracePtyEvent } from '../../terminal/pty-trace';
import type { ShimHeader } from '../protocol';
import type { KittyScreenImages, KittyScreenKey, ShimServerState } from '../server-state';

/**
 * Handlers for Kitty graphics protocol operations.
 * Manages transmit caching, update queuing, and client forwarding.
 */
export type KittyHandlers = {
  /** Sends a Kitty graphics transmit sequence to the client */
  sendKittyTransmit: (
    ptyId: string,
    sequence: string,
    options?: {
      fromReplay?: boolean;
      allowSharedMemoryReplay?: boolean;
      allowWhileBootstrapping?: boolean;
    }
  ) => void;
  /** Sends a Kitty graphics update to the client */
  sendKittyUpdate: (
    ptyId: string,
    emulator: ITerminalEmulator,
    force?: boolean,
    options?: { allowWhileBootstrapping?: boolean }
  ) => void;
  /** Queues a Kitty update for batch processing */
  queueKittyUpdate: (ptyId: string) => void;
  /** Checks if a cached transmit exists for an image */
  hasCachedTransmit: (ptyId: string, info: KittyGraphicsImageInfo) => boolean;
};

type SendEvent = (
  header: ShimHeader,
  payloads?: ArrayBuffer[],
  options?: { allowWhileBootstrapping?: boolean }
) => void;

type KittyWireImage = ReturnType<typeof serializeKittyImage>;

type KittyWirePlacement = ReturnType<typeof serializeKittyPlacement>;

const serializeKittyImage = (info: KittyGraphicsImageInfo) => ({
  id: info.id,
  number: info.number,
  width: info.width,
  height: info.height,
  dataLength: info.dataLength,
  format: info.format,
  compression: info.compression,
  implicitId: info.implicitId,
  transmitTime: info.transmitTime.toString(),
});

const serializeKittyPlacement = (placement: KittyGraphicsPlacement) => ({
  imageId: placement.imageId,
  placementId: placement.placementId,
  placementTag: placement.placementTag,
  screenX: placement.screenX,
  screenY: placement.screenY,
  xOffset: placement.xOffset,
  yOffset: placement.yOffset,
  sourceX: placement.sourceX,
  sourceY: placement.sourceY,
  sourceWidth: placement.sourceWidth,
  sourceHeight: placement.sourceHeight,
  columns: placement.columns,
  rows: placement.rows,
  z: placement.z,
});

const isSameKittyImage = (a: KittyGraphicsImageInfo, b: KittyGraphicsImageInfo) =>
  a.transmitTime === b.transmitTime &&
  a.dataLength === b.dataLength &&
  a.width === b.width &&
  a.height === b.height &&
  a.format === b.format &&
  a.compression === b.compression;

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

function getTransmitMedium(sequence: string): string | null {
  const parsed = parseKittySequence(sequence);
  if (!parsed) return null;
  const transmit = parseTransmitParams(parsed);
  if (!transmit) return null;
  return transmit.medium ?? 'd';
}

function normalizeCachedTransmitSequence(sequence: string): string {
  const parsed = parseKittySequence(sequence);
  if (!parsed) return sequence;

  const transmit = parseTransmitParams(parsed);
  if (!transmit || transmit.more) return sequence;
  if ((transmit.medium ?? 'd') !== 'f') return sequence;

  const filePath = decodeKittyFilePayload(parsed.data);
  if (!filePath) return sequence;

  let fileData: Buffer;
  try {
    fileData = fs.readFileSync(filePath);
  } catch (err) {
    console.warn(
      '[shim/kitty] Failed to read image file:',
      err instanceof Error ? err.message : String(err)
    );
    return sequence;
  }

  const params = new Map(parsed.params);
  params.set('t', 'd');
  params.delete('m');
  const control = rebuildControl(params);
  const payload = fileData.toString('base64');
  return `${parsed.prefix}${control};${payload}${parsed.suffix}`;
}

/**
 * Creates Kitty graphics protocol handlers.
 * Manages image caching, transmit persistence, and client forwarding.
 * @param state - Server state for storing Kitty data
 * @param sendEvent - Function to send events to the active client
 * @returns Kitty handlers for transmit and update operations
 */
export function createKittyHandlers(state: ShimServerState, sendEvent: SendEvent): KittyHandlers {
  const getTransmitCache = (ptyId: string): Map<string, string[]> => {
    let cache = state.kittyTransmitCache.get(ptyId);
    if (!cache) {
      cache = new Map();
      state.kittyTransmitCache.set(ptyId, cache);
    }
    return cache;
  };

  const getTransmitPending = (ptyId: string): Map<string, string[]> => {
    let pending = state.kittyTransmitPending.get(ptyId);
    if (!pending) {
      pending = new Map();
      state.kittyTransmitPending.set(ptyId, pending);
    }
    return pending;
  };

  const resolveGuestKey = (params: Map<string, string>): string | null => {
    const guestId = normalizeParamId(params.get('i'));
    const guestNumber = normalizeParamId(params.get('I'));
    return buildGuestKey(guestId, guestNumber);
  };

  const resolvePendingGuestKey = (ptyId: string): string | null => {
    const pending = state.kittyTransmitPending.get(ptyId);
    if (!pending || pending.size === 0) return null;
    if (pending.size === 1) {
      return pending.keys().next().value ?? null;
    }
    let lastKey: string | null = null;
    for (const key of pending.keys()) {
      lastKey = key;
    }
    return lastKey;
  };

  const recordKittyTransmit = (ptyId: string, sequence: string): void => {
    const parsed = parseKittySequence(sequence);
    if (!parsed) return;
    const action = parsed.params.get('a') ?? '';
    const deleteTarget = parsed.params.get('d') ?? '';

    if (action === 'd') {
      if (deleteTarget === 'a') {
        state.kittyTransmitCache.delete(ptyId);
        state.kittyTransmitPending.delete(ptyId);
        state.kittyTransmitInvalidated.set(ptyId, { all: true, keys: new Set() });
        return;
      }
      if (deleteTarget === 'i' || deleteTarget === 'I') {
        const guestKey = resolveGuestKey(parsed.params);
        if (!guestKey) return;
        state.kittyTransmitCache.get(ptyId)?.delete(guestKey);
        state.kittyTransmitPending.get(ptyId)?.delete(guestKey);
        const invalidated = state.kittyTransmitInvalidated.get(ptyId) ?? {
          all: false,
          keys: new Set<string>(),
        };
        if (!invalidated.all) {
          invalidated.keys.add(guestKey);
          state.kittyTransmitInvalidated.set(ptyId, invalidated);
        }
      }
      return;
    }

    const transmit = parseTransmitParams(parsed);
    const pending = getTransmitPending(ptyId);

    let guestKey = resolveGuestKey(parsed.params);
    if (!guestKey) {
      guestKey = resolvePendingGuestKey(ptyId);
    }
    if (!guestKey) return;

    const hasPendingChunk = pending.has(guestKey);
    if (!transmit) {
      const actionValue = parsed.params.get('a');
      if (actionValue && actionValue !== 't' && actionValue !== 'T') return;
      for (const key of parsed.params.keys()) {
        if (key !== 'i' && key !== 'I') {
          return;
        }
      }
      if (!hasPendingChunk) return;
    }

    const more = transmit?.more ?? false;
    const cache = getTransmitCache(ptyId);

    if (more) {
      const chunks = pending.get(guestKey) ?? [];
      if (chunks.length === 0) {
        cache.delete(guestKey);
      }
      chunks.push(sequence);
      pending.set(guestKey, chunks);
      return;
    }

    const cacheSequence = normalizeCachedTransmitSequence(sequence);
    const chunks = pending.get(guestKey);
    if (chunks) {
      chunks.push(cacheSequence);
      pending.delete(guestKey);
      cache.set(guestKey, chunks);
      return;
    }

    cache.set(guestKey, [cacheSequence]);
  };

  const getCachedTransmitChunks = (
    ptyId: string,
    info: KittyGraphicsImageInfo
  ): string[] | null => {
    const cache = state.kittyTransmitCache.get(ptyId);
    if (!cache || cache.size === 0) return null;

    const idKey = buildGuestKey(info.id, null);
    if (idKey) {
      const chunks = cache.get(idKey);
      if (chunks) return chunks;
    }

    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) {
        const chunks = cache.get(numberKey);
        if (chunks) return chunks;
      }
    }

    return null;
  };

  const hasCachedTransmit = (ptyId: string, info: KittyGraphicsImageInfo): boolean => {
    return getCachedTransmitChunks(ptyId, info) !== null;
  };

  const hasReplayableCachedTransmit = (ptyId: string, info: KittyGraphicsImageInfo): boolean => {
    const chunks = getCachedTransmitChunks(ptyId, info);
    if (!chunks || chunks.length === 0) return false;

    // Shared-memory transmits (t=s) are not durable across detach/reattach,
    // because the backing shm key can be invalid by replay time.
    for (const chunk of chunks) {
      if (chunk.includes('t=s')) {
        return false;
      }
    }

    return true;
  };

  const getKittyImagesForScreen = (
    ptyId: string,
    screen: KittyScreenKey
  ): Map<number, KittyGraphicsImageInfo> => {
    let screens = state.kittyImages.get(ptyId);
    if (!screens) {
      screens = { main: new Map(), alt: new Map() };
      state.kittyImages.set(ptyId, screens);
    }
    return screens[screen];
  };

  const sendKittyTransmit = (
    ptyId: string,
    sequence: string,
    options?: {
      fromReplay?: boolean;
      allowSharedMemoryReplay?: boolean;
      allowWhileBootstrapping?: boolean;
    }
  ): void => {
    const fromReplay = options?.fromReplay ?? false;
    const allowSharedMemoryReplay = options?.allowSharedMemoryReplay ?? false;

    // Always cache live replay data, even when no client is currently attached.
    // Detached sessions still receive Kitty transmits from the PTY stream and
    // must be able to replay them when the next client attaches.
    if (!fromReplay) {
      recordKittyTransmit(ptyId, sequence);
    }

    if (!state.activeClient) return;

    // Shared-memory transmits are fragile during replay (handles may no longer
    // be valid). Prefer ptyKitty imageData payloads, but allow explicit
    // fallback replay when image bytes are unavailable.
    if (fromReplay && getTransmitMedium(sequence) === 's' && !allowSharedMemoryReplay) {
      return;
    }

    const payload = Buffer.from(sequence, 'utf8');
    sendEvent(
      {
        type: 'ptyKittyTransmit',
        ptyId,
        payloadLengths: [payload.byteLength],
      },
      [toArrayBuffer(payload)],
      { allowWhileBootstrapping: options?.allowWhileBootstrapping }
    );
  };

  const sendKittyUpdate = (
    ptyId: string,
    emulator: ITerminalEmulator,
    force: boolean = false,
    options?: { allowWhileBootstrapping?: boolean }
  ): void => {
    if (!state.activeClient) return;
    if (!isKittyGraphicsEmulator(emulator)) return;

    const dirty = emulator.getKittyImagesDirty();
    if (!dirty && !force) return;

    const alternateScreen = emulator.isAlternateScreen?.() ?? false;
    const screenKey: KittyScreenKey = alternateScreen ? 'alt' : 'main';
    const previous = getKittyImagesForScreen(ptyId, screenKey);
    const nextImages = new Map<number, KittyGraphicsImageInfo>();
    const images: KittyWireImage[] = [];
    const imageDataIds: number[] = [];
    const payloads: ArrayBuffer[] = [];

    const invalidation = state.kittyTransmitInvalidated.get(ptyId) ?? null;
    let usedInvalidationKeys: Set<string> | null = invalidation?.keys ? new Set<string>() : null;
    let sentInvalidated = false;

    const ids = emulator.getKittyImageIds();
    for (const id of ids) {
      const info = emulator.getKittyImageInfo(id);
      if (!info) continue;
      images.push(serializeKittyImage(info));

      const prev = previous.get(id);
      const guestKey = buildGuestKey(info.id, info.number > 0 ? info.number : null);
      const shouldForceData = Boolean(
        invalidation?.all || (guestKey && invalidation?.keys?.has(guestKey))
      );
      const changed = force || shouldForceData || !prev || !isSameKittyImage(prev, info);
      const shouldIncludeData =
        shouldForceData || (changed && !hasReplayableCachedTransmit(ptyId, info));
      if (shouldIncludeData) {
        const data = emulator.getKittyImageData(id);
        if (data) {
          imageDataIds.push(id);
          payloads.push(toArrayBuffer(data));
          if (shouldForceData) {
            sentInvalidated = true;
            if (guestKey && usedInvalidationKeys) {
              usedInvalidationKeys.add(guestKey);
            }
          }
        } else {
          tracePtyEvent('kitty-update-missing-image-data', {
            ptyId,
            imageId: id,
            guestKey,
            force,
            shouldForceData,
          });
        }
      }

      nextImages.set(id, info);
    }

    const removedImageIds: number[] = [];
    for (const [id] of previous) {
      if (!nextImages.has(id)) {
        removedImageIds.push(id);
      }
    }

    const screens: KittyScreenImages = state.kittyImages.get(ptyId) ?? {
      main: new Map(),
      alt: new Map(),
    };
    screens[screenKey] = nextImages;
    state.kittyImages.set(ptyId, screens);

    const placements = emulator.getKittyPlacements();
    const header: ShimHeader = {
      type: 'ptyKitty',
      ptyId,
      kitty: {
        images,
        placements: placements.map(
          (placement: KittyGraphicsPlacement): KittyWirePlacement =>
            serializeKittyPlacement(placement)
        ),
        removedImageIds,
        imageDataIds,
        alternateScreen,
      },
      payloadLengths: payloads.map((payload) => payload.byteLength),
    };

    tracePtyEvent('kitty-update', {
      ptyId,
      imageCount: images.length,
      placementCount: placements.length,
      removedImageCount: removedImageIds.length,
      dirty,
      force,
      alternateScreen,
      imageDataCount: imageDataIds.length,
      imageDataBytes: payloads.reduce((sum, payload) => sum + payload.byteLength, 0),
    });

    sendEvent(header, payloads, { allowWhileBootstrapping: options?.allowWhileBootstrapping });
    emulator.clearKittyImagesDirty();

    if (invalidation) {
      if (invalidation.all) {
        if (sentInvalidated) {
          state.kittyTransmitInvalidated.delete(ptyId);
        }
      } else if (usedInvalidationKeys) {
        for (const key of usedInvalidationKeys) {
          invalidation.keys.delete(key);
        }
        if (invalidation.keys.size === 0) {
          state.kittyTransmitInvalidated.delete(ptyId);
        } else {
          state.kittyTransmitInvalidated.set(ptyId, invalidation);
        }
      }
    }
  };

  const pendingKittyUpdates = new Set<string>();
  let kittyUpdateScheduled = false;
  const flushKittyUpdates = () => {
    kittyUpdateScheduled = false;
    const pending = Array.from(pendingKittyUpdates);
    pendingKittyUpdates.clear();
    for (const id of pending) {
      const emulator = state.ptyEmulators.get(id);
      if (emulator) {
        sendKittyUpdate(id, emulator);
      }
    }
  };

  const queueKittyUpdate = (ptyId: string) => {
    if (!state.activeClient) return;
    pendingKittyUpdates.add(ptyId);
    if (!kittyUpdateScheduled) {
      kittyUpdateScheduled = true;
      queueMicrotask(flushKittyUpdates);
    }
  };

  return {
    sendKittyTransmit,
    sendKittyUpdate,
    queueKittyUpdate,
    hasCachedTransmit,
  };
}
