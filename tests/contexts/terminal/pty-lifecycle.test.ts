import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TerminalScrollState } from "../../../src/core/types";
import type { ITerminalEmulator } from "../../../src/terminal/emulator-interface";
import { createPtyLifecycleHandlers } from "../../../src/contexts/terminal/pty-lifecycle";
import { createPtySession, destroyPty } from "../../../src/effect/bridge";
import { clearPtyCaches, subscribeToPtyExit, subscribeToPtyWithCaches } from "../../../src/hooks/usePtySubscription";

vi.mock("../../../src/effect/bridge", () => ({
  createPtySession: vi.fn(),
  destroyPty: vi.fn(),
  destroyAllPtys: vi.fn(),
  getActiveSessionIdForShim: vi.fn(),
  registerPtyPane: vi.fn(),
}));

vi.mock("../../../src/hooks/usePtySubscription", () => ({
  subscribeToPtyWithCaches: vi.fn(),
  subscribeToPtyExit: vi.fn(),
  clearPtyCaches: vi.fn(),
  clearAllPtyCaches: vi.fn(),
}));

describe("createPtyLifecycleHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("closes the pane even if pty->pane mapping is missing", () => {
    const ptyToPaneMap = new Map<string, string>();
    const sessionPtyMap = new Map<string, Map<string, string>>();
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();
    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>();
    const closePaneById = vi.fn();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById,
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    handlers.handlePtyExit("pty-1", "pane-1");

    expect(closePaneById).toHaveBeenCalledWith("pane-1");
    expect(vi.mocked(destroyPty)).toHaveBeenCalledWith("pty-1");
  });

  test("creates an exit subscription before deferring cache wiring", async () => {
    vi.useFakeTimers();

    vi.mocked(createPtySession).mockResolvedValue("pty-1");
    vi.mocked(subscribeToPtyExit).mockResolvedValue(vi.fn());
    vi.mocked(subscribeToPtyWithCaches).mockResolvedValue(vi.fn());

    const ptyToPaneMap = new Map<string, string>();
    const sessionPtyMap = new Map<string, Map<string, string>>();
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();
    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById: vi.fn(),
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    const ptyId = await handlers.createPTY("pane-1", 80, 24);

    expect(ptyId).toBe("pty-1");
    expect(subscribeToPtyExit).toHaveBeenCalledWith("pty-1", "pane-1", handlers.handlePtyExit);
    expect(subscribeToPtyWithCaches).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(subscribeToPtyWithCaches).toHaveBeenCalledWith(
      "pty-1",
      "pane-1",
      ptyCaches,
      handlers.handlePtyExit,
      { cacheScrollState: true, skipExit: true }
    );

  });

  test("cleans up on destroyed lifecycle without re-destroying the PTY", () => {
    const ptyToPaneMap = new Map<string, string>([["pty-1", "pane-1"]]);
    const sessionPtyMap = new Map<string, Map<string, string>>([
      ["session-1", new Map([["pane-1", "pty-1"]])],
    ]);
    const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>([
      ["pty-1", { sessionId: "session-1", paneId: "pane-1" }],
    ]);
    const ptyCaches = {
      scrollStates: new Map<string, TerminalScrollState>(),
      emulators: new Map<string, ITerminalEmulator>(),
    };
    const unsubscribeFns = new Map<string, () => void>();
    const unsubscribe = vi.fn();
    unsubscribeFns.set("pty-1", unsubscribe);
    const closePaneById = vi.fn();

    const handlers = createPtyLifecycleHandlers({
      ptyToPaneMap,
      sessionPtyMap,
      ptyToSessionMap,
      ptyCaches,
      unsubscribeFns,
      closePaneById,
      setPanePty: vi.fn(),
      newPaneWithPty: vi.fn(),
      getNewPaneDimensions: () => ({ cols: 80, rows: 24 }),
      shouldCacheScrollState: true,
    });

    handlers.handlePtyDestroyed("pty-1");

    expect(closePaneById).toHaveBeenCalledWith("pane-1");
    expect(unsubscribe).toHaveBeenCalled();
    expect(vi.mocked(clearPtyCaches)).toHaveBeenCalledWith("pty-1", ptyCaches);
    expect(vi.mocked(destroyPty)).not.toHaveBeenCalled();
    expect(ptyToPaneMap.has("pty-1")).toBe(false);
    expect(ptyToSessionMap.has("pty-1")).toBe(false);
    expect(sessionPtyMap.get("session-1")?.has("pane-1")).toBe(false);
  });
});
