/**
 * Tests for Stream utilities.
 */
import { describe, test, expect, vi } from 'vitest'
import { Chunk, Duration, Effect, Schedule, Stream } from 'effect'
import { runStream, streamFromSubscription } from '../../src/effect/stream-utils'

describe('streamFromSubscription', () => {
  test('emits values and cleans up on completion', async () => {
    let cleaned = false

    const stream = streamFromSubscription<number>((emit) => {
      emit(1)
      emit(2)
      return () => {
        cleaned = true
      }
    }).pipe(Stream.take(2))

    const result = await Effect.runPromise(Stream.runCollect(stream))
    expect(Chunk.toArray(result)).toEqual([1, 2])
    expect(cleaned).toBe(true)
  })
})

describe('runStream', () => {
  test('interrupt stops scheduled stream', async () => {
    vi.useFakeTimers()
    const values: number[] = []

    const stream = Stream.repeatEffectWithSchedule(
      Effect.sync(() => {
        values.push(values.length)
      }),
      Schedule.fixed(Duration.millis(10))
    )

    const stop = runStream(stream)
    await vi.advanceTimersByTimeAsync(35)
    stop()
    const count = values.length
    await vi.advanceTimersByTimeAsync(35)

    expect(values.length).toBe(count)
    vi.useRealTimers()
  })

  test('invokes onError when stream fails', async () => {
    const onError = vi.fn()

    runStream(Stream.fail(new Error('boom')), { onError })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onError).toHaveBeenCalled()
  })
})
