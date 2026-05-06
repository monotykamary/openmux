/**
 * PTY Service Test Implementation - Litmus Tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { createTestPtyService } from './index';
import type { PtyService } from './interface';
import { createTestServices } from '../../services';
import { ClipboardError, GhosttyVtInitError, NativeKeyError } from '../../errors';
import { createTestClipboard } from '../Clipboard';

describe('createTestPtyService (litmus)', () => {
  let service: PtyService;

  beforeEach(() => {
    service = createTestPtyService();
  });

  it('should create a service with the consolidated PTY API', () => {
    expect(service.create).toBeTypeOf('function');
    expect(service.write).toBeTypeOf('function');
    expect(service.resize).toBeTypeOf('function');
    expect(service.destroy).toBeTypeOf('function');
    expect(service.getCwd).toBeTypeOf('function');
    expect(service.subscribe).toBeTypeOf('function');
    expect(service.getEmulator).toBeTypeOf('function');
    expect(service.subscribeToTitle).toBeTypeOf('function');
    expect(service.listAll).toBeTypeOf('function');
    expect(service.dispose).toBeTypeOf('function');
  });

  it('should create mock PTYs', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });

    expect(ptyId).not.toBeInstanceOf(Error);
    if (ptyId instanceof Error) return;

    expect(ptyId).toBeTypeOf('string');
  });

  it('should return test CWD', async () => {
    const cwd = await service.getCwd('any-pty' as any);
    expect(cwd).toBe('/test/cwd');
  });

  it('should return test session metadata', async () => {
    const ptyId = await service.create({ cols: 80, rows: 24 });
    expect(ptyId).not.toBeInstanceOf(Error);
    if (ptyId instanceof Error) return;

    const session = await service.getSession(ptyId);

    expect(session).not.toBeInstanceOf(Error);
    if (session instanceof Error) return;

    expect(session.id).toBe(ptyId);
    expect(session.pid).toBe(12345);
    expect(session.cols).toBe(80);
    expect(session.rows).toBe(24);
    expect(session.cwd).toBe('/test/cwd');
    expect(session.shell).toBe('/bin/bash');
    expect(session.title).toBe('');
    expect(session.lastCommand).toBeUndefined();
  });

  it('should return mock terminal state', async () => {
    const state = await service.getTerminalState('test-pty' as any);

    expect(state).not.toBeInstanceOf(Error);
    if (state instanceof Error) return;

    expect(state.cursorX).toBe(0);
    expect(state.cursorY).toBe(0);
    expect(state.cursorVisible).toBe(true);
  });

  it('should return empty list', async () => {
    const ids = await service.listAll();
    expect(ids).toEqual([]);
  });

  it('should return no-op unsubscribe functions', async () => {
    const unsub1 = await service.subscribe('pty' as any, () => {});
    const unsub2 = await service.onExit('pty' as any, () => {});
    const unsub3 = await service.subscribeToTitle('pty' as any, () => {});
    const unsub4 = service.subscribeToTitle(() => {});

    expect(unsub1).toBeTypeOf('function');
    expect(unsub2).toBeTypeOf('function');
    expect(unsub3).toBeTypeOf('function');
    expect(unsub4).toBeTypeOf('function');

    unsub1();
    unsub2();
    unsub3();
    unsub4();
  });

  it('should return no-op for lifecycle subscriptions', () => {
    const unsub = service.subscribeToLifecycle(() => {});
    expect(unsub).toBeTypeOf('function');
    unsub();
  });

  it('should return no-op for CWD change subscriptions', () => {
    const unsub = service.subscribeToCwdChange(() => {});
    expect(unsub).toBeTypeOf('function');
    unsub();
  });

  it('should return undefined for git and foreground-process metadata', async () => {
    expect(await service.getGitInfo('pty' as any)).toBeUndefined();
    expect(await service.getGitInfo('pty' as any, { includeDiffStats: true })).toBeUndefined();
    expect(await service.getForegroundProcess('pty' as any)).toBeUndefined();
  });

  it('should return PtyNotFoundError for async getEmulator and return null for sync getEmulator', async () => {
    const result = await service.getEmulator('pty' as any);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('PTY session');
    expect(service.getEmulator('pty' as any, { sync: true })).toBeNull();
  });

  it('should handle dispose without error', () => {
    expect(() => service.dispose()).not.toThrow();
  });
});

// Tests for changes in Clipboard error paths, new GhosttyVtInitError, and NativeKeyError
// These capture the refactored early-return error handling and tagged error usage.
describe('error classes and clipboard (post-refactor)', () => {
  it('should construct ClipboardError with correct shape', () => {
    const err = new ClipboardError({ operation: 'write', reason: 'test' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClipboardError');
    expect(err.message).toContain('Clipboard write failed: test');
  });

  it('should construct GhosttyVtInitError with correct shape', () => {
    const err = new GhosttyVtInitError({ operation: 'resolve-lib', reason: 'missing lib' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GhosttyVtInitError');
    expect(err.message).toContain('Ghostty VT resolve-lib failed: missing lib');
  });

  it('should construct NativeKeyError with correct shape', () => {
    const err = new NativeKeyError({ operation: 'init', reason: 'symbols unavailable' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NativeKeyError');
    expect(err.message).toContain('Native key encoder init failed: symbols unavailable');
  });

  it('should provide working test clipboard impl', async () => {
    const clip = createTestClipboard();
    await clip.write('hello test');
    const read = await clip.read();
    expect(read).toBe('hello test');
    // write again overwrites
    await clip.write('updated');
    expect(await clip.read()).toBe('updated');
  });

  it('should create test services with clipboard', async () => {
    const services = await createTestServices();
    expect(services.clipboard).toBeDefined();
    expect(typeof services.clipboard.write).toBe('function');
    expect(typeof services.clipboard.read).toBe('function');
  });
});
