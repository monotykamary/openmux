import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fsActual from 'node:fs';

import * as capabilitiesActual from '../../../src/terminal/capabilities';
import * as hostColorSchemeActual from '../../../src/terminal/host-color-scheme';
import * as terminalColorsActual from '../../../src/terminal/terminal-colors';
import type { TerminalColors } from '../../../src/terminal/terminal-colors';
import { effectBridgeMocks } from '../../mocks/effect-bridge';

let createHostColorSync: typeof import('../../../src/contexts/terminal/host-color-sync').createHostColorSync;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

// Module-level refs for mock coordination (replaces vi.hoisted pattern)
const schemeListenerRef: { current: ((scheme: 'light' | 'dark') => void) | null } = {
  current: null,
};
const appearanceTriggerRef: { current: (() => void) | null } = { current: null };
const watchCallbackRef: { current: ((event: string, filename?: string) => void) | null } = {
  current: null,
};
const watchClose = vi.fn();
const areTerminalColorsEqual = vi.fn();
const getHostColors = vi.fn();
const refreshHostColorsCache = vi.fn();
const setHostColors = vi.fn();
const setHostCapabilitiesColors = vi.fn();
const applyHostColors = effectBridgeMocks.applyHostColors;

vi.mock('node:fs', () => {
  const watch = (
    path: string,
    options: unknown,
    cb: (event: string, filename?: string) => void
  ) => {
    watchCallbackRef.current = cb;
    return { close: watchClose };
  };
  return {
    ...fsActual,
    default: { ...fsActual, watch },
    watch,
  };
});

vi.mock('../../../src/terminal/terminal-colors', () => ({
  ...terminalColorsActual,
  areTerminalColorsEqual,
  getHostColors,
  refreshHostColors: refreshHostColorsCache,
  setHostColors,
}));

vi.mock('../../../src/terminal/host-color-scheme', () => ({
  ...hostColorSchemeActual,
  onHostColorScheme: (listener: (scheme: 'light' | 'dark') => void) => {
    schemeListenerRef.current = listener;
    return vi.fn();
  },
}));

vi.mock('../../../src/terminal/capabilities', () => ({
  ...capabilitiesActual,
  setHostCapabilitiesColors,
}));

vi.mock('../../../native/zig-pty/ts/index', () => ({
  spawnAsync: vi.fn(),
  watchSystemAppearance: (cb: () => void) => {
    appearanceTriggerRef.current = cb;
    return vi.fn();
  },
}));

vi.mock('../../../src/effect/bridge', () => ({
  ...effectBridgeMocks,
}));

const makeColors = (foreground: number, background: number, isDefault = false): TerminalColors => ({
  foreground,
  background,
  palette: Array.from({ length: 16 }, (_, idx) => (foreground + idx) & 0xffffff),
  isDefault,
});

describe('createHostColorSync', () => {
  const renderer = { requestRender: vi.fn() };
  const bumpHostColorsVersion = vi.fn();
  const isActive = () => true;
  const originalHome = process.env.HOME;

  beforeAll(async () => {
    ({ createHostColorSync } = await import('../../../src/contexts/terminal/host-color-sync'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
    }
    process.env.HOME = '/tmp';
    areTerminalColorsEqual.mockReturnValue(false);
    applyHostColors.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    vi.useRealTimers();
  });

  it('refreshes host colors and applies updates', async () => {
    const previous = makeColors(0x111111, 0x222222);
    const next = makeColors(0xaaaaaa, 0xbbbbbb);
    getHostColors.mockReturnValue(previous);
    refreshHostColorsCache.mockResolvedValue(next);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    const didChange = await sync.refreshHostColors({ timeoutMs: 123, oscMode: 'fast' });

    expect(didChange).toBe(true);
    expect(refreshHostColorsCache).toHaveBeenCalledWith({ timeoutMs: 123, oscMode: 'fast' });
    expect(setHostCapabilitiesColors).toHaveBeenCalledWith(next);
    expect(bumpHostColorsVersion).toHaveBeenCalled();
    expect(renderer.requestRender).toHaveBeenCalled();
    expect(applyHostColors).toHaveBeenCalledWith(next);
  });

  it('applies cached scheme colors before refresh', async () => {
    const dark = makeColors(0x101010, 0x202020);
    const light = makeColors(0xf0f0f0, 0xffffff);
    getHostColors.mockReturnValueOnce(dark).mockReturnValueOnce(light);
    refreshHostColorsCache.mockResolvedValue(light);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    sync.start();
    expect(schemeListenerRef.current).not.toBeNull();

    schemeListenerRef.current?.('light');
    await new Promise((resolve) => setImmediate(resolve));

    setHostColors.mockClear();
    setHostCapabilitiesColors.mockClear();
    applyHostColors.mockClear();
    applyHostColors.mockResolvedValue(undefined);

    schemeListenerRef.current?.('dark');
    await new Promise((resolve) => setImmediate(resolve));

    expect(setHostColors).toHaveBeenCalledWith(dark);
    expect(setHostCapabilitiesColors).toHaveBeenCalledWith(dark);
    expect(renderer.requestRender).toHaveBeenCalled();
    expect(applyHostColors).toHaveBeenCalledWith(dark);
  });

  it('polls fast then schedules full refresh on appearance change', async () => {
    const next = makeColors(0x333333, 0x444444);
    refreshHostColorsCache.mockResolvedValue(next);

    const sync = createHostColorSync({
      renderer,
      isActive,
      bumpHostColorsVersion,
    });

    sync.start();
    expect(appearanceTriggerRef.current).not.toBeNull();

    appearanceTriggerRef.current?.();

    // Poll until both refresh calls are observed or timeout (avoids flaky fixed-delay on slow CI)
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && refreshHostColorsCache.mock.calls.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(refreshHostColorsCache).toHaveBeenCalledTimes(2);
    expect(refreshHostColorsCache).toHaveBeenNthCalledWith(1, { timeoutMs: 200, oscMode: 'fast' });
    expect(refreshHostColorsCache).toHaveBeenNthCalledWith(2, { timeoutMs: 500, oscMode: 'full' });
  });
});
