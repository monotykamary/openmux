import { beforeEach, describe, expect, it } from 'bun:test';

// Import the real module using a query parameter to bypass any mocks
const stateModule = await import('./state?real');

const { defaultRegistry, resetAllPtyState } = stateModule;

describe('shim/client/state', () => {
  beforeEach(() => {
    resetAllPtyState();
  });

  it('replays the cached full terminal snapshot to unified subscribers', () => {
    const ptyId = 'pty-unified-test';
    const updates: Array<{ cols: number; rows: number; title: string }> = [];

    defaultRegistry.setPtyState(ptyId, {
      terminalState: {
        cols: 80,
        rows: 24,
        cells: [],
        cursor: { x: 0, y: 0, visible: true },
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
      },
      cachedRows: [],
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 12,
        isAtBottom: true,
      },
      title: 'shell',
    });

    const unsubscribe = defaultRegistry.subscribeUnified(ptyId, (update) => {
      updates.push({
        cols: update.terminalUpdate.cols,
        rows: update.terminalUpdate.rows,
        title: 'shell',
      });
    });

    unsubscribe();
    defaultRegistry.deletePtyState(ptyId);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ cols: 80, rows: 24, title: 'shell' });
  });

  it('marks cached metadata stale on activity but preserves title updates', () => {
    const ptyId = 'pty-metadata-test';

    defaultRegistry.setCachedPtyMetadata(ptyId, {
      session: null,
      cwd: '/tmp',
      title: 'before',
    });

    defaultRegistry.handlePtyTitle(ptyId, 'after');
    defaultRegistry.handlePtyActivity(ptyId);

    expect(defaultRegistry.getCachedPtyMetadata(ptyId)).toEqual({
      value: {
        session: null,
        cwd: '/tmp',
        title: 'after',
      },
      fetchedAt: expect.any(Number),
      stale: true,
    });

    defaultRegistry.deletePtyState(ptyId);
  });

  it('buffers kitty transmits until a subscriber attaches', () => {
    const ptyId = 'pty-kitty-test';
    const events: string[] = [];

    defaultRegistry.handlePtyKittyTransmit(ptyId, 'seq-1');
    const unsubscribe = defaultRegistry.subscribeKittyTransmit((event) => {
      if (event.ptyId === ptyId) {
        events.push(event.sequence);
      }
    });

    unsubscribe();
    defaultRegistry.deletePtyState(ptyId);

    expect(events).toEqual(['seq-1']);
  });
});
