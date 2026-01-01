import type { TerminalCell, TerminalScrollState, TerminalState } from '../core/types';
import type { SearchResult } from '../terminal/emulator-interface';
import type { GitInfo } from '../effect/services/pty/helpers';
import { unpackRow, unpackTerminalState, CELL_SIZE } from '../terminal/cell-serialization';
import { RemoteEmulator } from './client/emulator';
import { sendRequest } from './client/connection';
import { bufferToArrayBuffer } from './client/utils';
import {
  getKittyState,
  getPtyState,
  registerEmulatorFactory,
  setPtyState,
  subscribeKittyTransmit,
  subscribeKittyUpdate,
} from './client/state';

export async function createPty(options: {
  cols: number;
  rows: number;
  cwd?: string;
  pixelWidth?: number;
  pixelHeight?: number;
}): Promise<string> {
  const response = await sendRequest('createPty', options);
  return (response.header.result as { ptyId: string }).ptyId;
}

export async function writePty(ptyId: string, data: string): Promise<void> {
  await sendRequest('write', { ptyId, data });
}

export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number,
  pixelWidth?: number,
  pixelHeight?: number
): Promise<void> {
  await sendRequest('resize', { ptyId, cols, rows, pixelWidth, pixelHeight });
}

export async function destroyPty(ptyId: string): Promise<void> {
  await sendRequest('destroy', { ptyId });
}

export async function destroyAllPtys(): Promise<void> {
  await sendRequest('destroyAll');
}

export async function getPtyCwd(ptyId: string): Promise<string> {
  const response = await sendRequest('getCwd', { ptyId });
  return (response.header.result as { cwd: string }).cwd;
}

export async function getTerminalState(ptyId: string): Promise<TerminalState | null> {
  const cached = getPtyState(ptyId)?.terminalState;
  if (cached) {
    return cached;
  }

  const response = await sendRequest('getTerminalState', { ptyId });
  if (response.payloads.length === 0) {
    return null;
  }

  const buffer = bufferToArrayBuffer(response.payloads[0]!);
  const state = unpackTerminalState(buffer);
  const existing = getPtyState(ptyId);
  const scrollState = existing?.scrollState ?? { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true };
  setPtyState(ptyId, {
    terminalState: state,
    cachedRows: [...state.cells],
    scrollState,
    title: existing?.title ?? '',
  });
  return state;
}

export async function getScrollState(ptyId: string): Promise<TerminalScrollState | null> {
  const cached = getPtyState(ptyId)?.scrollState;
  if (cached) {
    return cached;
  }

  const response = await sendRequest('getScrollState', { ptyId });
  const scrollState = response.header.result as TerminalScrollState | undefined;
  if (scrollState) {
    const existing = getPtyState(ptyId);
    setPtyState(ptyId, {
      terminalState: existing?.terminalState ?? null,
      cachedRows: existing?.cachedRows ?? [],
      scrollState,
      title: existing?.title ?? '',
    });
  }
  return scrollState ?? null;
}

export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  await sendRequest('setScrollOffset', { ptyId, offset });
}

export async function setUpdateEnabled(ptyId: string, enabled: boolean): Promise<void> {
  await sendRequest('setUpdateEnabled', { ptyId, enabled });
}

export async function getScrollbackLines(
  ptyId: string,
  startOffset: number,
  count: number
): Promise<Map<number, TerminalCell[]>> {
  const response = await sendRequest('getScrollbackLines', { ptyId, startOffset, count });
  const lineOffsets = (response.header.result as { lineOffsets: number[] }).lineOffsets;
  const payload = response.payloads[0];
  if (!payload) {
    return new Map();
  }

  const lines = new Map<number, TerminalCell[]>();
  let offset = 0;
  for (const lineOffset of lineOffsets) {
    const slice = payload.subarray(offset);
    const row = unpackRow(bufferToArrayBuffer(slice));
    lines.set(lineOffset, row);
    offset += 4 + row.length * CELL_SIZE;
  }

  return lines;
}

export async function searchPty(
  ptyId: string,
  query: string,
  options?: { limit?: number }
): Promise<SearchResult> {
  const response = await sendRequest('search', { ptyId, query, limit: options?.limit });
  return (response.header.result as SearchResult) ?? { matches: [], hasMore: false };
}

export async function listAllPtys(): Promise<string[]> {
  const response = await sendRequest('listAll');
  return (response.header.result as { ptyIds: string[] }).ptyIds;
}

