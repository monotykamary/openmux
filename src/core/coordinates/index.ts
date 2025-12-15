/**
 * Coordinate utilities for terminal selection
 */

export {
  type SelectionPoint,
  type SelectionRange,
  type LineGetter,
  toAbsoluteY,
  normalizeSelection,
  calculateBounds,
  isCellInRange,
  extractSelectedText,
} from './selection-coords';
