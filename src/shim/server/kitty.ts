import { Buffer } from 'buffer';
import type { ITerminalEmulator, KittyGraphicsImageInfo, KittyGraphicsPlacement } from '../../terminal/emulator-interface';
import {
  buildGuestKey,
  normalizeParamId,
  parseKittySequence,
  parseTransmitParams,
} from '../../terminal/kitty-graphics/sequence-utils';
import { tracePtyEvent } from '../../terminal/pty-trace';
import type { ShimHeader } from '../protocol';
import type { KittyScreenImages, KittyScreenKey, ShimServerState } from '../server-state';

export type KittyHandlers = {
  sendKittyTransmit: (ptyId: string, sequence: string) => void;
  sendKittyUpdate: (ptyId: string, emulator: ITerminalEmulator, force?: boolean) => void;
  queueKittyUpdate: (ptyId: string) => void;
  hasCachedTransmit: (ptyId: string, info: KittyGraphicsImageInfo) => boolean;
};

type SendEvent = (header: ShimHeader, payloads?: ArrayBuffer[]) => void;

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

const isSameKittyImage = (a: KittyGraphicsImageInfo, b: KittyGraphicsImageInfo) => (
  a.transmitTime === b.transmitTime &&
  a.dataLength === b.dataLength &&
  a.width === b.width &&
  a.height === b.height &&
  a.format === b.format &&
  a.compression === b.compression
);

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

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
        const invalidated = state.kittyTransmitInvalidated.get(ptyId) ?? { all: false, keys: new Set<string>() };
        if (!invalidated.all) {
          invalidated.keys.add(guestKey);
          state.kittyTransmitInvalidated.set(ptyId, invalidated);
        }
      }
      return;
    }

    if (action !== 't' && action !== 'T') return;
    const guestKey = resolveGuestKey(parsed.params);
    if (!guestKey) return;

    const transmit = parseTransmitParams(parsed);
    const more = transmit?.more ?? parsed.params.get('m') === '1';
    const cache = getTransmitCache(ptyId);
    const pending = getTransmitPending(ptyId);

    if (more) {
      const chunks = pending.get(guestKey) ?? [];
      if (chunks.length === 0) {
        cache.delete(guestKey);
      }
      chunks.push(sequence);
      pending.set(guestKey, chunks);
      return;
    }

    const chunks = pending.get(guestKey);
    if (chunks) {
      chunks.push(sequence);
      pending.delete(guestKey);
      cache.set(guestKey, chunks);
      return;
    }

    cache.set(guestKey, [sequence]);
  };

  const hasCachedTransmit = (ptyId: string, info: KittyGraphicsImageInfo): boolean => {
    const cache = state.kittyTransmitCache.get(ptyId);
    if (!cache || cache.size === 0) return false;
    const idKey = buildGuestKey(info.id, null);
    if (idKey && cache.has(idKey)) return true;
    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey && cache.has(numberKey)) return true;
    }
    return false;
  };

  const getKittyImagesForScreen = (ptyId: string, screen: KittyScreenKey): Map<number, KittyGraphicsImageInfo> => {
    let screens = state.kittyImages.get(ptyId);
    if (!screens) {
      screens = { main: new Map(), alt: new Map() };
      state.kittyImages.set(ptyId, screens);
    }
    return screens[screen];
  };

  const sendKittyTransmit = (ptyId: string, sequence: string): void => {
    if (!state.activeClient) return;
    recordKittyTransmit(ptyId, sequence);
    const payload = Buffer.from(sequence, 'utf8');
    sendEvent({
      type: 'ptyKittyTransmit',
      ptyId,
      payloadLengths: [payload.byteLength],
    }, [toArrayBuffer(payload)]);
  };

  const sendKittyUpdate = (
    ptyId: string,
    emulator: ITerminalEmulator,
    force: boolean = false
  ): void => {
    if (!state.activeClient) return;
    if (!emulator.getKittyImageIds || !emulator.getKittyPlacements) return;

    const dirty = emulator.getKittyImagesDirty?.() ?? false;
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

    const ids = emulator.getKittyImageIds?.() ?? [];
    for (const id of ids) {
      const info = emulator.getKittyImageInfo?.(id);
      if (!info) continue;
      images.push(serializeKittyImage(info));

      const prev = previous.get(id);
      const guestKey = buildGuestKey(info.id, info.number > 0 ? info.number : null);
      const shouldForceData = Boolean(
        invalidation?.all || (guestKey && invalidation?.keys?.has(guestKey))
      );
      const changed = force || shouldForceData || !prev || !isSameKittyImage(prev, info);
      const shouldIncludeData = shouldForceData || (changed && !hasCachedTransmit(ptyId, info));
      if (shouldIncludeData) {
        const data = emulator.getKittyImageData?.(id);
        if (data) {
          imageDataIds.push(id);
          payloads.push(toArrayBuffer(data));
          if (shouldForceData) {
            sentInvalidated = true;
            if (guestKey && usedInvalidationKeys) {
              usedInvalidationKeys.add(guestKey);
            }
          }
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

    const screens: KittyScreenImages = state.kittyImages.get(ptyId) ?? { main: new Map(), alt: new Map() };
    screens[screenKey] = nextImages;
    state.kittyImages.set(ptyId, screens);

    const placements = emulator.getKittyPlacements?.() ?? [];
    const header: ShimHeader = {
      type: 'ptyKitty',
      ptyId,
      kitty: {
        images,
        placements: placements.map((placement: KittyGraphicsPlacement): KittyWirePlacement =>
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

    sendEvent(header, payloads);
    emulator.clearKittyImagesDirty?.();

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
