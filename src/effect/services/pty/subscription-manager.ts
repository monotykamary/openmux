/**
 * Subscription management utilities for PTY service.
 * Provides subscription tracking with synchronous cleanup support.
 *
 * Uses a mutable Map as the source of truth for subscriptions. This enables:
 * - Synchronous cleanup (required for SolidJS onCleanup)
 * - Synchronous notifications (for non-Effect contexts)
 */

import { Effect } from "effect"

// =============================================================================
// Types
// =============================================================================

/** Branded subscription ID for type safety */
export type SubscriptionId = string & { readonly _tag: "SubscriptionId" }

export const makeSubscriptionId = (): SubscriptionId =>
  `sub_${Date.now()}_${Math.random().toString(36).slice(2)}` as SubscriptionId

export interface Subscription<T> {
  readonly id: SubscriptionId
  readonly callback: (value: T) => void
  readonly createdAt: number
}

// =============================================================================
// SubscriptionRegistry
// =============================================================================

/**
 * Create a subscription registry for a specific event type.
 *
 * Provides:
 * - `subscribe`: Returns manual cleanup function (for SolidJS bridge)
 * - `notify`/`notifySync`: Event broadcasting
 */
export const makeSubscriptionRegistry = <T>() =>
  Effect.sync(() => {
    // Mutable map as source of truth - enables synchronous operations
    const subscriptions = new Map<SubscriptionId, Subscription<T>>()

    /**
     * Subscribe with manual cleanup function.
     * Use this for bridging to non-Effect code (e.g., SolidJS).
     * The returned cleanup function is synchronous.
     */
    const subscribe = (callback: (value: T) => void) =>
      Effect.sync(() => {
        const id = makeSubscriptionId()
        const sub: Subscription<T> = {
          id,
          callback,
          createdAt: Date.now(),
        }
        subscriptions.set(id, sub)

        // Return SYNCHRONOUS cleanup function (for SolidJS onCleanup)
        return () => {
          subscriptions.delete(id)
        }
      })

    /**
     * Notify all subscribers asynchronously (for Effect contexts).
     * Errors in individual callbacks are logged but don't affect other subscribers.
     */
    const notify = (value: T) =>
      Effect.gen(function* () {
        for (const sub of subscriptions.values()) {
          yield* Effect.try(() => sub.callback(value)).pipe(
            Effect.catchAll((error) =>
              Effect.logWarning("Subscription callback error", { error })
            )
          )
        }
      })

    /**
     * Notify all subscribers synchronously (for non-Effect contexts).
     * Use this when called from plain JavaScript callbacks (e.g., emulator events).
     */
    const notifySync = (value: T) => {
      for (const sub of subscriptions.values()) {
        try {
          sub.callback(value)
        } catch (error) {
          console.warn("Subscription callback error:", error)
        }
      }
    }

    /**
     * Get current subscriber count (for testing/monitoring).
     */
    const getSubscriberCount = () =>
      Effect.sync(() => subscriptions.size)

    return {
      subscribe,
      notify,
      notifySync,
      getSubscriberCount,
    }
  })

/** Type helper for SubscriptionRegistry */
export type SubscriptionRegistry<T> = Effect.Effect.Success<
  ReturnType<typeof makeSubscriptionRegistry<T>>
>
