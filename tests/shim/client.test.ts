import { beforeEach, afterEach, describe, expect, test, vi } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';

// Set up test-specific socket path BEFORE any shim modules are imported
const testSocketDir = join(tmpdir(), `openmux-test-${Date.now()}`);
process.env.OPENMUX_SHIM_SOCKET_DIR = testSocketDir;
process.env.OPENMUX_SHIM_SOCKET_PATH = join(testSocketDir, 'test.sock');

import { defaultRegistry, resetAllPtyState } from '../../src/shim/client/state';
import * as connectionModule from '../../src/shim/client/connection';

let shimClientNonce = 0;

describe('shim client getTitle', () => {
  beforeEach(() => {
    resetAllPtyState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns cached non-empty titles without requesting', async () => {
    defaultRegistry.setPtyState('pty-1', {
      terminalState: null,
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: 'Opencode',
    });

    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest');
    const getPtyStateSpy = vi.spyOn(defaultRegistry, 'getPtyState');

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-1');

    expect(title).toBe('Opencode');
    expect(sendRequestSpy).not.toHaveBeenCalled();
    expect(getPtyStateSpy).toHaveBeenCalled();
  });

  test('refreshes empty cached titles from the shim', async () => {
    defaultRegistry.setPtyState('pty-2', {
      terminalState: null,
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: '',
    });

    const handlePtyTitleSpy = vi.spyOn(defaultRegistry, 'handlePtyTitle');
    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest').mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-2');

    expect(title).toBe('shell');
    expect(sendRequestSpy).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-2' });
    expect(handlePtyTitleSpy).toHaveBeenCalledWith('pty-2', 'shell');
    expect(defaultRegistry.getPtyState('pty-2')?.title).toBe('shell');

    sendRequestSpy.mockRestore();
  });

  test('requests title when no cache exists', async () => {
    const handlePtyTitleSpy = vi.spyOn(defaultRegistry, 'handlePtyTitle');
    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest').mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-3');

    expect(title).toBe('shell');
    expect(sendRequestSpy).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-3' });
    expect(handlePtyTitleSpy).toHaveBeenCalledWith('pty-3', 'shell');
    expect(defaultRegistry.getPtyState('pty-3')?.title).toBe('shell');

    sendRequestSpy.mockRestore();
  });
});
