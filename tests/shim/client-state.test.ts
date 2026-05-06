import { beforeEach, describe, expect, test } from 'bun:test';
import type { TerminalCell, TerminalState, UnifiedTerminalUpdate } from '../../src/core/types';
import { defaultRegistry, resetAllPtyState } from '../../src/shim/client/state';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
} from '../../src/terminal/emulator-interface';

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
  beforeEach(() => {
    resetAllPtyState();
  });

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
    const unsubUnified = defaultRegistry.subscribeUnified(ptyId, () => {
      unifiedCount += 1;
    });
    const unsubState = defaultRegistry.subscribeState(ptyId, () => {
      stateCount += 1;
    });
    const unsubScroll = defaultRegistry.subscribeScroll(ptyId, () => {
      scrollCount += 1;
    });

    defaultRegistry.handleUnifiedUpdate(ptyId, update);

    expect(unifiedCount).toBe(1);
    expect(stateCount).toBe(1);
    expect(scrollCount).toBe(1);
    expect(defaultRegistry.getPtyState(ptyId)?.terminalState?.cells[0]?.[0]?.char).toBe('x');

    unsubUnified();
    unsubState();
    unsubScroll();
    defaultRegistry.deletePtyState(ptyId);
  });

  test('applies dirty rows to cached state', () => {
    const ptyId = 'pty-dirty';
    const initialState = makeState('a');
    defaultRegistry.setPtyState(ptyId, {
      terminalState: initialState,
      cachedRows: [...initialState.cells],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: 'init',
    });

    const dirtyRow = [
      { ...baseCell, char: 'z' },
      { ...baseCell, char: 'y' },
    ];
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

    defaultRegistry.handleUnifiedUpdate(ptyId, update);
    const state = defaultRegistry.getPtyState(ptyId);
    expect(state?.terminalState?.cells[0]?.[0]?.char).toBe('z');
    expect(state?.title).toBe('init');

    defaultRegistry.deletePtyState(ptyId);
  });

  test('updates title and notifies title subscribers', () => {
    const ptyId = 'pty-title';
    let titleCount = 0;
    let globalCount = 0;
    const unsubTitle = defaultRegistry.subscribeToTitle(ptyId, () => {
      titleCount += 1;
    });
    const unsubGlobal = defaultRegistry.subscribeToAllTitles(() => {
      globalCount += 1;
    });

    defaultRegistry.handlePtyTitle(ptyId, 'hello');

    expect(titleCount).toBe(1);
    expect(globalCount).toBe(1);
    expect(defaultRegistry.getPtyState(ptyId)?.title).toBe('hello');

    unsubTitle();
    unsubGlobal();
    defaultRegistry.deletePtyState(ptyId);
  });

  test('notifies global activity subscribers', () => {
    const ptyId = 'pty-activity';
    let activityCount = 0;
    const unsubscribe = defaultRegistry.subscribeToActivity((event) => {
      expect(event.ptyId).toBe(ptyId);
      activityCount += 1;
    });

    defaultRegistry.handlePtyActivity(ptyId);

    expect(activityCount).toBe(1);

    unsubscribe();
  });

  test('lifecycle destroy removes cached state', () => {
    const ptyId = 'pty-life';
    defaultRegistry.setPtyState(ptyId, {
      terminalState: makeState('b'),
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: '',
    });

    let eventType: 'created' | 'destroyed' | null = null;
    const unsub = defaultRegistry.subscribeToLifecycle((event) => {
      eventType = event.type;
    });

    defaultRegistry.handlePtyLifecycle(ptyId, 'destroyed');

    expect(eventType).toBe('destroyed');
    expect(defaultRegistry.getPtyState(ptyId)).toBeUndefined();

    unsub();
  });

  test('propagates scrollback changes to cached emulator', () => {
    const ptyId = 'pty-emulator';
    let lastScrollback: number | null = null;
    let lastLimit: boolean | null = null;
    defaultRegistry.registerEmulatorFactory(
      () =>
        ({
          handleScrollbackChange: (newLength: number, isAtLimit: boolean) => {
            lastScrollback = newLength;
            lastLimit = isAtLimit;
          },
        }) as any
    );

    defaultRegistry.getEmulator(ptyId);

    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: {
          viewportOffset: 0,
          scrollbackLength: 3,
          isAtBottom: true,
          isAtScrollbackLimit: true,
        },
        cols: 2,
        rows: 1,
        isFull: true,
        fullState: makeState('c'),
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 3,
        isAtBottom: true,
        isAtScrollbackLimit: true,
      },
    };

    defaultRegistry.handleUnifiedUpdate(ptyId, update);

    expect(lastScrollback).toBe(3);
    expect(lastLimit).toBe(true);

    defaultRegistry.deletePtyState(ptyId);
  });

  test('stores kitty graphics updates and retains image data', () => {
    const ptyId = 'pty-kitty';
    const info = {
      id: 1,
      number: 0,
      width: 2,
      height: 2,
      dataLength: 12,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 100n,
    };
    const placement = {
      imageId: 1,
      placementId: 9,
      placementTag: KittyGraphicsPlacementTag.INTERNAL,
      screenX: 0,
      screenY: 0,
      xOffset: 0,
      yOffset: 0,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 0,
      sourceHeight: 0,
      columns: 1,
      rows: 1,
      z: 0,
    };
    const data = new Uint8Array([1, 2, 3]);

    defaultRegistry.handlePtyKittyUpdate(ptyId, {
      images: [info],
      placements: [placement],
      removedImageIds: [],
      imageData: new Map([[info.id, data]]),
    });

    const state = defaultRegistry.getKittyState(ptyId);
    expect(state?.dirty).toBe(true);
    expect(state?.seedImageIds.has(info.id)).toBe(true);
    expect(state?.images.get(info.id)?.data).toEqual(data);
    expect(state?.placements).toHaveLength(1);

    defaultRegistry.handlePtyKittyUpdate(ptyId, {
      images: [info],
      placements: [],
      removedImageIds: [],
      imageData: new Map(),
    });

    const next = defaultRegistry.getKittyState(ptyId);
    expect(next?.images.get(info.id)?.data).toEqual(data);
    expect(next?.seedImageIds.has(info.id)).toBe(false);

    defaultRegistry.handlePtyKittyUpdate(ptyId, {
      images: [],
      placements: [],
      removedImageIds: [info.id],
      imageData: new Map(),
    });

    const finalState = defaultRegistry.getKittyState(ptyId);
    expect(finalState?.images.size).toBe(0);

    defaultRegistry.deletePtyState(ptyId);
  });

  test('buffers kitty transmit events received before subscription', () => {
    const events: Array<{ ptyId: string; sequence: string }> = [];

    defaultRegistry.handlePtyKittyTransmit('pty-buffer', 'first-seq');
    defaultRegistry.handlePtyKittyTransmit('pty-buffer', 'second-seq');

    const unsubscribe = defaultRegistry.subscribeKittyTransmit((event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { ptyId: 'pty-buffer', sequence: 'first-seq' },
      { ptyId: 'pty-buffer', sequence: 'second-seq' },
    ]);

    defaultRegistry.handlePtyKittyTransmit('pty-buffer', 'live-seq');
    expect(events[2]).toEqual({ ptyId: 'pty-buffer', sequence: 'live-seq' });

    unsubscribe();
    defaultRegistry.deletePtyState('pty-buffer');
  });
});
