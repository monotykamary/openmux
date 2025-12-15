/**
 * KeyboardRouter service
 * Replaces globalThis keyboard handler registration for overlays
 */

import { Context, Effect, Layer, Ref } from "effect"

// =============================================================================
// Types
// =============================================================================

/**
 * Keyboard event shape passed to handlers
 */
export interface KeyEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  sequence?: string;
}

/**
 * Handler function type - returns true if event was handled
 */
export type KeyHandler = (e: KeyEvent) => boolean;

/**
 * Overlay types that can register keyboard handlers
 */
export type OverlayType =
  | 'confirmationDialog'
  | 'sessionPicker'
  | 'aggregateView';

/**
 * Priority determines which handler gets called first
 * Higher priority = earlier in chain
 */
const OVERLAY_PRIORITY: Record<OverlayType, number> = {
  confirmationDialog: 30,  // Highest - modal dialogs take precedence
  sessionPicker: 20,
  aggregateView: 10,
};

// =============================================================================
// Service Definition
// =============================================================================

export class KeyboardRouter extends Context.Tag("@openmux/KeyboardRouter")<
  KeyboardRouter,
  {
    /**
     * Register a keyboard handler for an overlay.
     * Returns an unsubscribe function.
     */
    readonly registerHandler: (
      overlay: OverlayType,
      handler: KeyHandler
    ) => Effect.Effect<() => void>

    /**
     * Route a keyboard event to registered handlers.
     * Returns the overlay that handled the event, or null if not handled.
     */
    readonly routeKey: (
      event: KeyEvent
    ) => Effect.Effect<{ handled: boolean; overlay: OverlayType | null }>

    /**
     * Get the currently active overlay (highest priority with a handler).
     */
    readonly getActiveOverlay: () => Effect.Effect<OverlayType | null>

    /**
     * Check if a specific overlay has a registered handler.
     */
    readonly hasHandler: (
      overlay: OverlayType
    ) => Effect.Effect<boolean>
  }
>() {
  static readonly layer = Layer.effect(
    KeyboardRouter,
    Effect.gen(function* () {
      // Store handlers by overlay type
      const handlersRef = yield* Ref.make<Map<OverlayType, KeyHandler>>(new Map())

      const registerHandler = Effect.fn("KeyboardRouter.registerHandler")(
        function* (overlay: OverlayType, handler: KeyHandler) {
          yield* Ref.update(handlersRef, (map) => {
            const newMap = new Map(map)
            newMap.set(overlay, handler)
            return newMap
          })

          // Return unsubscribe function
          return () => {
            Effect.runSync(
              Ref.update(handlersRef, (map) => {
                const newMap = new Map(map)
                newMap.delete(overlay)
                return newMap
              })
            )
          }
        }
      )

      const routeKey = Effect.fn("KeyboardRouter.routeKey")(
        function* (event: KeyEvent) {
          const handlers = yield* Ref.get(handlersRef)

          // Sort overlays by priority (highest first)
          const sortedOverlays = (Array.from(handlers.keys()) as OverlayType[])
            .sort((a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a])

          // Try each handler in priority order
          for (const overlay of sortedOverlays) {
            const handler = handlers.get(overlay)
            if (handler) {
              const handled = handler(event)
              if (handled) {
                return { handled: true, overlay }
              }
            }
          }

          return { handled: false, overlay: null }
        }
      )

      const getActiveOverlay = Effect.fn("KeyboardRouter.getActiveOverlay")(
        function* () {
          const handlers = yield* Ref.get(handlersRef)

          // Return highest priority overlay with a handler
          const sortedOverlays = (Array.from(handlers.keys()) as OverlayType[])
            .sort((a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a])

          return sortedOverlays[0] ?? null
        }
      )

      const hasHandler = Effect.fn("KeyboardRouter.hasHandler")(
        function* (overlay: OverlayType) {
          const handlers = yield* Ref.get(handlersRef)
          return handlers.has(overlay)
        }
      )

      return KeyboardRouter.of({
        registerHandler,
        routeKey,
        getActiveOverlay,
        hasHandler,
      })
    })
  )
}
