/**
 * KeyboardRouter - Simple keyboard handler registration for overlays
 * Plain TypeScript implementation - no Effect overhead needed for this simple state
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Keyboard event shape passed to handlers
 */
export interface KeyEvent {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  sequence?: string
}

/**
 * Handler function type - returns true if event was handled
 */
export type KeyHandler = (e: KeyEvent) => boolean

/**
 * Overlay types that can register keyboard handlers
 */
export type OverlayType = "confirmationDialog" | "commandPalette" | "sessionPicker" | "aggregateView"

/**
 * Priority determines which handler gets called first
 * Higher priority = earlier in chain
 */
const OVERLAY_PRIORITY: Record<OverlayType, number> = {
  confirmationDialog: 30, // Highest - modal dialogs take precedence
  commandPalette: 25,
  sessionPicker: 20,
  aggregateView: 10,
}

// =============================================================================
// KeyboardRouter singleton
// =============================================================================

// Use a plain Map for simple state
const handlers = new Map<OverlayType, KeyHandler>()

/**
 * Register a keyboard handler for an overlay.
 * Returns an unsubscribe function.
 */
export function registerHandler(overlay: OverlayType, handler: KeyHandler): () => void {
  handlers.set(overlay, handler)
  return () => {
    handlers.delete(overlay)
  }
}

/**
 * Route a keyboard event to registered handlers.
 * Returns the overlay that handled the event, or null if not handled.
 */
export function routeKey(event: KeyEvent): { handled: boolean; overlay: OverlayType | null } {
  // Sort overlays by priority (highest first)
  const sortedOverlays = (Array.from(handlers.keys()) as OverlayType[]).sort(
    (a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a]
  )

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

/**
 * Get the currently active overlay (highest priority with a handler).
 */
export function getActiveOverlay(): OverlayType | null {
  const sortedOverlays = (Array.from(handlers.keys()) as OverlayType[]).sort(
    (a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a]
  )
  return sortedOverlays[0] ?? null
}

/**
 * Check if a specific overlay has a registered handler.
 */
export function hasHandler(overlay: OverlayType): boolean {
  return handlers.has(overlay)
}

/**
 * Clear all handlers (useful for testing)
 */
export function clearAllHandlers(): void {
  handlers.clear()
}
