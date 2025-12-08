/**
 * Clipboard utilities for terminal copy/paste
 * Uses Effect Clipboard service with platform-specific implementations
 */

export {
  copyToClipboard,
  readFromClipboard,
} from '../effect/bridge'
