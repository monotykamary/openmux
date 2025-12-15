/**
 * Clipboard bridge functions
 * Wraps Effect Clipboard service for async/await usage
 */

import { Effect } from "effect"
import { runEffect } from "../runtime"
import { Clipboard } from "../services"

/**
 * Copy text to clipboard using Effect service.
 * Drop-in replacement for utils/clipboard.ts copyToClipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await runEffect(
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        yield* clipboard.write(text)
      })
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read text from clipboard using Effect service.
 * Drop-in replacement for utils/clipboard.ts readFromClipboard
 */
export async function readFromClipboard(): Promise<string | null> {
  try {
    return await runEffect(
      Effect.gen(function* () {
        const clipboard = yield* Clipboard
        return yield* clipboard.read()
      })
    )
  } catch {
    return null
  }
}
