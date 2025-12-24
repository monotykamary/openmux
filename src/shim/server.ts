import net from 'net';
import fs from 'fs/promises';
import { dirname } from 'path';

import { Effect } from 'effect';
import { PtyId, Cols, Rows } from '../effect/types';
import type { UnifiedTerminalUpdate, TerminalScrollState, TerminalState, DirtyTerminalUpdate } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { packDirtyUpdate, packTerminalState, packRow } from '../terminal/cell-serialization';
import { setHostColors as setHostColorsDefault } from '../terminal/terminal-colors';
import { encodeFrame, FrameReader, SHIM_SOCKET_DIR, SHIM_SOCKET_PATH, type ShimHeader } from './protocol';

const sessionPanes = new Map<string, Map<string, string>>();
const ptyToPane = new Map<string, { sessionId: string; paneId: string }>();
const clientIds = new Map<net.Socket, string>();
const revokedClientIds = new Set<string>();

const ptySubscriptions = new Map<string, { unifiedUnsub: () => void; exitUnsub: () => void }>();
let lifecycleUnsub: (() => void) | null = null;
let titleUnsub: (() => void) | null = null;

let activeClient: net.Socket | null = null;
let activeClientId: string | null = null;
let hostColorsSet = false;

type WithPty = <A>(fn: (pty: any) => Effect.Effect<A, unknown, any> | A) => Promise<A>;

type ShimServerOptions = {
  socketPath?: string;
  withPty?: WithPty;
  setHostColors?: (colors: unknown) => void;
};

async function ensureSocketDir(socketDir: string): Promise<void> {
  await fs.mkdir(socketDir, { recursive: true });
}

async function removeSocketFile(socketPath: string): Promise<void> {
  try {
    await fs.unlink(socketPath);
  } catch {
    // ignore missing
  }
}

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

