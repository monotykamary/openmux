/**
 * Tests for PTY data handler scheduling and sync buffering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createDataHandler } from "../../../../src/effect/services/pty/data-handler"
import { createSyncModeParser } from "../../../../src/terminal/sync-mode-parser"
import type { InternalPtySession } from "../../../../src/effect/services/pty/types"
import type { GraphicsPassthrough } from "../../../../src/terminal/graphics-passthrough"
import type { TerminalQueryPassthrough } from "../../../../src/terminal/terminal-query-passthrough"

function createSession() {
  const emulator = {
    write: vi.fn(),
    isDisposed: false,
  }

  const passthrough = {
    process: (data: string) => data,
  } as GraphicsPassthrough

  const queryPassthrough = {
    process: (data: string) => data,
  } as TerminalQueryPassthrough

  const session: InternalPtySession = {
    id: "pty-test" as InternalPtySession["id"],
    pty: {} as InternalPtySession["pty"],
    emulator: emulator as InternalPtySession["emulator"],
    graphicsPassthrough: passthrough,
    queryPassthrough,
    cols: 80,
    rows: 24,
    cwd: "",
    shell: "",
    closing: false,
    subscribers: new Set(),
    scrollSubscribers: new Set(),
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 0,
    },
  }

  return { session, emulator }
}

describe("createDataHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("batches segments across ticks", async () => {
    const { session, emulator } = createSession()
    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 50,
    })

    const segments = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i))
    for (const segment of segments) {
      handler.handleData(segment)
    }

    await vi.runAllTimersAsync()

    const writes = emulator.write.mock.calls.map(([data]) => data as string)
    expect(writes.length).toBe(3)
    expect(writes.join("")).toBe(segments.join(""))
  })

  it("flushes sync mode buffer after timeout", async () => {
    const { session, emulator } = createSession()
    const handler = createDataHandler({
      session,
      syncParser: createSyncModeParser(),
      syncTimeoutMs: 10,
    })

    handler.handleData("\x1b[?2026hHello")

    expect(emulator.write).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    await vi.runAllTimersAsync()

    expect(emulator.write).toHaveBeenCalledTimes(1)
    expect(emulator.write).toHaveBeenCalledWith("Hello")
  })
})
