import type net from 'net';

import { PtyId, Cols, Rows } from '../effect/types';
import type { TerminalScrollState, TerminalState } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { packTerminalState, packRow } from '../terminal/cell-serialization';
import type { TerminalColors } from '../terminal/terminal-colors';
import type { ShimHeader } from './protocol';
import type { ShimServerState } from './server-state';
import type { WithPty } from './server-handlers';

export function createRequestHandler(params: {
  state: ShimServerState;
  withPty: WithPty;
  setHostColors: (colors: TerminalColors) => void;
  sendResponse: (socket: net.Socket, requestId: number, result?: unknown, payloads?: ArrayBuffer[]) => void;
  sendError: (socket: net.Socket, requestId: number, error: string) => void;
  attachClient: (socket: net.Socket, clientId: string) => Promise<void>;
  registerMapping: (sessionId: string, paneId: string, ptyId: string) => void;
  removeMappingForPty: (ptyId: string) => void;
}) {
  return async function handleRequest(
    socket: net.Socket,
    header: ShimHeader,
    _payloads: Buffer[]
  ): Promise<void> {
    const requestId = header.requestId;
    if (!requestId) return;

    const method = header.method as string | undefined;
    const requestParams = (header.params as Record<string, unknown>) ?? {};

    try {
      if (method !== 'hello' && params.state.activeClient !== socket) {
        params.sendError(socket, requestId, 'Inactive client');
        socket.end();
        return;
      }

      switch (method) {
        case 'hello':
          {
            const clientId = typeof requestParams.clientId === 'string' ? requestParams.clientId : null;
            if (!clientId) {
              params.sendError(socket, requestId, 'Missing clientId');
              socket.end();
              return;
            }
            if (params.state.revokedClientIds.has(clientId)) {
              params.sendError(socket, requestId, 'Client is detached');
              socket.end();
              return;
            }
            if (params.state.activeClient === socket && params.state.activeClientId === clientId) {
              params.sendResponse(socket, requestId, { pid: process.pid, clientId });
              return;
            }
            await params.attachClient(socket, clientId);
            params.sendResponse(socket, requestId, { pid: process.pid, clientId });
          }
          return;

        case 'setHostColors':
          if (!params.state.hostColorsSet && requestParams.colors) {
            params.setHostColors(requestParams.colors as any);
            params.state.hostColorsSet = true;
          }
          params.sendResponse(socket, requestId, { applied: params.state.hostColorsSet });
          return;

        case 'createPty': {
          const ptyId = await params.withPty((pty) => pty.create({
            cols: Cols.make(requestParams.cols as number),
            rows: Rows.make(requestParams.rows as number),
            cwd: requestParams.cwd as string | undefined,
          }));
          params.sendResponse(socket, requestId, { ptyId: String(ptyId) });
          return;
        }

        case 'write':
          await params.withPty((pty) => pty.write(PtyId.make(requestParams.ptyId as string), requestParams.data as string));
          params.sendResponse(socket, requestId);
          return;

        case 'resize':
          await params.withPty((pty) => pty.resize(
            PtyId.make(requestParams.ptyId as string),
            Cols.make(requestParams.cols as number),
            Rows.make(requestParams.rows as number)
          ));
          params.sendResponse(socket, requestId);
          return;

        case 'destroy':
          params.removeMappingForPty(requestParams.ptyId as string);
          await params.withPty((pty) => pty.destroy(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId);
          return;

        case 'destroyAll':
          await params.withPty((pty) => pty.destroyAll());
          params.sendResponse(socket, requestId);
          return;

        case 'shutdown':
          await params.withPty((pty) => pty.destroyAll());
          params.sendResponse(socket, requestId);
          setTimeout(() => {
            process.exit(0);
          }, 10);
          return;

        case 'setPanePosition':
          await params.withPty((pty) => pty.setPanePosition(
            PtyId.make(requestParams.ptyId as string),
            requestParams.x as number,
            requestParams.y as number
          ));
          params.sendResponse(socket, requestId);
          return;

        case 'getCwd': {
          const cwd = await params.withPty((pty) => pty.getCwd(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { cwd });
          return;
        }

        case 'getTerminalState': {
          const state = await params.withPty((pty) => pty.getTerminalState(PtyId.make(requestParams.ptyId as string))) as TerminalState;
          const payload = packTerminalState(state);
          params.sendResponse(socket, requestId, { cols: state.cols, rows: state.rows }, [payload]);
          return;
        }

        case 'getScrollState': {
          const scrollState = await params.withPty((pty) => pty.getScrollState(PtyId.make(requestParams.ptyId as string))) as TerminalScrollState;
          params.sendResponse(socket, requestId, scrollState);
          return;
        }

        case 'setScrollOffset':
          await params.withPty((pty) => pty.setScrollOffset(PtyId.make(requestParams.ptyId as string), requestParams.offset as number));
          params.sendResponse(socket, requestId);
          return;

        case 'setUpdateEnabled':
          await params.withPty((pty) => pty.setUpdateEnabled(
            PtyId.make(requestParams.ptyId as string),
            Boolean(requestParams.enabled)
          ));
          params.sendResponse(socket, requestId);
          return;

        case 'getScrollbackLines': {
          const ptyId = requestParams.ptyId as string;
          const startOffset = requestParams.startOffset as number;
          const count = requestParams.count as number;
          const emulator = await params.withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;

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

          params.sendResponse(socket, requestId, { lineOffsets }, [combined]);
          return;
        }

        case 'search': {
          const ptyId = requestParams.ptyId as string;
          const query = requestParams.query as string;
          const limit = requestParams.limit as number | undefined;
          const emulator = await params.withPty((pty) => pty.getEmulator(PtyId.make(ptyId))) as ITerminalEmulator;
          const result = await emulator.search(query, { limit });
          params.sendResponse(socket, requestId, result);
          return;
        }

        case 'listAll': {
          const ids = await params.withPty((pty) => pty.listAll()) as Array<string>;
          params.sendResponse(socket, requestId, { ptyIds: ids.map(String) });
          return;
        }

        case 'getSession': {
          const session = await params.withPty((pty) => pty.getSession(PtyId.make(requestParams.ptyId as string))) as any;
          params.sendResponse(socket, requestId, { session: session ? {
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
          const proc = await params.withPty((pty) => pty.getForegroundProcess(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { process: proc });
          return;
        }

        case 'getGitBranch': {
          const branch = await params.withPty((pty) => pty.getGitBranch(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { branch });
          return;
        }

        case 'getGitInfo': {
          const info = await params.withPty((pty) => pty.getGitInfo(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { info });
          return;
        }

        case 'getGitDiffStats': {
          const diff = await params.withPty((pty) => pty.getGitDiffStats(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { diff });
          return;
        }

        case 'getTitle': {
          const title = await params.withPty((pty) => pty.getTitle(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { title });
          return;
        }

        case 'getLastCommand': {
          const command = await params.withPty((pty) => pty.getLastCommand(PtyId.make(requestParams.ptyId as string)));
          params.sendResponse(socket, requestId, { command });
          return;
        }

        case 'registerPane': {
          const sessionId = requestParams.sessionId as string;
          const paneId = requestParams.paneId as string;
          const ptyId = requestParams.ptyId as string;
          if (sessionId && paneId && ptyId) {
            params.registerMapping(sessionId, paneId, ptyId);
          }
          params.sendResponse(socket, requestId);
          return;
        }

        case 'getSessionMapping': {
          const sessionId = requestParams.sessionId as string;
          const sessionPanes = params.state.sessionPanes.get(sessionId);
          const stalePaneIds: string[] = [];

          if (sessionPanes && sessionPanes.size > 0) {
            try {
              const activePtys = await params.withPty((pty) => pty.listAll()) as Array<string>;
              const activeSet = new Set(activePtys.map((id) => String(id)));
              const stalePtyIds: string[] = [];

              for (const [paneId, ptyId] of sessionPanes.entries()) {
                if (!activeSet.has(ptyId)) {
                  stalePaneIds.push(paneId);
                  stalePtyIds.push(ptyId);
                }
              }

              for (const ptyId of stalePtyIds) {
                params.removeMappingForPty(ptyId);
              }
            } catch {
              // Ignore prune errors - return existing mapping as-is.
            }
          }

          const entries = Array.from(params.state.sessionPanes.get(sessionId)?.entries() ?? []).map(([paneId, ptyId]) => ({ paneId, ptyId }));
          params.sendResponse(socket, requestId, { entries, stalePaneIds });
          return;
        }

        default:
          params.sendError(socket, requestId, `Unknown method: ${method}`);
      }
    } catch (error) {
      params.sendError(socket, requestId, error instanceof Error ? error.message : 'Request failed');
    }
  };
}