function sendEvent(header: ShimHeader, payloads: ArrayBuffer[] = []): void {
  if (!activeClient) return;
  sendFrame(activeClient, header, payloads);
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

function createServerHandlers(options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  function registerMapping(sessionId: string, paneId: string, ptyId: string): void {
    const map = sessionPanes.get(sessionId) ?? new Map<string, string>();
    map.set(paneId, ptyId);
    sessionPanes.set(sessionId, map);
    ptyToPane.set(ptyId, { sessionId, paneId });
  }

  function removeMappingForPty(ptyId: string): void {
    const info = ptyToPane.get(ptyId);
    if (!info) return;
    const map = sessionPanes.get(info.sessionId);
    if (map) {
      map.delete(info.paneId);
      if (map.size === 0) {
        sessionPanes.delete(info.sessionId);
      }
    }
    ptyToPane.delete(ptyId);
  }

  async function subscribeToPty(ptyId: string): Promise<void> {
    if (ptySubscriptions.has(ptyId)) return;

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
          inBandResize: packed.inBandResize,
        },
        scrollState: {
          viewportOffset: update.scrollState.viewportOffset,
          isAtBottom: update.scrollState.isAtBottom,
        },
        payloadLengths: payloads.map((payload) => payload.byteLength),
      };

      sendEvent(header, payloads);
    }));

    const exitUnsub = await withPty<() => void>((pty) =>
      pty.onExit(PtyId.make(ptyId), (exitCode: number) => {
      removeMappingForPty(ptyId);
      sendEvent({ type: 'ptyExit', ptyId, exitCode });
    }));

    ptySubscriptions.set(ptyId, { unifiedUnsub, exitUnsub });
  }

  async function unsubscribeFromPty(ptyId: string): Promise<void> {
    const subs = ptySubscriptions.get(ptyId);
    if (!subs) return;
    subs.unifiedUnsub();
    subs.exitUnsub();
    ptySubscriptions.delete(ptyId);
  }

  async function subscribeAllPtys(): Promise<string[]> {
    const ptyIds = await withPty((pty) => pty.listAll()) as Array<string>;
    await Promise.all(ptyIds.map((id) => subscribeToPty(String(id))));
    return ptyIds;
  }

  async function handleLifecycle(): Promise<void> {
    lifecycleUnsub = await withPty<() => void>((pty) => pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
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
    titleUnsub = await withPty<() => void>((pty) => pty.subscribeToAllTitleChanges((event: { ptyId: string; title: string }) => {
      sendEvent({ type: 'ptyTitle', ptyId: String(event.ptyId), title: event.title });
    }));
  }

  async function sendSnapshot(ptyId: string): Promise<void> {
    if (!activeClient) return;
    try {
      const result = await withPty((pty) =>
        Effect.gen(function* () {
          const state = yield* pty.getTerminalState(PtyId.make(ptyId));
          const scrollState = yield* pty.getScrollState(PtyId.make(ptyId));
          return { state, scrollState };
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
          inBandResize: packed.inBandResize,
        },
        scrollState: {
          viewportOffset: result.scrollState.viewportOffset,
          isAtBottom: result.scrollState.isAtBottom,
        },
        payloadLengths: payloads.map((payload) => payload.byteLength),
      }, payloads);
    } catch {
      // ignore snapshot errors
    }
  }

  async function sendSnapshots(ptyIds: string[]): Promise<void> {
    await Promise.all(ptyIds.map((ptyId) => sendSnapshot(ptyId)));
  }

  async function attachClient(socket: net.Socket, clientId: string): Promise<void> {
    const previousClient = activeClient;
    const previousClientId = previousClient ? clientIds.get(previousClient) ?? null : null;
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
      revokedClientIds.add(previousClientId);
    }

    clientIds.set(socket, clientId);
    activeClient = socket;
    activeClientId = clientId;
    const ptyIds = await subscribeAllPtys();
    await handleLifecycle();
    await handleTitles();
    await sendSnapshots(ptyIds);
  }

  async function detachClient(socket: net.Socket): Promise<void> {
    if (activeClient !== socket) return;

    activeClient = null;
    activeClientId = null;
    for (const ptyId of ptySubscriptions.keys()) {
      await unsubscribeFromPty(ptyId);
    }
    ptySubscriptions.clear();

    if (lifecycleUnsub) {
      lifecycleUnsub();
      lifecycleUnsub = null;
    }
    if (titleUnsub) {
      titleUnsub();
      titleUnsub = null;
    }
  }

  async function handleRequest(socket: net.Socket, header: ShimHeader, payloads: Buffer[]): Promise<void> {
    const requestId = header.requestId;
    if (!requestId) return;

    const method = header.method as string | undefined;
    const params = (header.params as Record<string, unknown>) ?? {};

    try {
      if (method !== 'hello' && activeClient !== socket) {
        sendError(socket, requestId, 'Inactive client');
        socket.end();
        return;
      }

      switch (method) {
        case 'hello':
          {
            const clientId = typeof params.clientId === 'string' ? params.clientId : null;
            if (!clientId) {
              sendError(socket, requestId, 'Missing clientId');
              socket.end();
              return;
            }
            if (revokedClientIds.has(clientId)) {
              sendError(socket, requestId, 'Client is detached');
              socket.end();
              return;
            }
            if (activeClient === socket && activeClientId === clientId) {
              sendResponse(socket, requestId, { pid: process.pid, clientId });
              return;
            }
            await attachClient(socket, clientId);
            sendResponse(socket, requestId, { pid: process.pid, clientId });
          }
          return;

        case 'setHostColors':
          if (!hostColorsSet && params.colors) {
            setHostColors(params.colors as any);
            hostColorsSet = true;
          }
          sendResponse(socket, requestId, { applied: hostColorsSet });
          return;

        case 'createPty': {
          const ptyId = await withPty((pty) => pty.create({
            cols: Cols.make(params.cols as number),
            rows: Rows.make(params.rows as number),
            cwd: params.cwd as string | undefined,
          }));
          sendResponse(socket, requestId, { ptyId: String(ptyId) });
          return;
        }

        case 'write':
          await withPty((pty) => pty.write(PtyId.make(params.ptyId as string), params.data as string));
          sendResponse(socket, requestId);
          return;

        case 'resize':
          await withPty((pty) => pty.resize(
            PtyId.make(params.ptyId as string),
            Cols.make(params.cols as number),
            Rows.make(params.rows as number)
          ));
          sendResponse(socket, requestId);
          return;

        case 'destroy':
          removeMappingForPty(params.ptyId as string);
          await withPty((pty) => pty.destroy(PtyId.make(params.ptyId as string)));
          sendResponse(socket, requestId);
          return;

        case 'destroyAll':
          await withPty((pty) => pty.destroyAll());
          sendResponse(socket, requestId);
          return;

        case 'shutdown':
          await withPty((pty) => pty.destroyAll());
          sendResponse(socket, requestId);
          setTimeout(() => {
            process.exit(0);
          }, 10);
          return;

        case 'setPanePosition':
          await withPty((pty) => pty.setPanePosition(
            PtyId.make(params.ptyId as string),
            params.x as number,
            params.y as number
          ));
          sendResponse(socket, requestId);
          return;

        case 'getCwd': {
          const cwd = await withPty((pty) => pty.getCwd(PtyId.make(params.ptyId as string)));
          sendResponse(socket, requestId, { cwd });
          return;
        }

        case 'getTerminalState': {
          const state = await withPty((pty) => pty.getTerminalState(PtyId.make(params.ptyId as string))) as TerminalState;
          const payload = packTerminalState(state);
          sendResponse(socket, requestId, { cols: state.cols, rows: state.rows }, [payload]);
          return;
        }

        case 'getScrollState': {
          const scrollState = await withPty((pty) => pty.getScrollState(PtyId.make(params.ptyId as string))) as TerminalScrollState;
          sendResponse(socket, requestId, scrollState);
          return;
        }

        case 'setScrollOffset':
          await withPty((pty) => pty.setScrollOffset(PtyId.make(params.ptyId as string), params.offset as number));
          sendResponse(socket, requestId);
          return;

        case 'getScrollbackLines': {
          const ptyId = params.ptyId as string;
          const startOffset = params.startOffset as number;
          const count = params.count as number;
          const emulator = await withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;

          if ('prefetchScrollbackLines' in emulator && typeof emulator.prefetchScrollbackLines === 'function') {
            await (emulator as any).prefetchScrollbackLines(startOffset, count);
          }

          const lineOffsets: number[] = [];
          const payloads: ArrayBuffer[] = [];

          for (let i = 0; i < count; i++) {
            const offset = startOffset + i;
            const line = emulator.getScrollbackLine(offset);
            if (!line) continue;
            lineOffsets.push(offset);
            payloads.push(packRow(line));
          }

          const combinedLength = payloads.reduce((sum, buf) => sum + buf.byteLength, 0);
          const combined = new ArrayBuffer(combinedLength);
          const view = new Uint8Array(combined);
          let writeOffset = 0;
          for (const payload of payloads) {
            view.set(new Uint8Array(payload), writeOffset);
            writeOffset += payload.byteLength;
          }

          sendResponse(socket, requestId, { lineOffsets }, [combined]);
          return;
        }

        case 'search': {
          const ptyId = params.ptyId as string;
          const query = params.query as string;
          const limit = params.limit as number | undefined;
          const emulator = await withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;
          const result = await emulator.search(query, { limit });
          sendResponse(socket, requestId, result);
          return;
        }

        case 'listAll': {
          const ids = await withPty((pty) => pty.listAll()) as Array<string>;
          sendResponse(socket, requestId, { ptyIds: ids.map(String) });
          return;
        }

        case 'getSession': {
          const session = await withPty((pty) => pty.getSession(PtyId.make(params.ptyId as string))) as any;
          sendResponse(socket, requestId, { session: session ? {
            id: String(session.id),
            pid: session.pid,
            cols: session.cols,
            rows: session.rows,
            cwd: session.cwd,
            shell: session.shell,
          } : null });
          return;
        }

        case 'getForegroundProcess': {
          const proc = await withPty((pty) => pty.getForegroundProcess(PtyId.make(params.ptyId as string)));
          sendResponse(socket, requestId, { process: proc });
          return;
        }

        case 'getGitBranch': {
          const branch = await withPty((pty) => pty.getGitBranch(PtyId.make(params.ptyId as string)));
          sendResponse(socket, requestId, { branch });
          return;
        }

        case 'getTitle': {
          const title = await withPty((pty) => pty.getTitle(PtyId.make(params.ptyId as string)));
          sendResponse(socket, requestId, { title });
          return;
        }

        case 'registerPane': {
          const sessionId = params.sessionId as string;
          const paneId = params.paneId as string;
          const ptyId = params.ptyId as string;
          if (sessionId && paneId && ptyId) {
            registerMapping(sessionId, paneId, ptyId);
          }
          sendResponse(socket, requestId);
          return;
        }

        case 'getSessionMapping': {
          const sessionId = params.sessionId as string;
          const entries = Array.from(sessionPanes.get(sessionId)?.entries() ?? []).map(([paneId, ptyId]) => ({ paneId, ptyId }));
          sendResponse(socket, requestId, { entries });
          return;
        }

        default:
          sendError(socket, requestId, `Unknown method: ${method}`);
      }
    } catch (error) {
      sendError(socket, requestId, error instanceof Error ? error.message : 'Request failed');
    }
  }

  return {
    socketPath,
    socketDir,
    handleRequest,
    detachClient,
  };
}

export async function startShimServer(options?: ShimServerOptions): Promise<net.Server> {
  sessionPanes.clear();
  ptyToPane.clear();
  clientIds.clear();
  revokedClientIds.clear();
  ptySubscriptions.clear();
  lifecycleUnsub = null;
  titleUnsub = null;
  activeClient = null;
  activeClientId = null;
  hostColorsSet = false;

  const handlers = createServerHandlers(options);
  await ensureSocketDir(handlers.socketDir);
  await removeSocketFile(handlers.socketPath);

  const server = net.createServer((socket) => {
    const frameReader = new FrameReader();

    socket.on('data', (chunk) => {
      frameReader.feed(chunk, (header, payloads) => {
        if (header.type === 'request') {
          handlers.handleRequest(socket, header, payloads).catch(() => {});
        }
      });
    });

    socket.on('close', () => {
      clientIds.delete(socket);
      handlers.detachClient(socket).catch(() => {});
    });

    socket.on('error', () => {
      clientIds.delete(socket);
      handlers.detachClient(socket).catch(() => {});
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(handlers.socketPath, () => resolve());
    server.once('error', reject);
  });

  return server;
}
