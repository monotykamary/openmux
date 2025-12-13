/**
 * Tests for scroll utility functions.
 * These tests ensure scroll clamping prevents momentum accumulation at boundaries.
 */
import { describe, expect, it } from 'vitest';
import {
  clampScrollOffset,
  calculateScrollDelta,
  isAtBottom,
  isAtTop,
} from '../../src/core/scroll-utils';

describe('scroll-utils', () => {
  describe('clampScrollOffset', () => {
    it('clamps negative offsets to 0', () => {
      expect(clampScrollOffset(-10, 100)).toBe(0);
      expect(clampScrollOffset(-1, 100)).toBe(0);
      expect(clampScrollOffset(-1000, 50)).toBe(0);
    });

    it('clamps offsets exceeding maxOffset', () => {
      expect(clampScrollOffset(150, 100)).toBe(100);
      expect(clampScrollOffset(101, 100)).toBe(100);
      expect(clampScrollOffset(1000, 50)).toBe(50);
    });

    it('preserves valid offsets within range', () => {
      expect(clampScrollOffset(0, 100)).toBe(0);
      expect(clampScrollOffset(50, 100)).toBe(50);
      expect(clampScrollOffset(100, 100)).toBe(100);
    });

    it('handles zero maxOffset (no scrollback)', () => {
      expect(clampScrollOffset(0, 0)).toBe(0);
      expect(clampScrollOffset(10, 0)).toBe(0);
      expect(clampScrollOffset(-5, 0)).toBe(0);
    });

    it('handles edge case of exactly at boundaries', () => {
      expect(clampScrollOffset(0, 100)).toBe(0);
      expect(clampScrollOffset(100, 100)).toBe(100);
    });
  });

  describe('calculateScrollDelta', () => {
    const scrollbackLength = 100;

    describe('scrolling up (positive delta)', () => {
      it('increases offset when not at top', () => {
        expect(calculateScrollDelta(0, 3, scrollbackLength)).toBe(3);
        expect(calculateScrollDelta(50, 3, scrollbackLength)).toBe(53);
      });

      it('clamps at scrollback limit (prevents momentum accumulation)', () => {
        // This is the key test for the momentum bug fix
        expect(calculateScrollDelta(100, 3, scrollbackLength)).toBe(100);
        expect(calculateScrollDelta(98, 3, scrollbackLength)).toBe(100);
        expect(calculateScrollDelta(99, 10, scrollbackLength)).toBe(100);
      });

      it('handles rapid scrolling at top boundary', () => {
        // Simulating rapid scroll events at top - offset should stay clamped
        let offset = 100;
        for (let i = 0; i < 10; i++) {
          offset = calculateScrollDelta(offset, 3, scrollbackLength);
        }
        expect(offset).toBe(100); // Should not exceed scrollbackLength
      });
    });

    describe('scrolling down (negative delta)', () => {
      it('decreases offset when not at bottom', () => {
        expect(calculateScrollDelta(100, -3, scrollbackLength)).toBe(97);
        expect(calculateScrollDelta(50, -3, scrollbackLength)).toBe(47);
      });

      it('clamps at 0 (prevents negative offset)', () => {
        expect(calculateScrollDelta(0, -3, scrollbackLength)).toBe(0);
        expect(calculateScrollDelta(2, -3, scrollbackLength)).toBe(0);
        expect(calculateScrollDelta(1, -10, scrollbackLength)).toBe(0);
      });

      it('handles rapid scrolling at bottom boundary', () => {
        // Simulating rapid scroll events at bottom - offset should stay at 0
        let offset = 0;
        for (let i = 0; i < 10; i++) {
          offset = calculateScrollDelta(offset, -3, scrollbackLength);
        }
        expect(offset).toBe(0); // Should not go negative
      });
    });

    describe('rapid direction changes', () => {
      it('responds immediately when reversing at top', () => {
        // At top (offset = scrollbackLength), scroll up should stay clamped
        let offset = calculateScrollDelta(100, 3, scrollbackLength);
        expect(offset).toBe(100);

        // Immediately scroll down - should decrease immediately (no momentum lag)
        offset = calculateScrollDelta(offset, -3, scrollbackLength);
        expect(offset).toBe(97);
      });

      it('responds immediately when reversing at bottom', () => {
        // At bottom (offset = 0), scroll down should stay clamped
        let offset = calculateScrollDelta(0, -3, scrollbackLength);
        expect(offset).toBe(0);

        // Immediately scroll up - should increase immediately (no momentum lag)
        offset = calculateScrollDelta(offset, 3, scrollbackLength);
        expect(offset).toBe(3);
      });

      it('handles alternating rapid scrolls without drift', () => {
        const scrollbackLength = 100;
        let offset = 50;

        // Rapid alternating scrolls should not cause drift
        for (let i = 0; i < 100; i++) {
          offset = calculateScrollDelta(offset, 3, scrollbackLength);
          offset = calculateScrollDelta(offset, -3, scrollbackLength);
        }

        // Should be back where we started
        expect(offset).toBe(50);
      });
    });

    describe('edge cases', () => {
      it('handles zero delta', () => {
        expect(calculateScrollDelta(50, 0, 100)).toBe(50);
      });

      it('handles zero scrollback length', () => {
        expect(calculateScrollDelta(0, 3, 0)).toBe(0);
        expect(calculateScrollDelta(0, -3, 0)).toBe(0);
      });

      it('handles large deltas', () => {
        expect(calculateScrollDelta(50, 1000, 100)).toBe(100);
        expect(calculateScrollDelta(50, -1000, 100)).toBe(0);
      });
    });
  });

  describe('isAtBottom', () => {
    it('returns true when offset is 0', () => {
      expect(isAtBottom(0)).toBe(true);
    });

    it('returns true for negative offset (edge case)', () => {
      expect(isAtBottom(-1)).toBe(true);
    });

    it('returns false when scrolled back', () => {
      expect(isAtBottom(1)).toBe(false);
      expect(isAtBottom(100)).toBe(false);
    });
  });

  describe('isAtTop', () => {
    it('returns true when offset equals scrollbackLength', () => {
      expect(isAtTop(100, 100)).toBe(true);
    });

    it('returns true when offset exceeds scrollbackLength (edge case)', () => {
      expect(isAtTop(150, 100)).toBe(true);
    });

    it('returns false when not fully scrolled back', () => {
      expect(isAtTop(0, 100)).toBe(false);
      expect(isAtTop(50, 100)).toBe(false);
      expect(isAtTop(99, 100)).toBe(false);
    });

    it('returns true when scrollbackLength is 0 and offset is 0', () => {
      expect(isAtTop(0, 0)).toBe(true);
    });
  });

  describe('momentum accumulation prevention', () => {
    /**
     * This test suite specifically validates the fix for the momentum bug.
     * The bug: when scrolling fast at boundaries, the offset would accumulate
     * beyond limits, requiring many reverse scrolls before the viewport moved.
     */

    it('does not accumulate momentum when scrolling up at top', () => {
      const scrollbackLength = 100;
      let offset = 100; // At top

      // Simulate 50 rapid scroll-up events (like fast mouse wheel)
      for (let i = 0; i < 50; i++) {
        offset = calculateScrollDelta(offset, 3, scrollbackLength);
      }

      // Offset should be exactly at the limit, not 100 + (50 * 3) = 250
      expect(offset).toBe(100);

      // First scroll down should immediately move viewport
      offset = calculateScrollDelta(offset, -3, scrollbackLength);
      expect(offset).toBe(97);
    });

    it('does not accumulate momentum when scrolling down at bottom', () => {
      const scrollbackLength = 100;
      let offset = 0; // At bottom

      // Simulate 50 rapid scroll-down events
      for (let i = 0; i < 50; i++) {
        offset = calculateScrollDelta(offset, -3, scrollbackLength);
      }

      // Offset should be exactly 0, not 0 - (50 * 3) = -150
      expect(offset).toBe(0);

      // First scroll up should immediately move viewport
      offset = calculateScrollDelta(offset, 3, scrollbackLength);
      expect(offset).toBe(3);
    });
  });
});
