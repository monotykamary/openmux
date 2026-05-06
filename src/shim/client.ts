import type {
  TerminalCell,
  TerminalScrollState,
  TerminalState,
  UnifiedTerminalUpdate,
} from '../core/types';
import type { SearchResult } from '../terminal/emulator-interface';
import type { TerminalColors } from '../terminal/terminal-colors';
import type { GitInfo } from '../effect/services/pty/helpers';
import { unpackRow, unpackTerminalState, CELL_SIZE } from '../terminal/cell-serialization';
import { RemoteEmulator } from './client/emulator';
import { sendRequest } from './client/connection';
import { bufferToArrayBuffer } from './client/utils';
import type { ShimPtyMetadata } from './pty-metadata';
import { defaultRegistry } from './client/state';

/**
 * Builds fallback PTY metadata from cached values.
 * Falls back to empty defaults if no cache available.
 */
function buildFallbackPtyMetadata(ptyId: string): ShimPtyMetadata {
  const cachedMetadata = defaultRegistry.getCachedPtyMetadata(ptyId)?.value;
  if (cachedMetadata) {
    return {
      ...cachedMetadata,
      title: defaultRegistry.getPtyState(ptyId)?.title ?? cachedMetadata.title,
    };
  }

  return {
    session: null,
    cwd: null,
    title: defaultRegistry.getPtyState(ptyId)?.title ?? '',
  };
}

/**
 * Creates a new PTY.
 * @param options - Terminal dimensions and optional working directory
 * @returns PTY identifier
 */
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

/**
 * Writes data to a PTY.
 * @param ptyId - PTY identifier
 * @param data - Data string to write
 */
export async function writePty(ptyId: string, data: string): Promise<void> {
  await sendRequest('write', { ptyId, data });
}

/**
 * Sends a focus event to a PTY.
 * @param ptyId - PTY identifier
 * @param focused - Whether the PTY is focused
 */
export async function sendFocusEvent(ptyId: string, focused: boolean): Promise<void> {
  await sendRequest('sendFocusEvent', { ptyId, focused });
}

/**
 * Resizes a PTY.
 * @param ptyId - PTY identifier
 * @param cols - New column count
 * @param rows - New row count
 * @param pixelWidth - Optional pixel width
 * @param pixelHeight - Optional pixel height
 */
export async function resizePty(
  ptyId: string,
  cols: number,
  rows: number,
  pixelWidth?: number,
  pixelHeight?: number
): Promise<void> {
  await sendRequest('resize', { ptyId, cols, rows, pixelWidth, pixelHeight });
}

/**
 * Destroys a PTY.
 * @param ptyId - PTY identifier
 */
export async function destroyPty(ptyId: string): Promise<void> {
  await sendRequest('destroy', { ptyId });
}

/**
 * Destroys all PTYs.
 */
export async function destroyAllPtys(): Promise<void> {
  await sendRequest('destroyAll');
}

/**
 * Sets the host terminal colors.
 * @param colors - Terminal color configuration
 */
export async function setHostColors(colors: TerminalColors): Promise<void> {
  await sendRequest('setHostColors', { colors });
}

/**
 * Gets the current working directory of a PTY.
 * @param ptyId - PTY identifier
 * @returns Current working directory path
 */
