/**
 * Coordinate utilities for terminal selection
 */

export {
  type SelectionPoint,
  type SelectionRange,
  type LineGetter,
  type SelectedColumnRange,
  toAbsoluteY,
  normalizeSelection,
  calculateBounds,
  isCellInRange,
  getSelectedColumnsForRow,
  extractSelectedText,
} from './selection-coords';
