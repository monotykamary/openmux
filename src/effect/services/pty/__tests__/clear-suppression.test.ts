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
  // Yield through macrotask cycles to allow setImmediate callbacks to drain.
  // The data handler uses setImmediate for focused PTY scheduling, and
  // vi.useFakeTimers() does not mock setImmediate in Bun's test runner.
  for (let cycle = 0; cycle < 50; cycle++) {
    await new Promise<void>((r) => setImmediate(r));
  }
  vi.runAllTimers();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizePiFullRedrawSegment', () => {
  it('replaces CSI 2J + CSI 3J with CSI H + CSI J + CSI 3J (non-scrolling clear + scrollback reset)', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[J\x1b[3Jhello');
  });

  it('preserves tall pi full redraw frames after non-scrolling clear + scrollback reset', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4';
    expect(normalizePiFullRedrawSegment(input, 2)).toBe(
      '\x1b[H\x1b[J\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4'
    );
  });

  it('supports 1;1H and C1 variants', () => {
    const input = '\x9b2J\x9b1;1H\x9b3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[J\x1b[3Jhello');
  });

  it('normalizes CSI 2J after Kitty image delete prefix', () => {
    const input = '\x1b_Ga=d,d=A,q=2\x1b\\\x1b[2J\x1b[H\x1b[3Jhello';
    const normalized = normalizePiFullRedrawSegment(input, 10);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.startsWith('\x1b_Ga=d,d=A,q=2\x1b\\')).toBe(true);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes CSI 2J + CSI H without CSI 3J', () => {
    const input = '\x1b[2J\x1b[Hhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[J\x1b[3Jhello');
  });

  it('normalizes CSI 2J + CSI 1;1H without CSI 3J', () => {
    const input = '\x1b[2J\x1b[1;1Hhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[J\x1b[3Jhello');
  });

  it('normalizes C1 CSI 2J + CSI H without CSI 3J', () => {
    const input = '\x9b2J\x9bHhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[J\x1b[3Jhello');
  });

  it('returns input unchanged for non-clear segments', () => {
    const input = 'just some text\x1b[0m';
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
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[J\x1b[3Jhello']);
    // CSI 3J in the normalized output triggers a scrollback archive reset,
    // which is correct — the archive must be discarded when scrollback is cleared.
    expect(getScrollbackArchiveResetCount()).toBe(1);
    expect(getScrollbackArchiverResetCount()).toBe(1);
  });

  it('still schedules scrollback archiving for the normalized redraw', async () => {
    const { session, getScrollbackScheduleCount } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
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
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[J\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4']);
  });

  it('leaves normal synchronized output untouched', async () => {
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
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
      getPriority: () => 'focused' as const,
      syncTimeoutMs: 100,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello');
    // Flush setImmediate drain
    await new Promise<void>((r) => setImmediate(r));
    handleData(' world');
    // Flush setImmediate drain
    await new Promise<void>((r) => setImmediate(r));
    // 0ms total on fake timers — sync timeout (100ms) has not fired
    expect(emulatorWrites).toEqual([]);

    handleData('\x1b[?2026l');
    // Flush setImmediate drain and microtasks
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => setImmediate(r));
    }

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[J\x1b[3Jhello world']);
  });
});
