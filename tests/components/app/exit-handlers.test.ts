import { describe, expect, it, vi } from "vitest";

import { createExitHandlers } from "../../../src/components/app/exit-handlers";

const createDeps = () => {
  const events: string[] = [];
  const saveSession = vi.fn().mockImplementation(async () => {
    events.push("save");
  });
  const suspendSessionPersistence = vi.fn(() => {
    events.push("suspend");
  });
  const shutdownShim = vi.fn().mockImplementation(async () => {
    events.push("shutdown");
  });
  const disposeRuntime = vi.fn().mockImplementation(async () => {
    events.push("dispose");
  });
  const renderer = {
    destroy: vi.fn(() => {
      events.push("destroy");
    }),
  };

  return {
    events,
    saveSession,
    suspendSessionPersistence,
    shutdownShim,
    disposeRuntime,
    renderer,
  };
};

describe("createExitHandlers", () => {
  it("suspends persistence after saving on quit", async () => {
    const deps = createDeps();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        deps.events.push(`exit:${code ?? 0}`);
        return undefined as never;
      }) as (code?: number) => never
    );

    const handlers = createExitHandlers({
      saveSession: deps.saveSession,
      suspendSessionPersistence: deps.suspendSessionPersistence,
      shutdownShim: deps.shutdownShim,
      disposeRuntime: deps.disposeRuntime,
      renderer: deps.renderer,
    });

    await handlers.handleQuit();

    expect(deps.events).toEqual([
      "save",
      "suspend",
      "shutdown",
      "dispose",
      "destroy",
      "exit:0",
    ]);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it("suspends persistence after saving on detach", async () => {
    const deps = createDeps();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        deps.events.push(`exit:${code ?? 0}`);
        return undefined as never;
      }) as (code?: number) => never
    );

    const handlers = createExitHandlers({
      saveSession: deps.saveSession,
      suspendSessionPersistence: deps.suspendSessionPersistence,
      shutdownShim: deps.shutdownShim,
      disposeRuntime: deps.disposeRuntime,
      renderer: deps.renderer,
    });

    await handlers.handleDetach();

    expect(deps.events).toEqual([
      "save",
      "suspend",
      "dispose",
      "destroy",
      "exit:0",
    ]);
    expect(deps.shutdownShim).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
