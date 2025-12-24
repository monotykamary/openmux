#!/usr/bin/env bun
/**
 * Standalone ghostty-vt test - bypasses OpenTUI entirely
 * Run: bun scripts/test-ghostty-raw.ts
 *
 * This script tests what libghostty-vt's native VT parser actually outputs,
 * helping determine if defensive code in ghostty-emulator.ts is necessary
 * or if rendering issues are in the OpenTUI layer.
 */

import { CellFlags, GhosttyVtTerminal, type GhosttyCell } from '../src/terminal/ghostty-vt';

// Standard xterm-256 palette (first 16 colors)
const PALETTE = [
  0x000000, 0xcd0000, 0x00cd00, 0xcdcd00,
  0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5,
  0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00,
  0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff,
];

function formatCell(cell: GhosttyCell, x: number): string {
  const flags: string[] = [];
  if (cell.flags & CellFlags.BOLD) flags.push('B');
  if (cell.flags & CellFlags.ITALIC) flags.push('I');
  if (cell.flags & CellFlags.UNDERLINE) flags.push('U');
  if (cell.flags & CellFlags.INVERSE) flags.push('R');
  if (cell.flags & CellFlags.INVISIBLE) flags.push('H');
  if (cell.flags & CellFlags.FAINT) flags.push('D');

  let char: string;
  try {
    char = cell.codepoint > 0 ? String.fromCodePoint(cell.codepoint) : ' ';
  } catch {
    char = '\uFFFD'; // replacement char for invalid
  }

  // Escape for display
  const displayChar = char === ' ' ? '\u2423' : // ␣
                      char === '\t' ? '\u2192' : // →
                      char === '\0' ? '\u2400' : // ␀
                      char;

  return `[${x.toString().padStart(2)}] ` +
    `cp=0x${cell.codepoint.toString(16).padStart(5, '0')} ` +
    `'${displayChar}' w=${cell.width} ` +
    `fg=(${cell.fg_r.toString().padStart(3)},${cell.fg_g.toString().padStart(3)},${cell.fg_b.toString().padStart(3)}) ` +
    `bg=(${cell.bg_r.toString().padStart(3)},${cell.bg_g.toString().padStart(3)},${cell.bg_b.toString().padStart(3)}) ` +
    `${flags.join('') || '-'}`;
}

function analyzeResults(name: string, line: GhosttyCell[]): string[] {
  const issues: string[] = [];

  for (let x = 0; x < line.length; x++) {
    const cell = line[x];
    const cp = cell.codepoint;

    // Check for potential issues
    if (cp === 0xFFFD) {
      issues.push(`  [${x}] Contains replacement char U+FFFD`);
    }
    if (cp >= 0xD800 && cp <= 0xDFFF) {
      issues.push(`  [${x}] Contains surrogate U+${cp.toString(16).toUpperCase()}`);
    }
    if (cp > 0 && cp < 0x20 && cp !== 0x09 && cp !== 0x0A && cp !== 0x0D) {
      issues.push(`  [${x}] Contains C0 control 0x${cp.toString(16).padStart(2, '0')}`);
    }
    if (cp >= 0x80 && cp <= 0x9F) {
      issues.push(`  [${x}] Contains C1 control 0x${cp.toString(16).padStart(2, '0')}`);
    }
    if (cp >= 0x4E00 && cp <= 0x9FFF && cell.width !== 2) {
      issues.push(`  [${x}] CJK ideograph U+${cp.toString(16).toUpperCase()} has width=${cell.width} (should be 2)`);
    }
    if (cp >= 0x1F600 && cp <= 0x1F64F && cell.width !== 2) {
      issues.push(`  [${x}] Emoji U+${cp.toString(16).toUpperCase()} has width=${cell.width} (should be 2)`);
    }
    // Check for NaN in RGB
    if (Number.isNaN(cell.fg_r) || Number.isNaN(cell.fg_g) || Number.isNaN(cell.fg_b)) {
      issues.push(`  [${x}] NaN in foreground color`);
    }
    if (Number.isNaN(cell.bg_r) || Number.isNaN(cell.bg_g) || Number.isNaN(cell.bg_b)) {
      issues.push(`  [${x}] NaN in background color`);
    }
  }

  return issues;
}

function getLine(term: GhosttyVtTerminal, row: number): GhosttyCell[] | null {
  term.update();
  const viewport = term.getViewport();
  if (viewport.length === 0) return null;
  const start = row * term.cols;
  return viewport.slice(start, start + term.cols);
}

