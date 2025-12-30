import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspaces } from '../../src/core/operations/layout-actions';
import type { SessionState } from '../../src/core/operations/session-actions';
import type { SessionMetadata, WorkspaceId } from '../../src/core/types';
import { createSessionOperations } from '../../src/contexts/session-operations';
import {
  createSessionLegacy,
  deleteSessionLegacy,
  listSessionsLegacy,
  loadSessionData,
  saveCurrentSession,
  switchToSession,
} from '../../src/effect/bridge';

vi.mock('../../src/effect/bridge', () => ({
  createSessionLegacy: vi.fn(),
  listSessionsLegacy: vi.fn(),
  renameSessionLegacy: vi.fn(),
  deleteSessionLegacy: vi.fn(),
  saveCurrentSession: vi.fn(),
  loadSessionData: vi.fn(),
  switchToSession: vi.fn(),
}));

const createMetadata = (id: string, name = id): SessionMetadata => ({
  id,
  name,
  createdAt: 1,
  lastSwitchedAt: 1,
  autoNamed: false,
});

const createState = (overrides: Partial<SessionState> = {}): SessionState => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  showSessionPicker: false,
  searchQuery: '',
  selectedIndex: 0,
  isRenaming: false,
  renameValue: '',
  renamingSessionId: null,
  summaries: new Map(),
  initialized: true,
  switching: false,
  ...overrides,
});

describe('createSessionOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips saving and switches to the next session when deleting the active session', async () => {
    const sessionA = createMetadata('session-a');
    const sessionB = createMetadata('session-b');
    const state = createState({
      sessions: [sessionA, sessionB],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    const onSessionLoad = vi.fn().mockResolvedValue(undefined);
    const onBeforeSwitch = vi.fn().mockResolvedValue(undefined);
    const onDeleteSession = vi.fn();
    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad,
      onBeforeSwitch,
      onDeleteSession,
      refreshSessions,
    });

    const loadedData = {
      metadata: sessionB,
      workspaces: {} as Workspaces,
      activeWorkspaceId: 1 as WorkspaceId,
      cwdMap: new Map<string, string>(),
    };

    vi.mocked(listSessionsLegacy).mockResolvedValue([sessionB]);
    vi.mocked(loadSessionData).mockResolvedValue(loadedData);
    vi.mocked(switchToSession).mockResolvedValue(undefined);
    vi.mocked(deleteSessionLegacy).mockResolvedValue(undefined);

    await ops.deleteSession(sessionA.id);

    expect(vi.mocked(saveCurrentSession)).not.toHaveBeenCalled();
    expect(onBeforeSwitch).toHaveBeenCalledWith(sessionA.id);
    expect(onDeleteSession).toHaveBeenCalledWith(sessionA.id);
    expect(vi.mocked(deleteSessionLegacy)).toHaveBeenCalledWith(sessionA.id);
    expect(vi.mocked(switchToSession)).toHaveBeenCalledWith(sessionB.id);
    expect(onSessionLoad).toHaveBeenCalledWith(
      loadedData.workspaces,
      loadedData.activeWorkspaceId,
      loadedData.cwdMap,
      expect.any(Map),
      sessionB.id,
      { allowPrune: true }
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      id: sessionB.id,
      session: sessionB,
    });
  });

  it('creates a new session when deleting the last active session', async () => {
    const sessionA = createMetadata('session-a');
    const newSession = createMetadata('session-new');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const dispatch = vi.fn();
    const onSessionLoad = vi.fn().mockResolvedValue(undefined);
    const onBeforeSwitch = vi.fn().mockResolvedValue(undefined);
    const onDeleteSession = vi.fn();
    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch,
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad,
      onBeforeSwitch,
      onDeleteSession,
      refreshSessions,
    });

    vi.mocked(listSessionsLegacy).mockResolvedValue([]);
    vi.mocked(deleteSessionLegacy).mockResolvedValue(undefined);
    vi.mocked(createSessionLegacy).mockResolvedValue(newSession);

    await ops.deleteSession(sessionA.id);

    expect(vi.mocked(saveCurrentSession)).not.toHaveBeenCalled();
    expect(onBeforeSwitch).toHaveBeenCalledWith(sessionA.id);
    expect(onDeleteSession).toHaveBeenCalledWith(sessionA.id);
    expect(vi.mocked(createSessionLegacy)).toHaveBeenCalled();
    expect(onSessionLoad).toHaveBeenCalledWith(
      {},
      1,
      expect.any(Map),
      expect.any(Map),
      newSession.id,
      { allowPrune: false }
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      id: newSession.id,
      session: newSession,
    });
  });

  it('avoids saving when shouldPersistSession is false', async () => {
    const sessionA = createMetadata('session-a');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => false,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions,
    });

    await ops.saveSession();

    expect(vi.mocked(saveCurrentSession)).not.toHaveBeenCalled();
    expect(refreshSessions).not.toHaveBeenCalled();
  });

  it('saves when shouldPersistSession is true', async () => {
    const sessionA = createMetadata('session-a');
    const state = createState({
      sessions: [sessionA],
      activeSessionId: sessionA.id,
      activeSession: sessionA,
    });

    const refreshSessions = vi.fn().mockResolvedValue(undefined);

    const ops = createSessionOperations({
      getState: () => state,
      dispatch: vi.fn(),
      getCwd: vi.fn().mockResolvedValue('/tmp'),
      getWorkspaces: () => ({}),
      getActiveWorkspaceId: () => 1 as WorkspaceId,
      shouldPersistSession: () => true,
      onSessionLoad: vi.fn().mockResolvedValue(undefined),
      onBeforeSwitch: vi.fn().mockResolvedValue(undefined),
      onDeleteSession: vi.fn(),
      refreshSessions,
    });

    vi.mocked(saveCurrentSession).mockResolvedValue(undefined);

    await ops.saveSession();

    expect(vi.mocked(saveCurrentSession)).toHaveBeenCalledWith(
      sessionA,
      {},
      1,
      expect.any(Function)
    );
    expect(refreshSessions).toHaveBeenCalled();
  });
});
