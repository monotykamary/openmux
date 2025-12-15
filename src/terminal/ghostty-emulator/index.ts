/**
 * GhosttyEmulator module exports.
 * Re-exports the main emulator class and utility functions.
 */

// Main emulator class (re-export from parent for backward compatibility)
export { GhosttyEmulator, initGhostty, getGhostty, isGhosttyInitialized } from '../ghostty-emulator';
export type { GhosttyEmulatorOptions } from '../ghostty-emulator';

// Codepoint utilities
export {
  isValidCodepoint,
  isCjkIdeograph,
  isSpaceLikeChar,
  isZeroWidthChar,
  codepointToChar,
} from './codepoint-utils';

// Cell conversion utilities
export {
  safeRgb,
  createEmptyCell,
  createFillCell,
  convertCell,
  convertLine,
  createEmptyRow,
} from './cell-converter';
export type { RGB } from './cell-converter';

// Scrollback cache
export { ScrollbackCache } from './scrollback-cache';
export type { ScrollbackCacheOptions } from './scrollback-cache';

// Structural sharing
export { RowVersionTracker, StableRowManager } from './structural-sharing';
