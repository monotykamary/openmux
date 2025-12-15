/**
 * Row version tracking for efficient React change detection.
 * Uses structural sharing to minimize re-renders - unchanged rows keep the same reference.
 */

import type { TerminalCell } from '../../core/types';

/**
 * Tracks row versions for efficient change detection.
 * Each row has a version number that increments when the row changes.
 * A global version tracks overall terminal state changes.
 */
export class RowVersionTracker {
  private rowVersions: number[] = [];
  private globalVersion = 0;

  /**
   * Create a new row version tracker.
   *
   * @param rows - Initial number of rows
   */
  constructor(rows: number) {
    this.rowVersions = new Array(rows).fill(0);
  }

  /**
   * Get the version number for a specific row.
   *
   * @param row - Row index
   * @returns Version number, or 0 if out of bounds
   */
  getVersion(row: number): number {
    return this.rowVersions[row] ?? 0;
  }

  /**
   * Get all row versions.
   *
   * @returns Array of version numbers
   */
  getAllVersions(): number[] {
    return this.rowVersions;
  }

  /**
   * Increment the version for a specific row.
   * Also increments the global version.
   *
   * @param row - Row index to increment
   */
  incrementVersion(row: number): void {
    if (row >= 0 && row < this.rowVersions.length) {
      this.rowVersions[row]++;
      this.globalVersion++;
    }
  }

  /**
   * Increment only the global version.
   */
  incrementGlobal(): void {
    this.globalVersion++;
  }

  /**
   * Get the global version number.
   *
   * @returns Global version number
   */
  getGlobalVersion(): number {
    return this.globalVersion;
  }

  /**
   * Resize the tracker for a new number of rows.
   * Resets all row versions to 0 and increments global version.
   *
   * @param newRows - New number of rows
   */
  resize(newRows: number): void {
    this.rowVersions = new Array(newRows).fill(0);
    this.globalVersion++;
  }

  /**
   * Mark all rows as changed (increment all versions).
   * Used after full refresh events.
   */
  markAllDirty(): void {
    for (let i = 0; i < this.rowVersions.length; i++) {
      this.rowVersions[i]++;
    }
    this.globalVersion++;
  }
}

/**
 * Manages stable row references for React structural sharing.
 * When a row changes, it gets a new array reference.
 * Unchanged rows keep the same reference, enabling React.memo optimization.
 */
export class StableRowManager {
  private rows: TerminalCell[][] = [];
  private versionTracker: RowVersionTracker;

  /**
   * Create a new stable row manager.
   *
   * @param rowCount - Initial number of rows
   */
  constructor(rowCount: number) {
    this.rows = new Array(rowCount).fill(null).map(() => []);
    this.versionTracker = new RowVersionTracker(rowCount);
  }

  /**
   * Get a stable row reference.
   *
   * @param row - Row index
   * @returns Row array or null if out of bounds
   */
  getRow(row: number): TerminalCell[] | null {
    return this.rows[row] ?? null;
  }

  /**
   * Get all stable rows.
   *
   * @returns Array of row arrays
   */
  getAllRows(): TerminalCell[][] {
    return this.rows;
  }

  /**
   * Update a row with new content.
   * Creates a new array reference (for React change detection).
   *
   * @param row - Row index
   * @param cells - New cell array
   */
  updateRow(row: number, cells: TerminalCell[]): void {
    if (row >= 0 && row < this.rows.length) {
      this.rows[row] = cells;
      this.versionTracker.incrementVersion(row);
    }
  }

  /**
   * Replace all rows (e.g., after resize or full refresh).
   *
   * @param newRows - New row arrays
   */
  replaceAll(newRows: TerminalCell[][]): void {
    this.rows = newRows;
    this.versionTracker.markAllDirty();
  }

  /**
   * Resize the manager for new dimensions.
   *
   * @param newRowCount - New number of rows
   */
  resize(newRowCount: number): void {
    this.rows = new Array(newRowCount).fill(null).map(() => []);
    this.versionTracker.resize(newRowCount);
  }

  /**
   * Get the version tracker.
   *
   * @returns The row version tracker
   */
  getVersionTracker(): RowVersionTracker {
    return this.versionTracker;
  }

  /**
   * Get row versions for React memoization.
   *
   * @returns Array of version numbers
   */
  getRowVersions(): number[] {
    return this.versionTracker.getAllVersions();
  }
}
