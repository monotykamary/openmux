import type net from 'net';
import { dirname } from 'path';
import { Buffer } from 'buffer';

import { Effect } from 'effect';
import { PtyId } from '../effect/types';
import type { UnifiedTerminalUpdate, TerminalScrollState, TerminalState, DirtyTerminalUpdate } from '../core/types';
import { packDirtyUpdate } from '../terminal/cell-serialization';
import type { ITerminalEmulator, KittyGraphicsImageInfo, KittyGraphicsPlacement } from '../terminal/emulator-interface';
import { setHostColors as setHostColorsDefault, type TerminalColors } from '../terminal/terminal-colors';
import { encodeFrame, SHIM_SOCKET_PATH, type ShimHeader } from './protocol';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from './kitty-forwarder';
import type { ShimServerState } from './server-state';
import { createRequestHandler } from './server-requests';

export type WithPty = <A>(fn: (pty: any) => Effect.Effect<A, unknown, any> | A) => Promise<A>;

export type ShimServerOptions = {
  socketPath?: string;
  withPty?: WithPty;
  setHostColors?: (colors: TerminalColors) => void;
};

const defaultWithPty: WithPty = async (fn) => {
  const [{ runEffect }, { Pty }] = await Promise.all([
    import('../effect/runtime'),
    import('../effect/services'),
  ]);
  const effect = Effect.gen(function* () {
    const pty = (yield* Pty) as any;
    const result = fn(pty);
    if (Effect.isEffect(result)) {
      return yield* result;
    }
    return result;
  }) as Effect.Effect<unknown, unknown, any>;
  return runEffect(effect) as Promise<any>;
};

function sendFrame(socket: net.Socket, header: ShimHeader, payloads: ArrayBuffer[] = []): void {
  if (socket.destroyed) return;
  socket.write(encodeFrame(header, payloads));
}

function sendResponse(
  socket: net.Socket,
  requestId: number,
  result?: unknown,
  payloads: ArrayBuffer[] = []
): void {
  sendFrame(socket, {
    type: 'response',
    requestId,
    ok: true,
    result,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  }, payloads);
}

function sendError(socket: net.Socket, requestId: number, error: string): void {
  sendFrame(socket, {
    type: 'response',
    requestId,
    ok: false,
    error,
  });
}