export async function getPtyCwd(ptyId: string): Promise<string> {
  const response = await sendRequest('getCwd', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get CWD for PTY ${ptyId}:`, e);
    return null;
  });
  const fallback = buildFallbackPtyMetadata(ptyId);
  if (!response) {
    return fallback.cwd ?? fallback.session?.cwd ?? '';
  }

  const result = response.header.result as { cwd?: string } | undefined;
  return result?.cwd || fallback.cwd || fallback.session?.cwd || '';
}

/**
 * Gets current working directories for multiple PTYs in a single shim round trip.
 * @param ptyIds - PTY identifiers to resolve
 * @returns Map of PTY identifier to current working directory
 */
export async function getPtyCwds(ptyIds: string[]): Promise<Map<string, string>> {
  const uniquePtyIds = [...new Set(ptyIds)];
  if (uniquePtyIds.length === 0) {
    return new Map();
  }

  const response = await sendRequest('getPtyCwds', { ptyIds: uniquePtyIds });
  const result = response.header.result as
    | {
        entries?: Array<{ ptyId: string; cwd: string }>;
      }
    | undefined;

  return new Map((result?.entries ?? []).map((entry) => [entry.ptyId, entry.cwd]));
}

/**
 * Gets the terminal state for a PTY.
 * @param ptyId - PTY identifier
 * @param options - Optional force refresh
 * @returns Terminal state or null
 */
export async function getTerminalState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalState | null> {
  const cached = defaultRegistry.getPtyState(ptyId)?.terminalState;
  if (cached && !options?.force) {
    return cached;
  }

  const response = await sendRequest('getTerminalState', { ptyId });
  if (response.payloads.length === 0) {
    return cached ?? null;
  }

  const buffer = bufferToArrayBuffer(response.payloads[0]!);
  const state = unpackTerminalState(buffer);
  const existing = defaultRegistry.getPtyState(ptyId);
  const scrollState = existing?.scrollState ?? {
    viewportOffset: 0,
    scrollbackLength: 0,
    isAtBottom: true,
  };
  defaultRegistry.setPtyState(ptyId, {
    terminalState: state,
    cachedRows: [...state.cells],
    scrollState,
    title: existing?.title ?? '',
  });
  return state;
}

/**
 * Gets the scroll state for a PTY.
 * @param ptyId - PTY identifier
 * @param options - Optional force refresh
 * @returns Scroll state or null
 */
export async function getScrollState(
  ptyId: string,
  options?: { force?: boolean }
): Promise<TerminalScrollState | null> {
  const cached = defaultRegistry.getPtyState(ptyId)?.scrollState;
  if (cached && !options?.force) {
    return cached;
  }

  const response = await sendRequest('getScrollState', { ptyId });
  const scrollState = response.header.result as TerminalScrollState | undefined;
  if (scrollState) {
    const existing = defaultRegistry.getPtyState(ptyId);
    defaultRegistry.setPtyState(ptyId, {
      terminalState: existing?.terminalState ?? null,
      cachedRows: existing?.cachedRows ?? [],
      scrollState,
      title: existing?.title ?? '',
    });
  }
  return scrollState ?? cached ?? null;
}

/**
 * Sets the scroll offset for a PTY.
 * @param ptyId - PTY identifier
 * @param offset - Scroll offset value
 */
export async function setScrollOffset(ptyId: string, offset: number): Promise<void> {
  await sendRequest('setScrollOffset', { ptyId, offset });
}

/**
 * Enables or disables updates for a PTY.
 * @param ptyId - PTY identifier
 * @param enabled - Whether updates are enabled
 */
export async function setUpdateEnabled(ptyId: string, enabled: boolean): Promise<void> {
  await sendRequest('setUpdateEnabled', { ptyId, enabled });
}

/**
 * Gets scrollback lines for a PTY.
 * @param ptyId - PTY identifier
 * @param startOffset - Starting line offset
 * @param count - Number of lines to fetch
 * @returns Map of line offsets to cell arrays
 */
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

/**
 * Captures the current content of a PTY.
 * @param ptyId - PTY identifier
 * @param options - Capture options including lines, format, and raw mode
 * @returns Captured text content
 */
export async function capturePty(
  ptyId: string,
  options?: { lines?: number; format?: 'text' | 'ansi'; raw?: boolean }
): Promise<string> {
  const response = await sendRequest('capturePane', {
    ptyId,
    lines: options?.lines,
    format: options?.format,
    raw: options?.raw,
  });
  const result = response.header.result as { text?: string } | undefined;
  return result?.text ?? '';
}

/**
 * Searches a PTY's content.
 * @param ptyId - PTY identifier
 * @param query - Search query string
 * @param options - Search options including result limit
 * @returns Search results with matches
 */
export async function searchPty(
  ptyId: string,
  query: string,
  options?: { limit?: number }
): Promise<SearchResult> {
  const response = await sendRequest('search', { ptyId, query, limit: options?.limit });
  return (response.header.result as SearchResult) ?? { matches: [], hasMore: false };
}

/**
 * Lists all active PTY IDs.
 * @returns Array of PTY identifiers
 */
export async function listAllPtys(): Promise<string[]> {
  const response = await sendRequest('listAll');
  return (response.header.result as { ptyIds: string[] }).ptyIds;
}

/**
 * Gets session information for a PTY.
 * @param ptyId - PTY identifier
 * @returns Session info including PID, dimensions, CWD, and shell
 */
export async function getSessionInfo(ptyId: string): Promise<{
  id: string;
  pid: number;
  cols: number;
  rows: number;
  cwd: string;
  shell: string;
} | null> {
  const response = await sendRequest('getSession', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get session for PTY ${ptyId}:`, e);
    return null;
  });
  if (!response) {
    return buildFallbackPtyMetadata(ptyId).session;
  }

  const result = response.header.result as
    | {
        session?: {
          id: string;
          pid: number;
          cols: number;
          rows: number;
          cwd: string;
          shell: string;
        } | null;
      }
    | undefined;
  return result?.session ?? null;
}

