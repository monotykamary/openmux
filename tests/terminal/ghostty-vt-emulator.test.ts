/**
 * Tests for GhosttyVTEmulator update gating.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { DirtyState } from "../../src/terminal/ghostty-vt/types"
import { getDefaultColors } from "../../src/terminal/terminal-colors"

const { MockTerminal, terminalState } = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = []
    updateCalls = 0
    writeCalls: Array<string | Uint8Array> = []
    cols: number
    rows: number

    constructor(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      MockTerminal.instances.push(this)
    }

    write(data: string | Uint8Array): void {
      this.writeCalls.push(data)
    }

    update(): DirtyState {
      this.updateCalls += 1
      return DirtyState.FULL
    }

    markClean(): void {}

    getCursor(): { x: number; y: number; visible: boolean } {
      return { x: 0, y: 0, visible: true }
    }

    getScrollbackLength(): number {
      return 0
    }

    getViewport(): any[] {
      return []
    }

    isRowDirty(): boolean {
      return true
    }

    resize(cols: number, rows: number): void {
      this.cols = cols
      this.rows = rows
    }

    getMode(): boolean {
      return false
    }

    getKittyKeyboardFlags(): number {
      return 0
    }

    isAlternateScreen(): boolean {
      return false
    }

    free(): void {}
  }

  const terminalState = {
    reset() {
      MockTerminal.instances = []
    },
    get last(): MockTerminal | null {
      return MockTerminal.instances.at(-1) ?? null
    },
  }

  return { MockTerminal, terminalState }
})

vi.mock("../../src/terminal/ghostty-vt/terminal", () => ({
  GhosttyVtTerminal: MockTerminal,
}))

let GhosttyVTEmulator: typeof import("../../src/terminal/ghostty-vt/emulator").GhosttyVTEmulator

beforeAll(async () => {
  ;({ GhosttyVTEmulator } = await import("../../src/terminal/ghostty-vt/emulator"))
})

beforeEach(() => {
  terminalState.reset()
})

describe("GhosttyVTEmulator", () => {
  it("defers updates while disabled and refreshes on enable", () => {
    const emulator = new GhosttyVTEmulator(2, 1, getDefaultColors())
    const terminal = terminalState.last
    expect(terminal).not.toBeNull()

    const updateSpy = vi.fn()
    emulator.onUpdate(updateSpy)
    updateSpy.mockClear()

    const updateCallsBefore = terminal!.updateCalls

    emulator.setUpdateEnabled(false)
    emulator.write("hello")

    expect(terminal!.writeCalls).toContain("hello")
    expect(terminal!.updateCalls).toBe(updateCallsBefore)
    expect(updateSpy).not.toHaveBeenCalled()

    emulator.setUpdateEnabled(true)

    expect(terminal!.updateCalls).toBeGreaterThan(updateCallsBefore)
    expect(updateSpy).toHaveBeenCalled()
  })
})
