import type { TerminalCell, TerminalState, PackedRowUpdate } from '../../core/types';
import type { EmulatorWorkerPool } from '../worker-pool';
import type { ScrollbackCache } from './index';

export interface ScrollbackState {
  _rows: number;
  _cols: number;
  sessionId: string;
  pool: EmulatorWorkerPool;
  cachedState: TerminalState | null;
  scrollbackCache: ScrollbackCache<TerminalCell[]>;
  scrollbackPackedCache: ScrollbackCache<PackedRowUpdate>;
  livePackedCache: Array<PackedRowUpdate | null>;
  decodePackedRow: (entry: PackedRowUpdate, row?: TerminalCell[]) => TerminalCell[];
  acquireScrollbackRow: () => TerminalCell[];
  applyPackedRowsToScrollbackCache: (packedRows: PackedRowUpdate) => void;
}

export function getScrollbackLine(state: ScrollbackState, offset: number): TerminalCell[] | null {
  const cached = state.scrollbackCache.get(offset);
  if (cached) return cached;

  const packed = state.scrollbackPackedCache.get(offset);
  if (!packed) return null;

  const row = state.decodePackedRow(packed, state.acquireScrollbackRow());
  state.scrollbackCache.set(offset, row);
  return row;
}

export function getScrollbackLinePacked(state: ScrollbackState, offset: number): PackedRowUpdate | null {
  return state.scrollbackPackedCache.get(offset);
}

export function getLine(state: ScrollbackState, row: number): TerminalCell[] | null {
  if (row < 0 || row >= state._rows) return null;
  const packed = state.livePackedCache[row];
  if (packed && packed.cols === state._cols) {
    const reuse = state.cachedState?.cells[row];
    return state.decodePackedRow(packed, reuse);
  }
  return state.cachedState?.cells[row] ?? null;
}

export async function getScrollbackLineAsync(
  state: ScrollbackState,
  offset: number
): Promise<TerminalCell[] | null> {
  const cached = getScrollbackLine(state, offset);
  if (cached) return cached;

  const packed = await state.pool.getScrollbackLine(state.sessionId, offset);
  if (packed) {
    state.applyPackedRowsToScrollbackCache(packed);
    return getScrollbackLine(state, offset);
  }

  return null;
}

export async function prefetchScrollbackLines(
  state: ScrollbackState,
  startOffset: number,
  count: number
): Promise<void> {
  const packed = await state.pool.getScrollbackLines(state.sessionId, startOffset, count);
  if (!packed) return;
  state.applyPackedRowsToScrollbackCache(packed);
}