async function main() {
  console.log('=== ghostty-vt Raw Cell Test ===');
  console.log('Testing native VT parser output directly (no OpenTUI)\n');

  const term = new GhosttyVtTerminal(80, 24, {
    scrollbackLimit: 100,
    fgColor: 0xffffff,
    bgColor: 0x000000,
    palette: PALETTE,
  });

  // Test cases grouped by category
  const tests = [
    // Basic
    { name: 'Plain ASCII', data: 'Hello World' },
    { name: 'ANSI Bold Red', data: '\x1b[1;31mBold Red\x1b[0m' },
    { name: '256 color', data: '\x1b[38;5;196mRed 196\x1b[0m' },
    { name: 'True color', data: '\x1b[38;2;255;128;0mOrange\x1b[0m' },

    // Wide characters
    { name: 'Emoji (width=2)', data: '\uD83D\uDC4D\uD83C\uDF89\uD83D\uDE80' }, // 👍🎉🚀
    { name: 'CJK (width=2)', data: '\u4F60\u597D\u4E16\u754C' }, // 你好世界
    { name: 'Mixed emoji+text', data: 'Hi \uD83D\uDC4B there' }, // Hi 👋 there

    // Complex Unicode
    { name: 'Zero-width joiner', data: '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67' }, // 👨‍👩‍👧
    { name: 'Variation selector', data: '\u263A\uFE0F' }, // ☺️
    { name: 'Combining acute', data: 'e\u0301' }, // é as e + combining acute
    { name: 'Precomposed e-acute', data: '\u00E9' }, // é precomposed

    // Box drawing / symbols
    { name: 'Box drawing', data: '\u250C\u2500\u2510\u2502 \u2502\u2514\u2500\u2518' },
    { name: 'Nerd font (PUA)', data: '\uE0A0 \uE0B0' },
    { name: 'Powerline', data: '\uE0B0\uE0B1\uE0B2\uE0B3' },

    // Edge cases - control characters
    { name: 'C0 controls', data: 'A\x00B\x01C\x1FD' },
    { name: 'DEL char', data: 'A\x7FB' },
    { name: 'C1 controls', data: 'A\x80B\x9FC' },

    // Edge cases - invalid Unicode
    { name: 'Replacement char', data: 'A\uFFFDB' },
    { name: 'Lone surrogate high', data: 'A\uD800B' },
    { name: 'Lone surrogate low', data: 'A\uDC00B' },
    { name: 'Non-char FFFE', data: 'A\uFFFEB' },
    { name: 'Non-char FFFF', data: 'A\uFFFFB' },

    // Astral plane (beyond BMP)
    { name: 'Math Bold Fraktur', data: '\uD835\uDD73\uD835\uDD8A\uD835\uDD91\uD835\uDD91\uD835\uDD94' }, // 𝕳𝖊𝖑𝖑𝖔
    { name: 'Egyptian hieroglyph', data: '\uD80C\uDC00' }, // U+13000

    // Space variants
    { name: 'NBSP', data: 'A\u00A0B' },
    { name: 'Em space', data: 'A\u2003B' },
    { name: 'Ideographic space', data: 'A\u3000B' },
    { name: 'Braille blank', data: 'A\u2800B' },

    // Zero-width chars
    { name: 'ZWSP', data: 'A\u200BB' },
    { name: 'ZWNJ', data: 'A\u200CB' },
    { name: 'ZWJ', data: 'A\u200DB' },
    { name: 'Word joiner', data: 'A\u2060B' },
    { name: 'BOM/ZWNBSP', data: 'A\uFEFFB' },
  ];

  let totalIssues = 0;

  for (const test of tests) {
    // Reset terminal
    term.write('\x1b[2J\x1b[H');  // Clear screen, home cursor

    // Write test data
    term.write(test.data);

    // Get line 0
    const line = getLine(term, 0);
    if (!line) {
      console.log(`--- ${test.name} ---`);
      console.log('  <no line data>\n');
      continue;
    }

    console.log(`--- ${test.name} ---`);
    console.log(`Input: ${JSON.stringify(test.data)}`);
    console.log(`Cells:`);

    // Show non-empty cells
    let lastNonEmpty = 0;
    for (let x = 0; x < line.length; x++) {
      if (line[x].codepoint !== 0 && line[x].codepoint !== 0x20) {
        lastNonEmpty = x;
      }
    }

    for (let x = 0; x <= Math.min(lastNonEmpty + 2, 25); x++) {
      console.log('  ' + formatCell(line[x], x));
    }

    // Analyze for issues
    const issues = analyzeResults(test.name, line);
    if (issues.length > 0) {
      console.log('Issues found:');
      issues.forEach(i => console.log(i));
      totalIssues += issues.length;
    }

    console.log();
  }

  term.free();

  console.log('=== Summary ===');
  console.log(`Total issues found: ${totalIssues}`);
  if (totalIssues === 0) {
    console.log('ghostty-vt appears to handle all test cases correctly.');
    console.log('Defensive code in ghostty-emulator.ts may be over-engineering.');
  } else {
    console.log('Some issues detected - defensive code may be justified.');
    console.log('Consider reporting issues upstream to ghostty.');
  }
}

main().catch(console.error);