/**
 * Gets the foreground process name for a PTY.
 * @param ptyId - PTY identifier
 * @returns Process name or undefined
 */
export async function getForegroundProcess(ptyId: string): Promise<string | undefined> {
  const response = await sendRequest('getForegroundProcess', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get foreground process for PTY ${ptyId}:`, e);
    return null;
  });
  if (!response) {
    return buildFallbackPtyMetadata(ptyId).foregroundProcess;
  }

  const result = response.header.result as { process?: string } | undefined;
  return result?.process;
}

/**
 * Gets Git repository information for a PTY's CWD.
 * @param ptyId - PTY identifier
 * @returns Git info or undefined
 */
export async function getGitInfo(ptyId: string): Promise<GitInfo | undefined> {
  const response = await sendRequest('getGitInfo', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get Git info for PTY ${ptyId}:`, e);
    return null;
  });
  const info = response
    ? ((response.header.result as { info?: GitInfo } | undefined)?.info ?? undefined)
    : buildFallbackPtyMetadata(ptyId).gitInfo;
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
    isWorktree: Boolean(info.isWorktree),
    commonDir: info.commonDir ?? null,
  };
}

/**
 * Gets Git diff statistics for a PTY's CWD.
 * @param ptyId - PTY identifier
 * @returns Diff stats or undefined
 */
