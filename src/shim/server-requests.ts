import type net from 'net';

import type { PtyService } from '../effect/services/Pty';
import { asPtyId, makeCols, makeRows } from '../effect/types';
import type { TerminalScrollState, TerminalState } from '../core/types';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { packTerminalState, packRow } from '../terminal/cell-serialization';
import { captureEmulator, type CaptureFormat } from '../control/capture';
import type { ShimHeader } from './protocol';
import {
  attachClient,
  registerMapping,
  removeMappingForPty,
  type ShimHandlerContext,
} from './handlers';
import type { ShimPtyMetadata, ShimPtySessionInfo } from './pty-metadata';
import type { TerminalColors } from '../terminal/terminal-colors';

/**
 * Type guard for validating TerminalColors structure.
 * @param value - Unknown value to validate
 * @returns True if value is a valid TerminalColors object
 */
function isTerminalColors(value: unknown): value is TerminalColors {
  if (!value || typeof value !== 'object') return false;
  const colors = value as Record<string, unknown>;
  return (
    typeof colors.foreground === 'number' &&
    typeof colors.background === 'number' &&
    Array.isArray(colors.palette) &&
    colors.palette.length >= 16 &&
    colors.palette.every((c: unknown) => typeof c === 'number') &&
    typeof colors.isDefault === 'boolean'
  );
}

/**
 * Reads a value from the PTY service, handling errors gracefully.
 * Returns null if the operation fails.
 * @param context - Handler context with PTY access
 * @param fn - Function to execute with PTY service
 * @returns Retrieved value or null on error
 */
