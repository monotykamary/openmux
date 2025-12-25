/**
 * Tests for scrollback render guard logic.
 */

import { describe, it, expect } from 'vitest';
import type { TerminalCell } from '../../src/core/types';
import { guardScrollbackRender } from '../../src/components/terminal-view/scrollback-guard';

const createCell = (char: string): TerminalCell => ({
  char,
  fg: { r: 255, g: 255, b: 255 },
  bg: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  blink: false,
  dim: false,
  width: 1,
});

const createRow = (char: string): TerminalCell[] => [createCell(char)];

describe('scrollback-guard', () => {
  it('uses recentRows fallback to avoid missing scrollback rows', () => {
    const rows = 3;
    const desiredScrollbackLength = 10;
    const desiredViewportOffset = 5;
    const desiredRowCache = [createRow('A'), null, createRow('C')];
    const recentRows = new Map<number, TerminalCell[]>();
    recentRows.set(6, createRow('B'));

    const result = guardScrollbackRender({
      desiredViewportOffset,
      desiredScrollbackLength,
      rows,
      desiredRowCache,
      recentRows,
      lastStableViewportOffset: desiredViewportOffset,
      lastStableScrollbackLength: desiredScrollbackLength,
      lastObservedViewportOffset: desiredViewportOffset,
      lastObservedScrollbackLength: desiredScrollbackLength,
    });

    expect(result.hasMissingScrollback).toBe(false);
    expect(result.shouldDefer).toBe(false);
    expect(result.renderRowCache[1]?.[0]?.char).toBe('B');
  });

  it('defers when scrolled back and scrollback rows are missing', () => {
    const rows = 3;
    const desiredScrollbackLength = 10;
    const desiredViewportOffset = 5;
    const desiredRowCache = [createRow('A'), null, createRow('C')];

    const result = guardScrollbackRender({
      desiredViewportOffset,
      desiredScrollbackLength,
      rows,
      desiredRowCache,
      recentRows: new Map(),
      lastStableViewportOffset: 3,
      lastStableScrollbackLength: 8,
      lastObservedViewportOffset: 3,
      lastObservedScrollbackLength: 8,
    });

    expect(result.hasMissingScrollback).toBe(true);
    expect(result.shouldDefer).toBe(true);
    expect(result.renderViewportOffset).toBe(3);
    expect(result.renderScrollbackLength).toBe(8);
  });

  it('detects non-user scroll when viewport offset tracks scrollback growth', () => {
    const rows = 3;
    const desiredScrollbackLength = 12;
    const desiredViewportOffset = 7;
    const desiredRowCache = [createRow('A'), createRow('B'), createRow('C')];

    const result = guardScrollbackRender({
      desiredViewportOffset,
      desiredScrollbackLength,
      rows,
      desiredRowCache,
      recentRows: new Map(),
      lastStableViewportOffset: 5,
      lastStableScrollbackLength: 10,
      lastObservedViewportOffset: 5,
      lastObservedScrollbackLength: 10,
    });

    expect(result.isUserScroll).toBe(false);
    expect(result.shouldDefer).toBe(false);
  });

  it('detects user scroll when viewport offset diverges from expected delta', () => {
    const rows = 3;
    const desiredScrollbackLength = 12;
    const desiredViewportOffset = 6;
    const desiredRowCache = [createRow('A'), createRow('B'), createRow('C')];

    const result = guardScrollbackRender({
      desiredViewportOffset,
      desiredScrollbackLength,
      rows,
      desiredRowCache,
      recentRows: new Map(),
      lastStableViewportOffset: 5,
      lastStableScrollbackLength: 10,
      lastObservedViewportOffset: 5,
      lastObservedScrollbackLength: 10,
    });

    expect(result.isUserScroll).toBe(true);
  });
});