export async function getGitDiffStats(
  ptyId: string
): Promise<{ added: number; removed: number; binary: number } | undefined> {
  const response = await sendRequest('getGitDiffStats', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get Git diff stats for PTY ${ptyId}:`, e);
    return null;
  });
  const diff = response
    ? ((
        response.header.result as
          | { diff?: { added: number; removed: number; binary: number } }
          | undefined
      )?.diff ?? undefined)
    : buildFallbackPtyMetadata(ptyId).gitDiffStats;
  if (!diff) return undefined;

  return {
    added: Number(diff.added ?? 0),
    removed: Number(diff.removed ?? 0),
    binary: Number(diff.binary ?? 0),
  };
}

/**
 * Gets the terminal title for a PTY.
 * @param ptyId - PTY identifier
 * @returns Terminal title
 */
export async function getTitle(ptyId: string): Promise<string> {
  const cached = defaultRegistry.getPtyState(ptyId)?.title;
  if (cached !== undefined && cached !== '') {
    return cached;
  }

  const response = await sendRequest('getTitle', { ptyId });
  const title = (response.header.result as { title?: string } | undefined)?.title ?? '';
  defaultRegistry.handlePtyTitle(ptyId, title);
  return title;
}

/**
 * Gets the last executed command for a PTY.
 * @param ptyId - PTY identifier
 * @returns Last command or undefined
 */
export async function getLastCommand(ptyId: string): Promise<string | undefined> {
  const response = await sendRequest('getLastCommand', { ptyId }).catch((e) => {
    console.warn(`[shim/client] Failed to get last command for PTY ${ptyId}:`, e);
    return null;
  });
  if (!response) {
    return buildFallbackPtyMetadata(ptyId).lastCommand;
  }

  const result = response.header.result as { command?: string } | undefined;
  return result?.command;
}

/**
 * Registers a pane-to-PTY mapping for session persistence.
 * @param sessionId - Session identifier
 * @param paneId - Pane identifier
 * @param ptyId - PTY identifier
 */
export async function registerPaneMapping(
  sessionId: string,
  paneId: string,
  ptyId: string
): Promise<void> {
  await sendRequest('registerPane', { sessionId, paneId, ptyId });
}

/**
 * Gets the pane-to-PTY mapping for a session.
 * @param sessionId - Session identifier
 * @returns Mapping of pane IDs to PTY IDs and stale pane list
 */
export async function getSessionMapping(sessionId: string): Promise<{
  mapping: Map<string, string>;
  stalePaneIds: string[];
}> {
  const response = await sendRequest('getSessionMapping', { sessionId });
  const result = response.header.result as
    | {
        entries?: Array<{ paneId: string; ptyId: string }>;
        stalePaneIds?: string[];
      }
    | undefined;
  const entries = result?.entries ?? [];
  return {
    mapping: new Map(entries.map((entry) => [entry.paneId, entry.ptyId])),
    stalePaneIds: result?.stalePaneIds ?? [],
  };
}

function createRemoteEmulator(ptyId: string): RemoteEmulator {
  return new RemoteEmulator(ptyId, {
    getPtyState: (id: string) => defaultRegistry.getPtyState(id),
    getKittyState: (id: string, alt?: boolean) => defaultRegistry.getKittyState(id, alt),
    fetchScrollbackLines: getScrollbackLines,
    searchPty,
  });
}

defaultRegistry.registerEmulatorFactory(createRemoteEmulator);

/** Convenience re-exports from the default PTY registry for namespace import consumers. */
export const getEmulator = (ptyId: string) => defaultRegistry.getEmulator(ptyId);
export const subscribeKittyTransmit = (cb: (event: { ptyId: string; sequence: string }) => void) =>
  defaultRegistry.subscribeKittyTransmit(cb);
export const subscribeKittyUpdate = (cb: (event: { ptyId: string }) => void) =>
  defaultRegistry.subscribeKittyUpdate(cb);
export const subscribeToActivity = (cb: (event: { ptyId: string }) => void) =>
  defaultRegistry.subscribeToActivity(cb);
export const subscribeExit = (ptyId: string, cb: (exitCode: number) => void) =>
  defaultRegistry.subscribeExit(ptyId, cb);
export const subscribeToAllTitles = (cb: (event: { ptyId: string; title: string }) => void) =>
  defaultRegistry.subscribeToAllTitles(cb);
export const subscribeToLifecycle = (
  cb: (event: { type: 'created' | 'destroyed'; ptyId: string }) => void
) => defaultRegistry.subscribeToLifecycle(cb);
export const subscribeToTitle = (ptyId: string, cb: (title: string) => void) =>
  defaultRegistry.subscribeToTitle(ptyId, cb);
export const subscribeUnified = (ptyId: string, cb: (update: UnifiedTerminalUpdate) => void) =>
  defaultRegistry.subscribeUnified(ptyId, cb);
export { onShimDetached, shutdownShim, waitForShim } from './client/connection';