export function createServerHandlers(state: ShimServerState, options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  const sendEvent = (header: ShimHeader, payloads: ArrayBuffer[] = []) => {
    if (!state.activeClient) return;
    sendFrame(state.activeClient, header, payloads);
  };

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

  const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  const sendKittyTransmit = (ptyId: string, sequence: string): void => {
    if (!state.activeClient) return;
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

    const previous = state.kittyImages.get(ptyId) ?? new Map<number, KittyGraphicsImageInfo>();
    const nextImages = new Map<number, KittyGraphicsImageInfo>();
    const images: KittyGraphicsImageInfo[] = [];
    const imageDataIds: number[] = [];
    const payloads: ArrayBuffer[] = [];

    const ids = emulator.getKittyImageIds?.() ?? [];
    for (const id of ids) {
      const info = emulator.getKittyImageInfo?.(id);
      if (!info) continue;
      images.push(info);

      const prev = previous.get(id);
      const changed = force || !prev || !isSameKittyImage(prev, info);
      if (changed) {
        const data = emulator.getKittyImageData?.(id);
        if (data) {
          imageDataIds.push(id);
          payloads.push(toArrayBuffer(data));
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

    state.kittyImages.set(ptyId, nextImages);

    const placements = emulator.getKittyPlacements?.() ?? [];
    const header: ShimHeader = {
      type: 'ptyKitty',
      ptyId,
      kitty: {
        images: images.map(serializeKittyImage),
        placements: placements.map(serializeKittyPlacement),
        removedImageIds,
        imageDataIds,
      },
      payloadLengths: payloads.map((payload) => payload.byteLength),
    };

    sendEvent(header, payloads);
    emulator.clearKittyImagesDirty?.();
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

  function registerMapping(sessionId: string, paneId: string, ptyId: string): void {
    const map = state.sessionPanes.get(sessionId) ?? new Map<string, string>();
    map.set(paneId, ptyId);
    state.sessionPanes.set(sessionId, map);
    state.ptyToPane.set(ptyId, { sessionId, paneId });
  }

  function removeMappingForPty(ptyId: string): void {
    const info = state.ptyToPane.get(ptyId);
    if (!info) return;
    const map = state.sessionPanes.get(info.sessionId);
    if (map) {
      map.delete(info.paneId);
      if (map.size === 0) {
        state.sessionPanes.delete(info.sessionId);
      }
    }
    state.ptyToPane.delete(ptyId);
  }

  async function subscribeToPty(ptyId: string): Promise<void> {
    if (state.ptySubscriptions.has(ptyId)) return;

    const emulator = await withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;
    state.ptyEmulators.set(ptyId, emulator);

    const unifiedUnsub = await withPty<() => void>((pty) =>
      pty.subscribeUnified(PtyId.make(ptyId), (update: UnifiedTerminalUpdate) => {
        const packed = packDirtyUpdate(update.terminalUpdate);
        const payloads: ArrayBuffer[] = [
          packed.dirtyRowIndices.buffer.slice(0) as ArrayBuffer,
          packed.dirtyRowData as ArrayBuffer,
          (packed.fullStateData ?? new ArrayBuffer(0)) as ArrayBuffer,
        ];

        const header: ShimHeader = {
          type: 'ptyUpdate',
          ptyId,
          packed: {
            cursor: packed.cursor,
            cols: packed.cols,
            rows: packed.rows,
            scrollbackLength: packed.scrollbackLength,
            isFull: packed.isFull,
            alternateScreen: packed.alternateScreen,
            mouseTracking: packed.mouseTracking,
            cursorKeyMode: packed.cursorKeyMode,
            kittyKeyboardFlags: packed.kittyKeyboardFlags,
            inBandResize: packed.inBandResize,
          },
          scrollState: {
            viewportOffset: update.scrollState.viewportOffset,
            isAtBottom: update.scrollState.isAtBottom,
          },
          payloadLengths: payloads.map((payload) => payload.byteLength),
        };

        sendEvent(header, payloads);
        const kittyEmulator = state.ptyEmulators.get(ptyId);
        if (kittyEmulator) {
          sendKittyUpdate(ptyId, kittyEmulator);
        }
      })
    );

    const exitUnsub = await withPty<() => void>((pty) =>
      pty.onExit(PtyId.make(ptyId), (exitCode: number) => {
        removeMappingForPty(ptyId);
        sendEvent({ type: 'ptyExit', ptyId, exitCode });
      })
    );

    state.ptySubscriptions.set(ptyId, { unifiedUnsub, exitUnsub });
  }

  async function unsubscribeFromPty(ptyId: string): Promise<void> {
    const subs = state.ptySubscriptions.get(ptyId);
    if (!subs) return;
    subs.unifiedUnsub();
    subs.exitUnsub();
    state.ptySubscriptions.delete(ptyId);
    state.ptyEmulators.delete(ptyId);
    state.kittyImages.delete(ptyId);
  }

  async function subscribeAllPtys(): Promise<string[]> {
    const ptyIds = await withPty((pty) => pty.listAll()) as Array<string>;
    await Promise.all(ptyIds.map((id) => subscribeToPty(String(id))));
    return ptyIds;
  }

  async function handleLifecycle(): Promise<void> {
    state.lifecycleUnsub = await withPty<() => void>((pty) => pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
      const ptyId = String(event.ptyId);
      if (event.type === 'created') {
        subscribeToPty(ptyId).catch(() => {});
      } else {
        unsubscribeFromPty(ptyId).catch(() => {});
        removeMappingForPty(ptyId);
      }
      sendEvent({ type: 'ptyLifecycle', ptyId, event: event.type });
    }));
  }

  async function handleTitles(): Promise<void> {
    state.titleUnsub = await withPty<() => void>((pty) => pty.subscribeToAllTitleChanges((event: { ptyId: string; title: string }) => {
      sendEvent({ type: 'ptyTitle', ptyId: String(event.ptyId), title: event.title });
    }));
  }

  async function sendSnapshot(ptyId: string): Promise<void> {
    if (!state.activeClient) return;
    try {
      const result = await withPty((pty) =>
        Effect.gen(function* () {
          const s = yield* pty.getTerminalState(PtyId.make(ptyId));
          const scrollState = yield* pty.getScrollState(PtyId.make(ptyId));
          return { state: s, scrollState };
        })
      ) as { state: TerminalState; scrollState: TerminalScrollState };

      const update: DirtyTerminalUpdate = {
        dirtyRows: new Map(),
        cursor: result.state.cursor,
        scrollState: result.scrollState,
        cols: result.state.cols,
        rows: result.state.rows,
        isFull: true,
        fullState: result.state,
        alternateScreen: result.state.alternateScreen,
        mouseTracking: result.state.mouseTracking,
        cursorKeyMode: result.state.cursorKeyMode ?? 'normal',
        kittyKeyboardFlags: result.state.kittyKeyboardFlags ?? 0,
        inBandResize: false,
      };

      const packed = packDirtyUpdate(update);
      const payloads: ArrayBuffer[] = [
        packed.dirtyRowIndices.buffer.slice(0) as ArrayBuffer,
        packed.dirtyRowData as ArrayBuffer,
        (packed.fullStateData ?? new ArrayBuffer(0)) as ArrayBuffer,
      ];

      sendEvent({
        type: 'ptyUpdate',
        ptyId,
        packed: {
          cursor: packed.cursor,
          cols: packed.cols,
          rows: packed.rows,
          scrollbackLength: packed.scrollbackLength,
          isFull: packed.isFull,
          alternateScreen: packed.alternateScreen,
          mouseTracking: packed.mouseTracking,
          cursorKeyMode: packed.cursorKeyMode,
          kittyKeyboardFlags: packed.kittyKeyboardFlags,
          inBandResize: packed.inBandResize,
        },
        scrollState: {
          viewportOffset: result.scrollState.viewportOffset,
          isAtBottom: result.scrollState.isAtBottom,
        },
        payloadLengths: payloads.map((payload) => payload.byteLength),
      }, payloads);

      const emulator = state.ptyEmulators.get(ptyId) ??
        await withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;
      if (emulator) {
        state.ptyEmulators.set(ptyId, emulator);
        sendKittyUpdate(ptyId, emulator, true);
      }
    } catch {
      // ignore snapshot errors
    }
  }

  async function sendSnapshots(ptyIds: string[]): Promise<void> {
    await Promise.all(ptyIds.map((ptyId) => sendSnapshot(ptyId)));
  }

  async function attachClient(socket: net.Socket, clientId: string): Promise<void> {
    const previousClient = state.activeClient;
    const previousClientId = previousClient ? state.clientIds.get(previousClient) ?? null : null;
    if (previousClient && !previousClient.destroyed) {
      sendFrame(previousClient, { type: 'detached' });
      previousClient.end();
      setTimeout(() => {
        if (previousClient && !previousClient.destroyed) {
          previousClient.destroy();
        }
      }, 250);
    }

    if (previousClientId) {
      state.revokedClientIds.add(previousClientId);
    }

    state.clientIds.set(socket, clientId);
    state.activeClient = socket;
    state.activeClientId = clientId;
    setKittyTransmitForwarder(sendKittyTransmit);
    setKittyUpdateForwarder(queueKittyUpdate);
    const ptyIds = await subscribeAllPtys();
    await handleLifecycle();
    await handleTitles();
    await sendSnapshots(ptyIds);
  }

  async function detachClient(socket: net.Socket): Promise<void> {
    if (state.activeClient !== socket) return;

    state.activeClient = null;
    state.activeClientId = null;
    setKittyTransmitForwarder(null);
    setKittyUpdateForwarder(null);
    for (const ptyId of state.ptySubscriptions.keys()) {
      await unsubscribeFromPty(ptyId);
    }
    state.ptySubscriptions.clear();

    if (state.lifecycleUnsub) {
      state.lifecycleUnsub();
      state.lifecycleUnsub = null;
    }
    if (state.titleUnsub) {
      state.titleUnsub();
      state.titleUnsub = null;
    }
  }

  const handleRequest = createRequestHandler({
    state,
    withPty,
    setHostColors,
    sendResponse,
    sendError,
    attachClient,
    registerMapping,
    removeMappingForPty,
  });

  return {
    socketPath,
    socketDir,
    handleRequest,
    detachClient,
  };
}
