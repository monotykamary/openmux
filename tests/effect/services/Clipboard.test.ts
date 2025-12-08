/**
 * Tests for Clipboard service.
 */
import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Clipboard } from "../../../src/effect/services/Clipboard"

describe("Clipboard", () => {
  describe("testLayer", () => {
    it.effect("writes and reads text", () =>
      Effect.gen(function* () {
        const clipboard = yield* Clipboard

        yield* clipboard.write("Hello, World!")
        const text = yield* clipboard.read()

        expect(text).toBe("Hello, World!")
      }).pipe(Effect.provide(Clipboard.testLayer))
    )

    it.effect("overwrites previous content", () =>
      Effect.gen(function* () {
        const clipboard = yield* Clipboard

        yield* clipboard.write("First")
        yield* clipboard.write("Second")
        const text = yield* clipboard.read()

        expect(text).toBe("Second")
      }).pipe(Effect.provide(Clipboard.testLayer))
    )

    it.effect("starts empty", () =>
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        const text = yield* clipboard.read()

        expect(text).toBe("")
      }).pipe(Effect.provide(Clipboard.testLayer))
    )
  })
})
