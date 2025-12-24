/**
 * Tests for OSC stripping used by ghostty-vt emulator.
 */

import { describe, it, expect } from "vitest";
import { stripProblematicOscSequences } from "../../src/terminal/ghostty-vt/osc-stripping";

describe("stripProblematicOscSequences", () => {
  const ESC = "\x1b";
  const BEL = "\x07";

  it("strips title and color set sequences", () => {
    const input = `A${ESC}]0;title${BEL}B${ESC}]10;#ffffff${BEL}C`;
    expect(stripProblematicOscSequences(input)).toBe("ABC");
  });

  it("preserves color query sequences", () => {
    const input = `A${ESC}]10;?${BEL}B`;
    expect(stripProblematicOscSequences(input)).toBe(input);
  });
});
