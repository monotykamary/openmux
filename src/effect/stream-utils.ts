/**
 * Stream helpers for bridging Effect streams into non-Effect code.
 */

import { Effect, Fiber, Stream } from "effect"

export interface RunStreamOptions {
  label?: string
  onError?: (cause: unknown) => void
}

export const runStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  options: RunStreamOptions = {}
): (() => void) => {
  const effect = Stream.runDrain(stream)
  const guarded = Effect.catchAllCause(effect, (cause) =>
    Effect.sync(() => {
      if (options.onError) {
        options.onError(cause)
        return
      }
      const label = options.label ? ` (${options.label})` : ''
      console.warn(`[openmux] stream error${label}:`, cause)
    })
  )
  const fiber = Effect.runFork(guarded)
  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

export const streamFromSubscription = <A>(
  subscribe: (emit: (value: A) => void) => Promise<() => void> | (() => void)
): Stream.Stream<A> =>
  Stream.async((emit) => {
    const cleanupPromise = Promise.resolve(
      subscribe((value) => {
        void emit.single(value)
      })
    )
    return Effect.promise(async () => {
      const cleanup = await cleanupPromise
      cleanup?.()
    })
  })
