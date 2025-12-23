import { describe, expect, test } from 'vitest';
import type { TerminalCell, TerminalState, UnifiedTerminalUpdate } from '../../src/core/types';
import {
  deletePtyState,
  getEmulator,
  getPtyState,
  handlePtyLifecycle,
  handlePtyTitle,
  handleUnifiedUpdate,
  registerEmulatorFactory,
  setPtyState,
  subscribeScroll,
  subscribeState,
  subscribeToAllTitles,
  subscribeToLifecycle,
  subscribeToTitle,
  subscribeUnified,
} from '../../src/shim/client/state';

const baseCell: TerminalCell = {
  char: 'a',
  fg: { r: 0, g: 0, b: 0 },
  bg: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  blink: false,
  dim: false,
  width: 1,
};

function makeState(char: string): TerminalState {
  const cell = { ...baseCell, char };
  return {
    cols: 2,
    rows: 1,
    cells: [[cell, cell]],
    cursor: { x: 0, y: 0, visible: true },
    alternateScreen: false,
    mouseTracking: false,
  };
}

describe('shim client state', () => {
  test('applies full updates and notifies subscribers', () => {
    const ptyId = 'pty-full';
    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 1, y: 0, visible: true },
        scrollState: { viewportOffset: 0, scrollbackLength: 2, isAtBottom: true },
        cols: 2,
        rows: 1,
        isFull: true,
        fullState: makeState('x'),
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: { viewportOffset: 0, scrollbackLength: 2, isAtBottom: true },
    };

    let unifiedCount = 0;
    let stateCount = 0;
    let scrollCount = 0;
    const unsubUnified = subscribeUnified(ptyId, () => {
      unifiedCount += 1;
    });
    const unsubState = subscribeState(ptyId, () => {
      stateCount += 1;
    });
    const unsubScroll = subscribeScroll(ptyId, () => {
      scrollCount += 1;
    });

    handleUnifiedUpdate(ptyId, update);

    expect(unifiedCount).toBe(1);
    expect(stateCount).toBe(1);
    expect(scrollCount).toBe(1);
    expect(getPtyState(ptyId)?.terminalState?.cells[0]?.[0]?.char).toBe('x');

    unsubUnified();
    unsubState();
    unsubScroll();
    deletePtyState(ptyId);
  });

  test('applies dirty rows to cached state', () => {
    const ptyId = 'pty-dirty';
    const initialState = makeState('a');
    setPtyState(ptyId, {
      terminalState: initialState,
      cachedRows: [...initialState.cells],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: 'init',
    });

    const dirtyRow = [{ ...baseCell, char: 'z' }, { ...baseCell, char: 'y' }];
    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map([[0, dirtyRow]]),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: { viewportOffset: 0, scrollbackLength: 1, isAtBottom: true },
        cols: 2,
        rows: 1,
        isFull: false,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: { viewportOffset: 0, scrollbackLength: 1, isAtBottom: true },
    };

    handleUnifiedUpdate(ptyId, update);
    const state = getPtyState(ptyId);
    expect(state?.terminalState?.cells[0]?.[0]?.char).toBe('z');
    expect(state?.title).toBe('init');

    deletePtyState(ptyId);
  });

  test('updates title and notifies title subscribers', () => {
    const ptyId = 'pty-title';
    let titleCount = 0;
    let globalCount = 0;
    const unsubTitle = subscribeToTitle(ptyId, () => {
      titleCount += 1;
    });
    const unsubGlobal = subscribeToAllTitles(() => {
      globalCount += 1;
    });

    handlePtyTitle(ptyId, 'hello');

    expect(titleCount).toBe(1);
    expect(globalCount).toBe(1);
    expect(getPtyState(ptyId)?.title).toBe('hello');

    unsubTitle();
    unsubGlobal();
    deletePtyState(ptyId);
  });

  test('lifecycle destroy removes cached state', () => {
    const ptyId = 'pty-life';
    setPtyState(ptyId, {
      terminalState: makeState('b'),
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: '',
    });

    let eventType: 'created' | 'destroyed' | null = null;
    const unsub = subscribeToLifecycle((event) => {
      eventType = event.type;
    });

    handlePtyLifecycle(ptyId, 'destroyed');

    expect(eventType).toBe('destroyed');
    expect(getPtyState(ptyId)).toBeUndefined();

    unsub();
  });

  test('propagates scrollback changes to cached emulator', () => {
    const ptyId = 'pty-emulator';
    let lastScrollback: number | null = null;
    let lastLimit: boolean | null = null;
    registerEmulatorFactory(() => ({
      handleScrollbackChange: (newLength: number, isAtLimit: boolean) => {
        lastScrollback = newLength;
        lastLimit = isAtLimit;
      },
    }) as any);

    getEmulator(ptyId);

    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: { viewportOffset: 0, scrollbackLength: 3, isAtBottom: true, isAtScrollbackLimit: true },
        cols: 2,
        rows: 1,
        isFull: true,
        fullState: makeState('c'),
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: { viewportOffset: 0, scrollbackLength: 3, isAtBottom: true, isAtScrollbackLimit: true },
    };

    handleUnifiedUpdate(ptyId, update);

    expect(lastScrollback).toBe(3);
    expect(lastLimit).toBe(true);

    deletePtyState(ptyId);
  });
});
