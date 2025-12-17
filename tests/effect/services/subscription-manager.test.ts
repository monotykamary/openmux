/**
 * Tests for SubscriptionRegistry
 * Verifies Effect-based subscription management with synchronous cleanup
 */
import { describe, test, expect, vi } from 'vitest'
import { Effect, Scope, Logger, LogLevel } from 'effect'
import {
  makeSubscriptionRegistry,
  makeSubscriptionId,
  type SubscriptionId
} from '../../../src/effect/services/pty/subscription-manager'

describe('SubscriptionRegistry', () => {
  describe('makeSubscriptionId', () => {
    test('should generate unique subscription IDs', () => {
      const id1 = makeSubscriptionId()
      const id2 = makeSubscriptionId()
      const id3 = makeSubscriptionId()

      expect(id1).not.toBe(id2)
      expect(id2).not.toBe(id3)
      expect(id1).not.toBe(id3)
    })

    test('should generate IDs with expected format', () => {
      const id = makeSubscriptionId()

      expect(id).toMatch(/^sub_\d+_[a-z0-9]+$/)
    })
  })

  describe('subscribe', () => {
    test('should add subscriber and call callback on notify', async () => {
      const callback = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          yield* registry.subscribe(callback)
          yield* registry.notify('test message')

          expect(callback).toHaveBeenCalledTimes(1)
          expect(callback).toHaveBeenCalledWith('test message')
        })
      )
    })

    test('should return cleanup function that removes subscriber', async () => {
      const callback = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          const cleanup = yield* registry.subscribe(callback)
          cleanup()

          yield* registry.notify('after cleanup')

          expect(callback).not.toHaveBeenCalled()
        })
      )
    })

    test('should handle multiple subscribers', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      const callback3 = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<number>()

          yield* registry.subscribe(callback1)
          yield* registry.subscribe(callback2)
          yield* registry.subscribe(callback3)

          yield* registry.notify(42)

          expect(callback1).toHaveBeenCalledWith(42)
          expect(callback2).toHaveBeenCalledWith(42)
          expect(callback3).toHaveBeenCalledWith(42)
        })
      )
    })

    test('should only remove the specific subscriber on cleanup', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          const cleanup1 = yield* registry.subscribe(callback1)
          yield* registry.subscribe(callback2)

          cleanup1()
          yield* registry.notify('message')

          expect(callback1).not.toHaveBeenCalled()
          expect(callback2).toHaveBeenCalledWith('message')
        })
      )
    })
  })

  describe('subscribeScoped', () => {
    test('should auto-cleanup when scope closes', async () => {
      const callback = vi.fn()
      let registryRef: Awaited<ReturnType<typeof Effect.runPromise<ReturnType<typeof makeSubscriptionRegistry<string>>>>> | null = null

      // Create registry outside scope so we can notify after scope closes
      await Effect.runPromise(
        Effect.gen(function* () {
          registryRef = yield* makeSubscriptionRegistry<string>()
        })
      )

      // Subscribe in a scope
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* registryRef!.subscribeScoped(callback)

            // Should receive notifications while scope is open
            yield* registryRef!.notify('in scope')
            expect(callback).toHaveBeenCalledWith('in scope')
          })
        )
      )

      // After scope closes, subscription should be cleaned up
      callback.mockClear()
      await Effect.runPromise(registryRef!.notify('after scope'))
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('notify', () => {
    test('should call all subscribers with the value', async () => {
      const values: number[] = []

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<number>()

          yield* registry.subscribe((v) => values.push(v * 1))
          yield* registry.subscribe((v) => values.push(v * 2))
          yield* registry.subscribe((v) => values.push(v * 3))

          yield* registry.notify(10)

          expect(values).toContain(10)
          expect(values).toContain(20)
          expect(values).toContain(30)
        })
      )
    })

    test('should continue notifying other subscribers if one throws', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn(() => { throw new Error('callback error') })
      const callback3 = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          yield* registry.subscribe(callback1)
          yield* registry.subscribe(callback2)
          yield* registry.subscribe(callback3)

          yield* registry.notify('test')

          // All callbacks should be called despite callback2 throwing
          expect(callback1).toHaveBeenCalled()
          expect(callback2).toHaveBeenCalled()
          expect(callback3).toHaveBeenCalled()
        }).pipe(Logger.withMinimumLogLevel(LogLevel.None))
      )
    })
  })

  describe('notifySync', () => {
    test('should call all subscribers synchronously', async () => {
      const callback = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          yield* registry.subscribe(callback)

          // notifySync is synchronous (for non-Effect contexts)
          registry.notifySync('sync message')

          expect(callback).toHaveBeenCalledWith('sync message')
        })
      )
    })

    test('should continue notifying if callback throws', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn(() => { throw new Error('error') })
      const callback3 = vi.fn()

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          yield* registry.subscribe(callback1)
          yield* registry.subscribe(callback2)
          yield* registry.subscribe(callback3)

          registry.notifySync('test')

          expect(callback1).toHaveBeenCalled()
          expect(callback2).toHaveBeenCalled()
          expect(callback3).toHaveBeenCalled()
        })
      )

      warnSpy.mockRestore()
    })
  })

  describe('getSubscriberCount', () => {
    test('should return 0 for empty registry', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          const count = yield* registry.getSubscriberCount()

          expect(count).toBe(0)
        })
      )
    })

    test('should return correct count after subscribing', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          yield* registry.subscribe(() => {})
          yield* registry.subscribe(() => {})
          yield* registry.subscribe(() => {})

          const count = yield* registry.getSubscriberCount()

          expect(count).toBe(3)
        })
      )
    })

    test('should return correct count after unsubscribing', async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          const cleanup1 = yield* registry.subscribe(() => {})
          yield* registry.subscribe(() => {})
          const cleanup3 = yield* registry.subscribe(() => {})

          cleanup1()
          cleanup3()

          const count = yield* registry.getSubscriberCount()

          expect(count).toBe(1)
        })
      )
    })
  })

  describe('typed events', () => {
    test('should work with complex event types', async () => {
      interface MyEvent {
        type: 'created' | 'destroyed'
        id: string
        timestamp: number
      }

      const events: MyEvent[] = []

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<MyEvent>()

          yield* registry.subscribe((event) => events.push(event))

          yield* registry.notify({ type: 'created', id: 'abc', timestamp: 1000 })
          yield* registry.notify({ type: 'destroyed', id: 'abc', timestamp: 2000 })

          expect(events).toHaveLength(2)
          expect(events[0]).toEqual({ type: 'created', id: 'abc', timestamp: 1000 })
          expect(events[1]).toEqual({ type: 'destroyed', id: 'abc', timestamp: 2000 })
        })
      )
    })
  })

  describe('concurrent subscriptions', () => {
    test('should handle rapid subscribe/unsubscribe', async () => {
      const callback = vi.fn()

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<number>()

          // Rapidly subscribe and unsubscribe
          for (let i = 0; i < 100; i++) {
            const cleanup = yield* registry.subscribe(callback)
            cleanup()
          }

          // Final state should have no subscribers
          const count = yield* registry.getSubscriberCount()
          expect(count).toBe(0)
        })
      )
    })

    test('should handle many simultaneous subscribers', async () => {
      const callbacks = Array.from({ length: 50 }, () => vi.fn())

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* makeSubscriptionRegistry<string>()

          // Subscribe all
          for (const cb of callbacks) {
            yield* registry.subscribe(cb)
          }

          yield* registry.notify('broadcast')

          // All should have been called
          for (const cb of callbacks) {
            expect(cb).toHaveBeenCalledWith('broadcast')
          }
        })
      )
    })
  })
})
