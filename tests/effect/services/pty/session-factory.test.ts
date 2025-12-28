/**
 * Tests for PTY session factory exit hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import type { TerminalColors } from "../../../../src/terminal/terminal-colors"
import { Cols, Rows } from "../../../../src/effect/types"
import { createSession } from "../../../../src/effect/services/pty/session-factory"
import { spawnAsync } from "../../../../native/zig-pty/ts/index"
import { createGhosttyVTEmulator } from "../../../../src/terminal/ghostty-vt/emulator"

vi.mock("../../../../native/zig-pty/ts/index", () => ({
  spawnAsync: vi.fn(),
}))

vi.mock("../../../../src/terminal/ghostty-vt/emulator", () => ({
  createGhosttyVTEmulator: vi.fn(),
}))

vi.mock("../../../../src/terminal/capabilities", () => ({
  getCapabilityEnvironment: vi.fn(() => ({})),
}))

vi.mock("../../../../src/effect/services/pty/notification", () => ({
  notifySubscribers: vi.fn(),
}))

vi.mock("../../../../src/effect/services/pty/data-handler", () => ({
  createDataHandler: vi.fn(() => ({ handleData: vi.fn() })),
}))

vi.mock("../../../../src/effect/services/pty/query-setup", () => ({
  setupQueryPassthrough: vi.fn(),
}))

describe("createSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("notifies onExit hook when the PTY exits", async () => {
    let exitHandler: ((event: { exitCode: number }) => void) | null = null

    const fakePty = {
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exitHandler = cb
        return { dispose: () => {} }
      },
      onData: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      getCwd: vi.fn(() => "/"),
      getForegroundProcessName: vi.fn(),
      pid: 123,
    }

    vi.mocked(spawnAsync).mockResolvedValue(
      fakePty as Awaited<ReturnType<typeof spawnAsync>>
    )

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ""),
    }

    vi.mocked(createGhosttyVTEmulator).mockReturnValue(
      emulator as ReturnType<typeof createGhosttyVTEmulator>
    )

    const onExit = vi.fn()
    const { id, session } = await Effect.runPromise(
      createSession(
        {
          colors: {} as TerminalColors,
          defaultShell: "/bin/sh",
          onLifecycleEvent: vi.fn(() => Effect.void),
          onTitleChange: vi.fn(),
          onExit,
        },
        { cols: Cols.make(80), rows: Rows.make(24) }
      )
    )

    const exitCallback = vi.fn()
    session.exitCallbacks.add(exitCallback)

    expect(exitHandler).not.toBeNull()
    exitHandler?.({ exitCode: 0 })

    expect(exitCallback).toHaveBeenCalledWith(0)
    expect(onExit).toHaveBeenCalledWith(id, 0)
  })
})
