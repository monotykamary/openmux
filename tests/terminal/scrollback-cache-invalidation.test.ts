/**
 * Tests for scrollback cache invalidation in WorkerEmulator
 *
 * These tests verify that the scrollback cache is properly cleared when:
 * 1. Content shifts (scrollback at limit, old lines evicted) - detected by scrollbackDelta == 0 AND isAtScrollbackLimit
 * 2. Scrollback shrinks (reset scenario) - detected by scrollbackDelta < 0
 *
 * The cache is NOT cleared when:
 * - Scrollback simply grows (offsets remain valid)
 * - Scrollback unchanged but NOT at limit (in-place updates like animations)
 *
 * This prevents flicker when the user is scrolled back viewing history while
 * new content arrives, AND prevents flicker from in-place animations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirtyTerminalUpdate, TerminalCell, TerminalScrollState } from '../../src/core/types';
import type { TerminalColors } from '../../src/terminal/terminal-colors';

// Since WorkerEmulator is tightly coupled to EmulatorWorkerPool,
// we test the cache invalidation logic by creating a minimal test harness
// that mimics the relevant behavior

describe('scrollback-cache-invalidation', () => {
  // Helper to create test cells
  function createTestCell(char: string): TerminalCell {
    return {
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
    };
  }

  // Helper to create a dirty update
  function createDirtyUpdate(
    scrollbackLength: number,
    isAtScrollbackLimit: boolean = false,
    overrides: Partial<DirtyTerminalUpdate> = {}
  ): DirtyTerminalUpdate {
    return {
      dirtyRows: new Map(),
      cursor: { x: 0, y: 0, visible: true, style: 'block' },
      scrollState: {
        viewportOffset: 0,
        scrollbackLength,
        isAtBottom: true,
        isAtScrollbackLimit,
      },
      cols: 80,
      rows: 24,
      isFull: false,
      alternateScreen: false,
      mouseTracking: false,
      cursorKeyMode: 'normal',
      ...overrides,
    };
  }

  describe('smart cache invalidation (only on content shift)', () => {
    it('should NOT clear cache when scrollback grows (offsets remain valid)', () => {
      // Simulate the smart cache invalidation logic from WorkerEmulator.handleUpdate()
      // When scrollback grows, existing cached lines at their absolute offsets are still valid
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 0;

      // Populate cache with some entries
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);
      scrollbackCache.set(2, [createTestCell('C')]);

      expect(scrollbackCache.size).toBe(3);

      // Simulate update with new scrollback length (growth)
      const update = createDirtyUpdate(10);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache should be PRESERVED - scrollback grew, offsets still valid
      expect(scrollbackCache.size).toBe(3);
      expect(lastScrollbackLength).toBe(10);
    });

    it('should clear cache when at scrollback limit (content shifts, delta = 0)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 2000; // At limit

      // Populate cache - these entries will become stale when content shifts
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(1, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Simulate update with same scrollback length (at limit, old lines evicted)
      // Note: isAtScrollbackLimit = true because we're at the 2000 line limit
      const update = createDirtyUpdate(2000, true);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache should be cleared - content shifted, offsets now point to different lines
      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(2000);
    });

    it('should NOT clear cache when scrollback unchanged but NOT at limit (in-place animation)', () => {
      // This is the key fix for flickering during animations like Claude Code's spinner
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100; // NOT at limit

      // Populate cache
      scrollbackCache.set(0, [createTestCell('A')]);
      scrollbackCache.set(50, [createTestCell('B')]);

      expect(scrollbackCache.size).toBe(2);

      // Simulate update with same scrollback length but NOT at limit
      // This happens when content updates in place (animations, cursor movement)
      const update = createDirtyUpdate(100, false); // isAtScrollbackLimit = false
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      // scrollbackDelta = 0, but NOT at limit, so contentShifted = false
      expect(scrollbackDelta).toBe(0);
      expect(isAtScrollbackLimit).toBe(false);
      expect(contentShifted).toBe(false);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache should be PRESERVED - just in-place updates, content didn't shift
      expect(scrollbackCache.size).toBe(2);
      expect(lastScrollbackLength).toBe(100);
    });

    it('should clear cache when scrollback decreases (reset scenario)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache
      scrollbackCache.set(50, [createTestCell('X')]);
      scrollbackCache.set(75, [createTestCell('Y')]);

      // Simulate reset - scrollback drops to 0
      const update = createDirtyUpdate(0);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(0);
    });
  });

  describe('cache preservation when scrolled back', () => {
    it('should preserve cache when scrolled back and new content arrives', () => {
      // When user is scrolled back viewing history, cache should be preserved
      // as new content is added (scrollback grows)
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache with valid entries
      scrollbackCache.set(25, [createTestCell('X')]);
      scrollbackCache.set(50, [createTestCell('Y')]);

      expect(scrollbackCache.size).toBe(2);

      // New update with increased scrollback (scrollback grew, user scrolled back)
      const update = createDirtyUpdate(150);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache preserved - scrollback grew, offsets still valid
      expect(scrollbackCache.size).toBe(2);
      expect(lastScrollbackLength).toBe(150);
    });

    it('should handle scrollback at limit where length unchanged but content shifted', () => {
      // This simulates the edge case where scrollback is at limit (2000 lines)
      // New lines are added, old lines evicted, but length stays at 2000
      // The smart invalidation detects this via scrollbackDelta = 0 AND isAtScrollbackLimit
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 2000; // At limit

      // Cache contains entries that are now stale (content shifted)
      scrollbackCache.set(0, [createTestCell('OLD_LINE_0')]);
      scrollbackCache.set(100, [createTestCell('OLD_LINE_100')]);

      expect(scrollbackCache.size).toBe(2);

      // Length unchanged (at limit) AND isAtScrollbackLimit = true
      const update = createDirtyUpdate(2000, true);
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      // scrollbackDelta = 0, isAtScrollbackLimit = true, so contentShifted = true
      expect(scrollbackDelta).toBe(0);
      expect(isAtScrollbackLimit).toBe(true);
      expect(contentShifted).toBe(true);

      if (contentShifted) {
        scrollbackCache.clear();
      }
      lastScrollbackLength = update.scrollState.scrollbackLength;

      // Cache cleared - content shifted, offsets now invalid
      expect(scrollbackCache.size).toBe(0);
    });
  });

  describe('rapid animation updates (Claude Code spinner scenario)', () => {
    it('should preserve cache across many rapid updates when NOT at scrollback limit', () => {
      // This test simulates the Claude Code scenario where animated content
      // (like a thinking spinner) causes many rapid terminal updates.
      // The cache should NOT be cleared on each frame since we're not at the
      // scrollback limit - just updating content in place.
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 500; // Some scrollback, but not at limit

      // Populate cache (user is scrolled back viewing history)
      scrollbackCache.set(100, [createTestCell('history line 100')]);
      scrollbackCache.set(200, [createTestCell('history line 200')]);
      scrollbackCache.set(300, [createTestCell('history line 300')]);

      expect(scrollbackCache.size).toBe(3);

      // Simulate 100 rapid animation frames (spinner updates)
      // Each update has same scrollback length, NOT at limit
      for (let frame = 0; frame < 100; frame++) {
        const update = createDirtyUpdate(500, false); // NOT at limit
        const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
        const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
        const contentShifted = scrollbackDelta < 0 ||
          (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

        if (contentShifted) {
          scrollbackCache.clear();
        }
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      // Cache should be PRESERVED across all 100 frames
      // This is the key behavior that prevents flickering
      expect(scrollbackCache.size).toBe(3);
      expect(scrollbackCache.get(100)?.[0].char).toBe('history line 100');
    });

    it('should clear cache when animation runs while AT scrollback limit', () => {
      // When scrollback IS at the limit, each update means content shifted
      // (old lines evicted, new lines added) - cache must be cleared
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 2000; // AT the limit

      // Populate cache
      scrollbackCache.set(0, [createTestCell('line 0')]);
      scrollbackCache.set(1000, [createTestCell('line 1000')]);

      expect(scrollbackCache.size).toBe(2);

      // Single update at limit - content has shifted
      const update = createDirtyUpdate(2000, true); // AT limit
      const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      expect(contentShifted).toBe(true);

      if (contentShifted) {
        scrollbackCache.clear();
      }

      // Cache should be cleared - content shifted at limit
      expect(scrollbackCache.size).toBe(0);
    });

    it('should handle transition from not-at-limit to at-limit during session', () => {
      // Simulates a long-running session where scrollback grows to limit
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 0;

      // Phase 1: Scrollback growing (not at limit yet)
      for (let i = 0; i < 10; i++) {
        const newLength = (i + 1) * 100; // 100, 200, 300, ... 1000
        const update = createDirtyUpdate(newLength, false);
        const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
        const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
        const contentShifted = scrollbackDelta < 0 ||
          (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

        // Add to cache as we go
        scrollbackCache.set(newLength - 50, [createTestCell(`line at ${newLength - 50}`)]);

        if (contentShifted) {
          scrollbackCache.clear();
        }
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      // Cache should have 10 entries from growth phase
      expect(scrollbackCache.size).toBe(10);
      expect(lastScrollbackLength).toBe(1000);

      // Phase 2: More updates while growing to limit
      for (let i = 0; i < 10; i++) {
        const newLength = 1000 + (i + 1) * 100; // 1100, 1200, ... 2000
        const atLimit = newLength >= 2000;
        const update = createDirtyUpdate(newLength, atLimit);
        const scrollbackDelta = update.scrollState.scrollbackLength - lastScrollbackLength;
        const isAtScrollbackLimit = update.scrollState.isAtScrollbackLimit ?? false;
        const contentShifted = scrollbackDelta < 0 ||
          (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

        scrollbackCache.set(newLength - 50, [createTestCell(`line at ${newLength - 50}`)]);

        if (contentShifted) {
          scrollbackCache.clear();
        }
        lastScrollbackLength = update.scrollState.scrollbackLength;
      }

      // Cache should have 20 entries (still growing, no clearing)
      expect(scrollbackCache.size).toBe(20);
      expect(lastScrollbackLength).toBe(2000);

      // Phase 3: Now at limit - next update should clear cache
      const finalUpdate = createDirtyUpdate(2000, true);
      const scrollbackDelta = finalUpdate.scrollState.scrollbackLength - lastScrollbackLength;
      const isAtScrollbackLimit = finalUpdate.scrollState.isAtScrollbackLimit ?? false;
      const contentShifted = scrollbackDelta < 0 ||
        (scrollbackDelta === 0 && isAtScrollbackLimit && lastScrollbackLength > 0);

      expect(scrollbackDelta).toBe(0);
      expect(isAtScrollbackLimit).toBe(true);
      expect(contentShifted).toBe(true);

      if (contentShifted) {
        scrollbackCache.clear();
      }

      // Cache cleared - at limit and content shifted
      expect(scrollbackCache.size).toBe(0);
    });
  });

  describe('packed cache invalidation', () => {
    it('should clear packed cache when scrollback length changes', () => {
      // Simulates packed scrollback cache invalidation after new output.
      let scrollbackCache = new Map<number, ArrayBuffer>();
      let lastScrollbackLength = 50;

      // Simulate cached packed cells
      scrollbackCache.set(0, new ArrayBuffer(16));
      scrollbackCache.set(10, new ArrayBuffer(16));
      scrollbackCache.set(20, new ArrayBuffer(16));

      expect(scrollbackCache.size).toBe(3);

      // Simulate: terminal.getScrollbackLength() returns new value after write
      const currentScrollbackLength = 100;

      if (currentScrollbackLength !== lastScrollbackLength) {
        scrollbackCache.clear();
        lastScrollbackLength = currentScrollbackLength;
      }

      expect(scrollbackCache.size).toBe(0);
      expect(lastScrollbackLength).toBe(100);
    });

    it('should preserve packed cache when scrollback length unchanged', () => {
      let scrollbackCache = new Map<number, ArrayBuffer>();
      let lastScrollbackLength = 100;

      scrollbackCache.set(0, new ArrayBuffer(16));
      scrollbackCache.set(10, new ArrayBuffer(16));

      const currentScrollbackLength = 100; // Unchanged

      if (currentScrollbackLength !== lastScrollbackLength) {
        scrollbackCache.clear();
        lastScrollbackLength = currentScrollbackLength;
      }

      expect(scrollbackCache.size).toBe(2);
    });
  });
});
