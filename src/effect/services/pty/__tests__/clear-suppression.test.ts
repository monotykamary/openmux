/**
 * Tests for clear sequence suppression in PTY data handler.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { InternalPtySession } from '../types';
import type { ITerminalEmulator } from '../../../../terminal/emulator-interface';
import { createSyncModeParser } from '../../../../terminal/sync-mode-parser';
import {
  createDataHandler,
  normalizePiFullRedrawSegment,
  suppressClearScreenSequences,
} from '../data-handler';

function createMockSession() {
  const emulatorWrites: string[] = [];
  const ptyWrites: string[] = [];
  let scrollbackArchiveResetCount = 0;
  let scrollbackArchiverResetCount = 0;
  let scrollbackScheduleCount = 0;

  const emulator = {
    cols: 80,
    rows: 24,
    isDisposed: false,
    write(data: string | Uint8Array) {
      emulatorWrites.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    },
    resize() {},
    reset() {},
    dispose() {},
    getScrollbackLength() {
      return 0;
    },
    getScrollbackLine() {
      return null;
    },
    getDirtyUpdate() {
      return {} as never;
    },
    getTerminalState() {
      return {} as never;
    },
    getCursor() {
      return { x: 0, y: 0, visible: true };
    },
    getCursorKeyMode() {
      return 'normal' as const;
    },
    getKittyKeyboardFlags() {
      return 0;
    },
    isMouseTrackingEnabled() {
      return false;
    },
    isAlternateScreen() {
      return false;
    },
    getMode() {
      return false;
    },
    getColors() {
      return { foreground: 0, background: 0 } as never;
    },
    getTitle() {
      return '';
    },
    onTitleChange() {
      return () => {};
    },
    onUpdate() {
      return () => {};
    },
    onModeChange() {
      return () => {};
    },
    drainResponses() {
      return [];
    },
    search() {
      return Promise.resolve([] as never);
    },
  } satisfies Partial<ITerminalEmulator> as ITerminalEmulator;

  const session = {
    id: 'test-pty',
    pty: {
      write(data: string) {
        ptyWrites.push(data);
      },
      getForegroundProcessName() {
        return null;
      },
    },
    emulator,
    liveEmulator: emulator,
    scrollbackArchive: {
      reset() {
        scrollbackArchiveResetCount += 1;
      },
    },
    scrollbackArchiver: {
      reset() {
        scrollbackArchiverResetCount += 1;
      },
      schedule() {
        scrollbackScheduleCount += 1;
      },
    },
    queryPassthrough: {
      process(data: string) {
        return data;
      },
    },
    cols: 80,
    rows: 24,
    pixelWidth: 800,
    pixelHeight: 600,
    cellWidth: 10,
    cellHeight: 25,
    cwd: '/tmp',
    shell: 'bash',
    closing: false,
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    lastCommand: null,
    focusTrackingEnabled: false,
    focusState: false,
    focusTrackingOwnerProcess: null,
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 0,
      lastIsAtBottom: true,
    },
    lastResizeTime: 0,
  } as unknown as InternalPtySession;

  return {
    session,
    emulatorWrites,
    ptyWrites,
    getScrollbackArchiveResetCount: () => scrollbackArchiveResetCount,
    getScrollbackArchiverResetCount: () => scrollbackArchiverResetCount,
    getScrollbackScheduleCount: () => scrollbackScheduleCount,
  };
}

async function waitForDrain() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushFakeTimers() {
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizePiFullRedrawSegment', () => {
  it('rewrites pi full redraws to cursor-home replacement (no scrollback push)', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[Hhello');
  });

  it('preserves tall pi full redraw frames without scrollback duplication', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4';
    expect(normalizePiFullRedrawSegment(input, 2)).toBe(
      '\x1b[Hline 1\r\nline 2\r\nline 3\r\nline 4'
    );
  });

  it('supports 1;1H and C1 variants', () => {
    const input = '\x9b2J\x9b1;1H\x9b3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[Hhello');
  });

  it('only rewrites the destructive prefix at the start of the segment', () => {
    const input = 'prefix\x1b[2J\x1b[H\x1b[3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe(input);
  });

  it('preserves non-pi clear sequences', () => {
    const input = '\x1b[2J\x1b[Hhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe(input);
  });
});

describe('suppressClearScreenSequences', () => {
  it('removes CSI 2 J', () => {
    const input = 'hello\x1b[2Jworld';
    expect(suppressClearScreenSequences(input)).toBe('helloworld');
  });

  it('removes C1 CSI 2 J', () => {
    const input = 'a\x9b2Jb';
    expect(suppressClearScreenSequences(input)).toBe('ab');
  });

  it('preserves other sequences', () => {
    const input = '\x1b[31mred\x1b[0m\x1b[2J';
    expect(suppressClearScreenSequences(input)).toBe('\x1b[31mred\x1b[0m');
  });

  it('handles empty string', () => {
    expect(suppressClearScreenSequences('')).toBe('');
  });
});

describe('createDataHandler pi redraw integration', () => {
  it('normalizes pi full redraws to cursor-home replacement after sync parsing', async () => {
    const {
      session,
      emulatorWrites,
      getScrollbackArchiveResetCount,
      getScrollbackArchiverResetCount,
    } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[Hhello']);
    expect(getScrollbackArchiveResetCount()).toBe(0);
    expect(getScrollbackArchiverResetCount()).toBe(0);
  });

  it('still schedules scrollback archiving for the normalized redraw', async () => {
    const { session, getScrollbackScheduleCount } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(getScrollbackScheduleCount()).toBe(1);
  });

  it('preserves tall full redraw frames without scrollback duplication', async () => {
    const { session, emulatorWrites } = createMockSession();
    session.rows = 2;
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[Hline 1\r\nline 2\r\nline 3\r\nline 4']);
  });

  it('leaves normal synchronized output untouched', async () => {
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
    });

    handleData('\x1b[?2026hplain output\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['plain output']);
  });

  it('resets the sync timeout while a large synchronized frame is still streaming', async () => {
    vi.useFakeTimers();
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 100,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello');
    vi.advanceTimersByTime(50);
    handleData(' world');
    vi.advanceTimersByTime(60);
    await Promise.resolve();

    expect(emulatorWrites).toEqual([]);

    handleData('\x1b[?2026l');
    await flushFakeTimers();

    expect(emulatorWrites).toEqual(['\x1b[Hhello world']);
  });

  it('gives pi full redraw sync frames a longer idle timeout before force-flushing', async () => {
    vi.useFakeTimers();
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 100,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello');
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(emulatorWrites).toEqual([]);

    vi.advanceTimersByTime(550);
    await flushFakeTimers();

    expect(emulatorWrites).toEqual(['\x1b[Hhello']);
  });
});
