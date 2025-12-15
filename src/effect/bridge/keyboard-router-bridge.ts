/**
 * KeyboardRouter bridge functions
 * Wraps Effect KeyboardRouter service for async/await usage
 */

import { Effect } from "effect"
import { runEffect, runEffectSync } from "../runtime"
import { KeyboardRouter, type KeyEvent, type KeyHandler, type OverlayType } from "../services"

// Re-export types
export type { KeyEvent, KeyHandler, OverlayType }

/**
 * Register a keyboard handler for an overlay.
 * Returns an unsubscribe function.
 */
export async function registerKeyboardHandler(
  overlay: OverlayType,
  handler: KeyHandler
): Promise<() => void> {
  return runEffect(
    Effect.gen(function* () {
      const router = yield* KeyboardRouter
      return yield* router.registerHandler(overlay, handler)
    })
  )
}

/**
 * Route a keyboard event to registered handlers.
 * Returns the overlay that handled the event, or null if not handled.
 */
export async function routeKeyboardEvent(
  event: KeyEvent
): Promise<{ handled: boolean; overlay: OverlayType | null }> {
  return runEffect(
    Effect.gen(function* () {
      const router = yield* KeyboardRouter
      return yield* router.routeKey(event)
    })
  )
}

/**
 * Route a keyboard event synchronously.
 * Use this in keyboard handlers where async is not possible.
 */
export function routeKeyboardEventSync(
  event: KeyEvent
): { handled: boolean; overlay: OverlayType | null } {
  return runEffectSync(
    Effect.gen(function* () {
      const router = yield* KeyboardRouter
      return yield* router.routeKey(event)
    })
  )
}

/**
 * Get the currently active overlay.
 */
export async function getActiveOverlay(): Promise<OverlayType | null> {
  return runEffect(
    Effect.gen(function* () {
      const router = yield* KeyboardRouter
      return yield* router.getActiveOverlay()
    })
  )
}

/**
 * Check if a specific overlay has a registered handler.
 */
export async function hasKeyboardHandler(
  overlay: OverlayType
): Promise<boolean> {
  return runEffect(
    Effect.gen(function* () {
      const router = yield* KeyboardRouter
      return yield* router.hasHandler(overlay)
    })
  )
}
