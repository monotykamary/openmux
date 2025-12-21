import type { TerminalCell, TerminalState, TerminalScrollState, DirtyTerminalUpdate, PackedRowUpdate } from '../../core/types';
import type { TerminalModes } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { createEmptyTerminalState, createEmptyDirtyUpdate } from './index';

export interface TerminalStateState {
  _cols: number;
  _rows: number;
  cachedState: TerminalState | null;
  cachedUpdate: DirtyTerminalUpdate | null;
  modes: TerminalModes;
  colors: TerminalColors;
  livePackedCache: Array<PackedRowUpdate | null>;
  scrollState: TerminalScrollState;
  pool: { setScrollState: (sessionId: string, state: TerminalScrollState) => void };
  sessionId: string;
  decodePackedRow: (entry: PackedRowUpdate, row?: TerminalCell[]) => TerminalCell[];
}

export function getDirtyUpdate(
  state: TerminalStateState,
  scrollState: TerminalScrollState
): DirtyTerminalUpdate {
  state.scrollState = scrollState;
  state.pool.setScrollState(state.sessionId, scrollState);

  if (state.cachedUpdate) {
    const mergedScrollState: TerminalScrollState = {
      ...scrollState,
      isAtScrollbackLimit: state.cachedUpdate.scrollState.isAtScrollbackLimit,
    };
    const update = {
      ...state.cachedUpdate,
      scrollState: mergedScrollState,
    };
    state.cachedUpdate = null;
    return update;
  }

  return createEmptyDirtyUpdate(
    state._cols,
    state._rows,
    scrollState,
    state.modes,
    state.cachedState?.cursor
  );
}

export function getTerminalState(state: TerminalStateState): TerminalState {
  const baseState = state.cachedState ?? createEmptyTerminalState(state._cols, state._rows, state.colors, state.modes);
  const rows = state._rows;
  const cols = state._cols;
  const cells: TerminalCell[][] = new Array(rows);

  for (let y = 0; y < rows; y++) {
    const packed = state.livePackedCache[y];
    if (packed && packed.cols === cols) {
      cells[y] = state.decodePackedRow(packed, baseState.cells[y]);
    } else {
      cells[y] = baseState.cells[y] ?? [];
    }
  }

  return {
    ...baseState,
    cols,
    rows,
    cells,
    cursor: state.cachedUpdate?.cursor ?? baseState.cursor,
    alternateScreen: state.modes.alternateScreen,
    mouseTracking: state.modes.mouseTracking,
    cursorKeyMode: state.modes.cursorKeyMode,
  };
}
