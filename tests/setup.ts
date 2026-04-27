/**
 * Test setup - global mocks for safety and vi polyfills
 */
import { mock, vi } from 'bun:test';
import * as solidJsxRuntime from 'solid-js/h/jsx-runtime';
import { effectBridgeMocks } from './mocks/effect-bridge';
import { mockGhostty } from './mocks/ghostty-ffi';

// Polyfill vi methods for Bun compatibility
type ViCompat = typeof vi & {
  advanceTimersByTimeAsync?: (ms: number) => Promise<void>;
  runAllTimersAsync?: () => Promise<void>;
  mocked?: <T>(value: T) => T;
  hoisted?: <T>(factory: () => T) => T;
};

const viCompat = vi as ViCompat;

type FakeTimer = {
  callback: (...args: unknown[]) => void;
  args: unknown[];
  time: number;
  intervalMs?: number;
};

const realTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  dateNow: Date.now.bind(Date),
};

let fakeTimersActive = false;
let fakeNow = realTimers.dateNow();
let nextFakeTimerId = 1;
const fakeTimers = new Map<number, FakeTimer>();

// Bun exposes part of Vitest's `vi` API. These tests need a small fake-time scheduler.
function normalizeDelay(delay: unknown): number {
  const value = typeof delay === 'number' ? delay : Number(delay ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function invokeTimer(timer: FakeTimer): void {
  timer.callback(...timer.args);
}

function installFakeTimers(now?: number | Date): void {
  fakeTimersActive = true;
  fakeNow =
    now instanceof Date ? now.getTime() : typeof now === 'number' ? now : realTimers.dateNow();
  fakeTimers.clear();

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = nextFakeTimerId++;
    fakeTimers.set(id, {
      callback:
        typeof callback === 'function' ? (callback as (...args: unknown[]) => void) : () => {},
      args,
      time: fakeNow + normalizeDelay(delay),
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    fakeTimers.delete(timer as unknown as number);
  }) as typeof clearTimeout;

  globalThis.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const intervalMs = normalizeDelay(delay);
    const id = nextFakeTimerId++;
    fakeTimers.set(id, {
      callback:
        typeof callback === 'function' ? (callback as (...args: unknown[]) => void) : () => {},
      args,
      time: fakeNow + intervalMs,
      intervalMs,
    });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  globalThis.clearInterval = ((timer?: ReturnType<typeof setInterval>) => {
    fakeTimers.delete(timer as unknown as number);
  }) as typeof clearInterval;

  Date.now = () => fakeNow;
}

function restoreRealTimers(): void {
  fakeTimersActive = false;
  fakeTimers.clear();
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  globalThis.setInterval = realTimers.setInterval;
  globalThis.clearInterval = realTimers.clearInterval;
  Date.now = realTimers.dateNow;
}

function runTimer(id: number): void {
  const timer = fakeTimers.get(id);
  if (!timer) return;

  if (timer.intervalMs === undefined) {
    fakeTimers.delete(id);
  } else {
    timer.time += timer.intervalMs;
  }

  invokeTimer(timer);
}

function nextDueTimer(targetTime: number): [number, FakeTimer] | undefined {
  let next: [number, FakeTimer] | undefined;
  for (const entry of fakeTimers.entries()) {
    const [, timer] = entry;
    if (timer.time > targetTime) continue;
    if (!next || timer.time < next[1].time) {
      next = entry;
    }
  }
  return next;
}

viCompat.useFakeTimers = ((options?: { now?: number | Date }) => {
  installFakeTimers(options?.now);
  return viCompat;
}) as typeof vi.useFakeTimers;

viCompat.useRealTimers = (() => {
  restoreRealTimers();
  return viCompat;
}) as typeof vi.useRealTimers;

viCompat.advanceTimersByTime = (ms: number) => {
  if (!fakeTimersActive) return;
  const targetTime = fakeNow + Math.max(0, ms);
  let guard = 100_000;

  while (guard > 0) {
    const next = nextDueTimer(targetTime);
    if (!next) break;
    fakeNow = next[1].time;
    runTimer(next[0]);
    guard -= 1;
  }

  fakeNow = targetTime;
};

viCompat.runOnlyPendingTimers = () => {
  if (!fakeTimersActive) return;
  const pending = Array.from(fakeTimers.entries()).sort((a, b) => a[1].time - b[1].time);
  for (const [id, timer] of pending) {
    if (!fakeTimers.has(id)) continue;
    fakeNow = Math.max(fakeNow, timer.time);
    runTimer(id);
  }
};

viCompat.runAllTimers = () => {
  if (!fakeTimersActive) return;
  let guard = 100_000;
  while (fakeTimers.size > 0 && guard > 0) {
    viCompat.runOnlyPendingTimers?.();
    guard -= 1;
  }
};

viCompat.getTimerCount = () => fakeTimers.size;

if (!viCompat.mocked) {
  viCompat.mocked = (value) => value;
}

if (!viCompat.hoisted) {
  viCompat.hoisted = (factory) => factory();
}

if (!viCompat.advanceTimersByTimeAsync) {
  viCompat.advanceTimersByTimeAsync = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  };
}

if (!viCompat.runAllTimersAsync) {
  viCompat.runAllTimersAsync = async () => {
    let guard = 25;
    let idleCycles = 0;
    while (guard > 0 && idleCycles < 5) {
      const pending = vi.getTimerCount();
      if (pending > 0) {
        vi.runOnlyPendingTimers();
        await Promise.resolve();
        idleCycles = 0;
      } else {
        await Promise.resolve();
        idleCycles += 1;
      }
      guard -= 1;
    }
  };
}

// Mock JSX runtime for SolidJS
mock.module('@opentui/solid/jsx-runtime', () => solidJsxRuntime);
mock.module('@opentui/solid/jsx-dev-runtime', () => solidJsxRuntime);

// Mock effect bridge for isolation
mock.module('../src/effect/bridge', () => effectBridgeMocks);

// Mock ghostty FFI to prevent native calls in tests
mock.module('../src/terminal/ghostty-vt/ffi', () => ({ ghostty: mockGhostty }));

// Mock shim-bridge to prevent accidental shim client connections
mock.module('../src/effect/bridge/shim-bridge', () => ({
  registerPtyPane: async () => {},
  getSessionPtyMapping: async () => undefined,
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  waitForShimClient: async () => {},
}));

// Mock shim/client/connection to prevent any real socket connections during tests
// This is critical - without this, tests could connect to the real shim socket and detach the user
mock.module('../src/shim/client/connection', () => ({
  sendRequest: async () => ({ header: { ok: true, result: {} }, payloads: [] }),
  sendRequestDirect: async () => ({ header: { ok: true, result: {} }, payloads: [] }),
  onShimDetached: () => () => {},
  shutdownShim: async () => {},
  waitForShim: async () => {},
  // handlePtyNotification is a pure function - we implement it properly for tests that need it
  handlePtyNotification: (params: any, deps: any) => {
    const { notification, subtitle, ptyId, hostFocused, focusedPtyId, allowFocusedPaneOsc } =
      params;
    const isUnfocusedPane = Boolean(ptyId && focusedPtyId && ptyId !== focusedPtyId);
    const shouldUseMacOs = hostFocused === true && (isUnfocusedPane || !allowFocusedPaneOsc);

    if (shouldUseMacOs) {
      const sent = deps.sendMacOsNotification({
        title: notification.title,
        subtitle,
        body: notification.body,
      });
      if (sent) {
        return;
      }
    }

    deps.sendDesktopNotification({ notification, subtitle });
  },
}));

// Note: We intentionally do NOT mock shim/client or shim/client/connection here.
// Bun's module mocking doesn't properly handle namespace imports (`import * as X`)
// when combined with test file-level mocks. Tests that need to mock these modules
// should do so in their own vi.mock() calls, and tests that need the real
// implementation (like connection-notification.test.ts) can import it directly.