async function readPtyValue<T>(
  context: Pick<ShimHandlerContext, 'withPty'>,
  fn: (pty: PtyService) => Promise<T | Error> | T | Error
): Promise<Exclude<T, Error> | null> {
  try {
    const result = await context.withPty(fn);
    return result instanceof Error ? null : (result as Exclude<T, Error>);
  } catch (err) {
    console.warn('[shim] readPtyValue failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Serializes a session object from the PTY service into ShimPtySessionInfo.
 * Validates required fields and coerces types.
 * @param session - Raw session data from PTY service
 * @returns Validated session info or null if invalid
 */
function serializeSession(session: unknown): ShimPtySessionInfo | null {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const value = session as {
    id?: string | number;
    pid?: number;
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
  };

  if (!value.id || typeof value.pid !== 'number') {
    return null;
  }

  return {
    id: String(value.id),
    pid: value.pid,
    cols: Number(value.cols ?? 0),
    rows: Number(value.rows ?? 0),
    cwd: value.cwd ?? '',
    shell: value.shell ?? '',
  };
}

function getRuntimeSessionFields(session: unknown): { title: string; lastCommand?: string } {
  if (!session || typeof session !== 'object') {
    return { title: '' };
  }

  const value = session as {
    title?: string;
    lastCommand?: string;
  };

  return {
    title: value.title ?? '',
    lastCommand: value.lastCommand ?? undefined,
  };
}

/**
 * Retrieves comprehensive metadata for a PTY.
 * Aggregates session info, CWD, foreground process, git info, title, and last command.
 * @param context - Handler context with PTY access
 * @param ptyId - PTY identifier
 * @returns Complete PTY metadata
 */
async function getPtyMetadata(
  context: ShimHandlerContext,
  ptyId: string
): Promise<ShimPtyMetadata> {
  const [sessionValue, cwd, foregroundProcess, gitInfoWithDiff] = await Promise.all([
    readPtyValue(context, (pty) => pty.getSession(asPtyId(ptyId))),
    readPtyValue(context, (pty) => pty.getCwd(asPtyId(ptyId))),
    readPtyValue(context, (pty) => pty.getForegroundProcess(asPtyId(ptyId))),
    readPtyValue(context, (pty) => pty.getGitInfo(asPtyId(ptyId), { includeDiffStats: true })),
  ]);

  const runtimeSession = getRuntimeSessionFields(sessionValue);
  const session = serializeSession(sessionValue);

  const gitInfo = gitInfoWithDiff
    ? {
        branch: gitInfoWithDiff.branch,
        dirty: gitInfoWithDiff.dirty,
        staged: gitInfoWithDiff.staged,
        unstaged: gitInfoWithDiff.unstaged,
        untracked: gitInfoWithDiff.untracked,
        conflicted: gitInfoWithDiff.conflicted,
        ahead: gitInfoWithDiff.ahead,
        behind: gitInfoWithDiff.behind,
        stashCount: gitInfoWithDiff.stashCount,
        state: gitInfoWithDiff.state,
        detached: gitInfoWithDiff.detached,
        repoKey: gitInfoWithDiff.repoKey,
        isWorktree: gitInfoWithDiff.isWorktree,
        commonDir: gitInfoWithDiff.commonDir,
      }
    : undefined;
  const gitDiffStats = gitInfoWithDiff?.diffStats;

  return {
    session,
    cwd: cwd ?? session?.cwd ?? null,
    foregroundProcess: foregroundProcess ?? undefined,
    gitInfo,
    gitDiffStats,
    title: runtimeSession.title,
    lastCommand: runtimeSession.lastCommand,
  };
}

async function getPtyCwdEntries(
  context: ShimHandlerContext,
  ptyIds: string[]
): Promise<Array<{ ptyId: string; cwd: string }>> {
  const uniquePtyIds = [...new Set(ptyIds)];
  if (uniquePtyIds.length === 0) {
    return [];
  }

  const liveCwdEntries = await Promise.all(
    uniquePtyIds.map(async (ptyId) => {
      const cwd = await readPtyValue(context, (pty) => pty.getCwd(asPtyId(ptyId)));
      return [ptyId, cwd] as const;
    })
  );

  const cwdByPtyId = new Map<string, string>();
  const missingPtyIds: string[] = [];

  for (const [ptyId, cwd] of liveCwdEntries) {
    if (cwd !== null) {
      cwdByPtyId.set(ptyId, cwd);
      continue;
    }
    missingPtyIds.push(ptyId);
  }

  if (missingPtyIds.length > 0) {
    const sessionEntries = await Promise.all(
      missingPtyIds.map(async (ptyId) => {
        const sessionValue = await readPtyValue(context, (pty) => pty.getSession(asPtyId(ptyId)));
        return [ptyId, serializeSession(sessionValue)] as const;
      })
    );

    for (const [ptyId, session] of sessionEntries) {
      cwdByPtyId.set(ptyId, session?.cwd ?? '');
    }
  }

  return uniquePtyIds.map((ptyId) => ({
    ptyId,
    cwd: cwdByPtyId.get(ptyId) ?? '',
  }));
}

/**
 * Validates and extracts ptyId from request parameters.
 * Sends error response if ptyId is missing.
 * @param context - Handler context for error responses
 * @param socket - Client socket for error response
 * @param requestId - Request identifier for error response
 * @param requestParams - Request parameters to extract ptyId from
 * @returns Valid ptyId string or null if missing
 */
function requirePtyId(
  context: Pick<ShimHandlerContext, 'sendError'>,
  socket: net.Socket,
  requestId: number,
  requestParams: Record<string, unknown>
): string | null {
  const ptyId = typeof requestParams.ptyId === 'string' ? requestParams.ptyId : null;
  if (ptyId) {
    return ptyId;
  }

  context.sendError(socket, requestId, 'Missing ptyId');
  return null;
}

/**
 * Creates the main request handler for shim server RPC calls.
 * Routes requests to appropriate handlers based on method name.
 * @param context - Handler context with state, PTY access, and response utilities
 * @returns Request handler function for processing incoming requests
 */
export function createRequestHandler(context: ShimHandlerContext) {
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
      if (method !== 'hello' && context.state.activeClient !== socket) {
        context.sendError(socket, requestId, 'Inactive client');
        socket.end();
        return;
      }

      switch (method) {
        case 'hello': {
          const clientId =
            typeof requestParams.clientId === 'string' ? requestParams.clientId : null;
          if (!clientId) {
            context.sendError(socket, requestId, 'Missing clientId');
            socket.end();
            return;
          }
          if (context.state.revokedClientIds.has(clientId)) {
            context.sendError(socket, requestId, 'Client is detached');
            socket.end();
            return;
          }
          if (context.state.activeClient === socket && context.state.activeClientId === clientId) {
            context.sendResponse(socket, requestId, { pid: process.pid, clientId });
            return;
          }
          await attachClient(context, { socket, clientId });
          context.sendResponse(socket, requestId, { pid: process.pid, clientId });
          return;
        }

        case 'setHostColors': {
          const colors = requestParams.colors;
          if (colors && isTerminalColors(colors)) {
            await context.applyHostColors(colors);
            context.state.hostColorsSet = true;
          }
          context.sendResponse(socket, requestId, { applied: context.state.hostColorsSet });
          return;
        }

        case 'createPty': {
          const ptyId = await context.withPty((pty) =>
            pty.create({
              cols: makeCols(requestParams.cols as number),
              rows: makeRows(requestParams.rows as number),
              cwd: requestParams.cwd as string | undefined,
              pixelWidth: requestParams.pixelWidth as number | undefined,
              pixelHeight: requestParams.pixelHeight as number | undefined,
            })
          );
          context.sendResponse(socket, requestId, { ptyId: String(ptyId) });
          return;
        }

        case 'write': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          await context.withPty((pty) => pty.write(asPtyId(ptyId), requestParams.data as string));
          context.sendResponse(socket, requestId);
          return;
        }

        case 'sendFocusEvent': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          await context.withPty((pty) =>
            pty.sendFocusEvent(asPtyId(ptyId), Boolean(requestParams.focused))
          );
          context.sendResponse(socket, requestId);
          return;
        }

        case 'resize': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          await context.withPty((pty) =>
            pty.resize(
              asPtyId(ptyId),
              makeCols(requestParams.cols as number),
              makeRows(requestParams.rows as number),
              requestParams.pixelWidth as number | undefined,
              requestParams.pixelHeight as number | undefined
            )
          );
          context.sendResponse(socket, requestId);
          return;
        }

        case 'destroy': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          removeMappingForPty(context.state, ptyId);
          await context.withPty((pty) => pty.destroy(asPtyId(ptyId)));
          context.sendResponse(socket, requestId);
          return;
        }

        case 'destroyAll':
          await context.withPty((pty) => pty.destroyAll());
          context.sendResponse(socket, requestId);
          return;

        case 'shutdown':
          // Acknowledge first so the UI can exit immediately; PTY teardown continues in the background.
          context.sendResponse(socket, requestId);
          setTimeout(() => {
            void context
              .withPty((pty) => pty.destroyAll())
              .catch((error) => {
                console.warn('[shim] Failed to destroy PTYs during shutdown:', error);
              })
              .finally(() => {
                process.exit(0);
              });
          }, 10);
          return;

        case 'getPtyMetadata': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const metadata = await getPtyMetadata(context, ptyId);
          context.sendResponse(socket, requestId, { metadata });
          return;
        }

        case 'getCwd': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;

          const entries = await getPtyCwdEntries(context, [ptyId]);
          context.sendResponse(socket, requestId, {
            cwd: entries[0]?.cwd ?? '',
          });
          return;
        }

        case 'getPtyCwds': {
          const ptyIds = Array.isArray(requestParams.ptyIds)
            ? requestParams.ptyIds.filter((value): value is string => typeof value === 'string')
            : [];
          const entries = await getPtyCwdEntries(context, ptyIds);
          context.sendResponse(socket, requestId, { entries });
          return;
        }

        case 'getTerminalState': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const state = (await context.withPty((pty) =>
            pty.getTerminalState(asPtyId(ptyId))
          )) as TerminalState;
          const payload = packTerminalState(state);
          context.sendResponse(socket, requestId, { cols: state.cols, rows: state.rows }, [
            payload,
          ]);
          return;
        }

        case 'getScrollState': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const scrollState = (await context.withPty((pty) =>
            pty.getScrollState(asPtyId(ptyId))
          )) as TerminalScrollState;
          context.sendResponse(socket, requestId, scrollState);
          return;
        }

        case 'setScrollOffset': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          await context.withPty((pty) =>
            pty.setScrollOffset(asPtyId(ptyId), requestParams.offset as number)
          );
          context.sendResponse(socket, requestId);
          return;
        }

        case 'setUpdateEnabled': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          await context.withPty((pty) =>
            pty.setUpdateEnabled(asPtyId(ptyId), Boolean(requestParams.enabled))
          );
          context.sendResponse(socket, requestId);
          return;
        }

        case 'getScrollbackLines': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const startOffset = requestParams.startOffset as number;
          const count = requestParams.count as number;
          const emulator = (await context.withPty((pty) =>
            pty.getEmulator(asPtyId(ptyId))
          )) as ITerminalEmulator;

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

          context.sendResponse(socket, requestId, { lineOffsets }, [combined]);
          return;
        }

        case 'capturePane': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const requestedLines =
            typeof requestParams.lines === 'number' ? requestParams.lines : Number.NaN;
          const lines = Number.isFinite(requestedLines)
            ? Math.max(1, Math.floor(requestedLines))
            : 200;
          const formatParam = requestParams.format;
          const format: CaptureFormat = formatParam === 'ansi' ? 'ansi' : 'text';
          const raw = requestParams.raw === true;
          const emulator = (await context.withPty((pty) =>
            pty.getEmulator(asPtyId(ptyId))
          )) as ITerminalEmulator;
          const text = captureEmulator(emulator, {
            lines,
            format,
            trimTrailing: !raw,
            trimTrailingLines: !raw,
          });
          context.sendResponse(socket, requestId, { text, lines, format });
          return;
        }

        case 'search': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const query = requestParams.query as string;
          const limit = requestParams.limit as number | undefined;
          const emulator = (await context.withPty((pty) =>
            pty.getEmulator(asPtyId(ptyId))
          )) as ITerminalEmulator;
          const result = await emulator.search(query, { limit });
          context.sendResponse(socket, requestId, result);
          return;
        }

        case 'listAll': {
          const ids = (await context.withPty((pty) => pty.listAll())) as Array<string>;
          context.sendResponse(socket, requestId, { ptyIds: ids.map(String) });
          return;
        }

        case 'getSession': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const sessionValue = await readPtyValue(context, (pty) => pty.getSession(asPtyId(ptyId)));
          context.sendResponse(socket, requestId, { session: serializeSession(sessionValue) });
          return;
        }

        case 'getForegroundProcess': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const processName = await readPtyValue(context, (pty) =>
            pty.getForegroundProcess(asPtyId(ptyId))
          );
          context.sendResponse(socket, requestId, { process: processName ?? undefined });
          return;
        }

        case 'getGitBranch': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const info = await readPtyValue(context, (pty) =>
            pty.getGitInfo(asPtyId(ptyId), { includeDiffStats: false })
          );
          context.sendResponse(socket, requestId, { branch: info?.branch });
          return;
        }

        case 'getGitInfo': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const info = await readPtyValue(context, (pty) =>
            pty.getGitInfo(asPtyId(ptyId), { includeDiffStats: false })
          );
          context.sendResponse(socket, requestId, { info: info ?? undefined });
          return;
        }

        case 'getGitDiffStats': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const info = await readPtyValue(context, (pty) =>
            pty.getGitInfo(asPtyId(ptyId), { includeDiffStats: true })
          );
          context.sendResponse(socket, requestId, { diff: info?.diffStats });
          return;
        }

        case 'getTitle': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const sessionValue = await readPtyValue(context, (pty) => pty.getSession(asPtyId(ptyId)));
          const runtimeSession = getRuntimeSessionFields(sessionValue);
          context.sendResponse(socket, requestId, { title: runtimeSession.title });
          return;
        }

        case 'getLastCommand': {
          const ptyId = requirePtyId(context, socket, requestId, requestParams);
          if (!ptyId) return;
          const sessionValue = await readPtyValue(context, (pty) => pty.getSession(asPtyId(ptyId)));
          const runtimeSession = getRuntimeSessionFields(sessionValue);
          context.sendResponse(socket, requestId, { command: runtimeSession.lastCommand });
          return;
        }

        case 'registerPane': {
          const sessionId = requestParams.sessionId as string;
          const paneId = requestParams.paneId as string;
          const ptyId = requestParams.ptyId as string;
          if (sessionId && paneId && ptyId) {
            registerMapping(context.state, sessionId, paneId, ptyId);
          }
          context.sendResponse(socket, requestId);
          return;
        }

        case 'getSessionMapping': {
          const sessionId = requestParams.sessionId as string;
          const sessionPanes = context.state.sessionPanes.get(sessionId);
          const stalePaneIds: string[] = [];

          if (sessionPanes && sessionPanes.size > 0) {
            const activePtys = await readPtyValue<Array<string>>(context, (pty) => pty.listAll());
            if (activePtys) {
              const activeSet = new Set(activePtys.map((id) => String(id)));
              const stalePtyIds: string[] = [];

              for (const [paneId, ptyId] of sessionPanes.entries()) {
                if (!activeSet.has(ptyId)) {
                  stalePaneIds.push(paneId);
                  stalePtyIds.push(ptyId);
                }
              }

              for (const ptyId of stalePtyIds) {
                removeMappingForPty(context.state, ptyId);
              }
            }
          }

          const entries = Array.from(
            context.state.sessionPanes.get(sessionId)?.entries() ?? []
          ).map(([paneId, ptyId]) => ({ paneId, ptyId }));
          context.sendResponse(socket, requestId, { entries, stalePaneIds });
          return;
        }

        default:
          context.sendError(socket, requestId, `Unknown method: ${method}`);
      }
    } catch (error) {
      context.sendError(
        socket,
        requestId,
        error instanceof Error ? error.message : 'Request failed'
      );
    }
  };
}
