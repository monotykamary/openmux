/**
 * Tests for Pty service types and testLayer behavior.
 * Note: Full PTY integration tests require bun runtime due to bun-pty.
 */
import { Effect, Context, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Cols, Rows, makePtyId, PtyId } from "../../../src/effect/types"
import { PtySession } from "../../../src/effect/models"

// Create a mock Pty service for testing without bun-pty dependency
class MockPty extends Context.Tag("@openmux/MockPty")<
  MockPty,
  {
    readonly create: (options: {
      cols: Cols
      rows: Rows
      cwd?: string
    }) => Effect.Effect<PtyId>
    readonly write: (id: PtyId, data: string) => Effect.Effect<void>
    readonly resize: (id: PtyId, cols: Cols, rows: Rows) => Effect.Effect<void>
    readonly getCwd: (id: PtyId) => Effect.Effect<string>
    readonly destroy: (id: PtyId) => Effect.Effect<void>
    readonly getSession: (id: PtyId) => Effect.Effect<PtySession>
    readonly destroyAll: () => Effect.Effect<void>
  }
>() {
  static readonly testLayer = Layer.succeed(MockPty, {
    create: () => Effect.succeed(makePtyId()),
    write: () => Effect.void,
    resize: () => Effect.void,
    getCwd: () => Effect.succeed("/test/cwd"),
    destroy: () => Effect.void,
    getSession: (id) =>
      Effect.succeed(
        PtySession.make({
          id,
          pid: 12345,
          cols: Cols.make(80),
          rows: Rows.make(24),
          cwd: "/test/cwd",
          shell: "/bin/bash",
        })
      ),
    destroyAll: () => Effect.void,
  })
}

describe("Pty", () => {
  describe("testLayer behavior", () => {
    it.effect("creates a PTY session", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        expect(ptyId).toBeDefined()
        expect(typeof ptyId).toBe("string")
        expect(ptyId).toContain("pty-")
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("gets session info", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        const session = yield* pty.getSession(ptyId)

        expect(session.pid).toBe(12345)
        expect(session.cols).toBe(80)
        expect(session.rows).toBe(24)
        expect(session.cwd).toBe("/test/cwd")
        expect(session.shell).toBe("/bin/bash")
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("gets CWD", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        const cwd = yield* pty.getCwd(ptyId)

        expect(cwd).toBe("/test/cwd")
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("writes to PTY without error", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        yield* pty.write(ptyId, "echo hello")
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("resizes PTY without error", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        yield* pty.resize(ptyId, Cols.make(120), Rows.make(40))
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("destroys PTY session", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        const ptyId = yield* pty.create({
          cols: Cols.make(80),
          rows: Rows.make(24),
        })

        yield* pty.destroy(ptyId)
      }).pipe(Effect.provide(MockPty.testLayer))
    )

    it.effect("destroys all PTY sessions", () =>
      Effect.gen(function* () {
        const pty = yield* MockPty

        yield* pty.create({ cols: Cols.make(80), rows: Rows.make(24) })
        yield* pty.create({ cols: Cols.make(100), rows: Rows.make(30) })

        yield* pty.destroyAll()
      }).pipe(Effect.provide(MockPty.testLayer))
    )
  })

  describe("PtySession model", () => {
    it("creates valid PtySession", () => {
      const session = PtySession.make({
        id: PtyId.make("test-pty-1"),
        pid: 9999,
        cols: Cols.make(120),
        rows: Rows.make(40),
        cwd: "/home/user",
        shell: "/bin/zsh",
      })

      expect(session.id).toBe("test-pty-1")
      expect(session.pid).toBe(9999)
      expect(session.cols).toBe(120)
      expect(session.rows).toBe(40)
      expect(session.cwd).toBe("/home/user")
      expect(session.shell).toBe("/bin/zsh")
    })
  })

  describe("makePtyId", () => {
    it("generates unique IDs", () => {
      const id1 = makePtyId()
      const id2 = makePtyId()
      const id3 = makePtyId()

      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })

    it("generates IDs with correct prefix", () => {
      const id = makePtyId()
      expect(id.startsWith("pty-")).toBe(true)
    })
  })
})
