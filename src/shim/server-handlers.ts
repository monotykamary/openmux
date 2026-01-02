import type net from 'net';
import { dirname } from 'path';

import { Effect } from 'effect';
import { PtyId } from '../effect/types';
import type { UnifiedTerminalUpdate, TerminalScrollState, TerminalState, DirtyTerminalUpdate } from '../core/types';
import { packDirtyUpdate } from '../terminal/cell-serialization';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { setHostColors as setHostColorsDefault, type TerminalColors } from '../terminal/terminal-colors';
import { SHIM_SOCKET_PATH, type ShimHeader } from './protocol';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from './kitty-forwarder';
import type { ShimServerState } from './server-state';
import { createRequestHandler } from './server-requests';
import { sendFrame, sendResponse, sendError } from './server/frames';
import { createKittyHandlers } from './server/kitty';

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

export function createServerHandlers(state: ShimServerState, options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  const sendEvent = (header: ShimHeader, payloads: ArrayBuffer[] = []) => {
    if (!state.activeClient) return;
    sendFrame(state.activeClient, header, payloads);
  };

  const { sendKittyTransmit, sendKittyUpdate, queueKittyUpdate } = createKittyHandlers(state, sendEvent);

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
    state.kittyTransmitCache.delete(ptyId);
    state.kittyTransmitPending.delete(ptyId);
    state.kittyTransmitInvalidated.delete(ptyId);
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
        const cache = state.kittyTransmitCache.get(ptyId);
        if (cache && cache.size > 0) {
          for (const sequences of cache.values()) {
            for (const seq of sequences) {
              sendKittyTransmit(ptyId, seq);
            }
          }
        }
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