export async function getSessionInfo(ptyId: string): Promise<{ id: string; pid: number; cols: number; rows: number; cwd: string; shell: string } | null> {
  const response = await sendRequest('getSession', { ptyId });
  return (response.header.result as { session: { id: string; pid: number; cols: number; rows: number; cwd: string; shell: string } | null }).session;
}

export async function getForegroundProcess(ptyId: string): Promise<string | undefined> {
  const response = await sendRequest('getForegroundProcess', { ptyId });
  return (response.header.result as { process?: string }).process;
}

export async function getGitBranch(ptyId: string): Promise<string | undefined> {
  const response = await sendRequest('getGitBranch', { ptyId });
  return (response.header.result as { branch?: string }).branch;
}

export async function getGitInfo(ptyId: string): Promise<GitInfo | undefined> {
  const response = await sendRequest('getGitInfo', { ptyId });
  const info = (response.header.result as {
    info?: {
      branch?: string;
      dirty?: boolean;
      staged?: number;
      unstaged?: number;
      untracked?: number;
      conflicted?: number;
      ahead?: number | null;
      behind?: number | null;
      stashCount?: number | null;
      state?: GitInfo["state"];
      detached?: boolean;
      repoKey?: string;
    } | null;
  }).info ?? undefined;
  if (!info?.repoKey) return undefined;
  return {
    branch: info.branch ?? undefined,
    dirty: Boolean(info.dirty),
    staged: Number(info.staged ?? 0),
    unstaged: Number(info.unstaged ?? 0),
    untracked: Number(info.untracked ?? 0),
    conflicted: Number(info.conflicted ?? 0),
    ahead: info.ahead ?? undefined,
    behind: info.behind ?? undefined,
    stashCount: info.stashCount ?? undefined,
    state: info.state ?? undefined,
    detached: Boolean(info.detached),
    repoKey: info.repoKey,
  };
}

export async function getGitDiffStats(
  ptyId: string
): Promise<{ added: number; removed: number; binary: number } | undefined> {
  const response = await sendRequest('getGitDiffStats', { ptyId });
  const diff = (response.header.result as {
    diff?: { added: number; removed: number; binary?: number } | null;
  }).diff;
  if (!diff) return undefined;
  return {
    added: Number(diff.added ?? 0),
    removed: Number(diff.removed ?? 0),
    binary: Number(diff.binary ?? 0),
  };
}

export async function getTitle(ptyId: string): Promise<string> {
  const cached = getPtyState(ptyId)?.title;
  if (cached !== undefined) {
    return cached;
  }

  const response = await sendRequest('getTitle', { ptyId });
  return (response.header.result as { title: string }).title ?? '';
}

export async function getLastCommand(ptyId: string): Promise<string | undefined> {
  const response = await sendRequest('getLastCommand', { ptyId });
  return (response.header.result as { command?: string }).command;
}

export async function registerPaneMapping(sessionId: string, paneId: string, ptyId: string): Promise<void> {
  await sendRequest('registerPane', { sessionId, paneId, ptyId });
}

export async function getSessionMapping(sessionId: string): Promise<{
  mapping: Map<string, string>;
  stalePaneIds: string[];
}> {
  const response = await sendRequest('getSessionMapping', { sessionId });
  const result = response.header.result as {
    entries?: Array<{ paneId: string; ptyId: string }>;
    stalePaneIds?: string[];
  } | undefined;
  const entries = result?.entries ?? [];
  return {
    mapping: new Map(entries.map((entry) => [entry.paneId, entry.ptyId])),
    stalePaneIds: result?.stalePaneIds ?? [],
  };
}

function createRemoteEmulator(ptyId: string): RemoteEmulator {
  return new RemoteEmulator(ptyId, {
    getPtyState,
    getKittyState,
    fetchScrollbackLines: getScrollbackLines,
    searchPty,
  });
}

registerEmulatorFactory(createRemoteEmulator);

export {
  getEmulator,
  subscribeExit,
  subscribeKittyTransmit,
  subscribeKittyUpdate,
  subscribeScroll,
  subscribeState,
  subscribeToAllTitles,
  subscribeToLifecycle,
  subscribeToTitle,
  subscribeUnified,
} from './client/state';
export { onShimDetached, shutdownShim, waitForShim } from './client/connection';
