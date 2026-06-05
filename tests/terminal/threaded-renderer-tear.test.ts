/**
 * E2E test: verify that OpenTUI's threaded renderer (useThread=true) does NOT
 * produce torn reads when the JS main thread writes cells to the OptimizedBuffer
 * via typed arrays + drawChar FFI in renderAfter.
 *
 * Hypothesis (disproved): when useThread=true, the native diff+output runs on a
 * background OS thread that reads the OptimizedBuffer concurrently with the JS
 * main thread's typed array writes. If the background thread reads mid-frame, it
 * would see a mix of old and new cells — a torn read — producing garbled output
 * that persists in the host terminal's scrollback as "stateful artifacting."
 *
 * This test disproves that hypothesis. OpenTUI's threaded renderer properly
 * synchronizes: the diff engine reads the buffer only after renderAfter completes,
 * so no torn reads occur regardless of useThread.
 *
 * Test approach:
 * 1. Create a CliRenderer (useThread=true/false) with a PassThrough stdout.
 * 2. In renderAfter, write a uniform frame-counter digit to every cell using
 *    typed arrays + drawChar FFI — the same technique openmux's renderRowDirect
 *    uses.
 * 3. Capture the ANSI output and feed it to a VT simulator to reconstruct the
 *    terminal's cell grid.
 * 4. Check the cell grid for torn reads: rows containing digits from two
 *    different frame counters.
 * 5. Assert that BOTH useThread=true and useThread=false produce zero torn reads.
 */

import { describe, it, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  createCliRenderer,
  type CliRenderer,
  type OptimizedBuffer,
  RGBA,
  Renderable,
} from '@opentui/core';
import { createSyncModeParser } from '../../src/terminal/sync-mode-parser';
import {
  createDataHandler,
  normalizePiFullRedrawSegment,
} from '../../src/effect/services/pty/data-handler';

const TERMINAL_WIDTH = 80;
const TERMINAL_HEIGHT = 24;
const TOTAL_FRAMES = 300;
const DARK_BG = RGBA.fromInts(13, 17, 23, 255);

/** Minimal VT terminal simulator. Processes ANSI output to reconstruct cell state. */
class VTSimulator {
  cells: string[][];
  cursorRow = 0;
  cursorCol = 0;

  constructor(
    public width: number,
    public height: number
  ) {
    this.cells = Array.from({ length: height }, () => Array(width).fill(' '));
  }

  process(data: string): void {
    let pos = 0;
    while (pos < data.length) {
      if (data[pos] === '\x1b') {
        if (pos + 1 >= data.length) {
          pos++;
          continue;
        }
        const next = data[pos + 1];

        if (next === '[') {
          pos = this.processCSI(data, pos + 2);
          continue;
        }

        if (next === ']') {
          const belIdx = data.indexOf('\x07', pos + 2);
          const stIdx = data.indexOf('\x1b\\', pos + 2);
          if (belIdx !== -1 && (stIdx === -1 || belIdx < stIdx)) {
            pos = belIdx + 1;
          } else if (stIdx !== -1) {
            pos = stIdx + 2;
          } else {
            pos = data.length;
          }
          continue;
        }

        pos += 2;
        continue;
      }

      const ch = data[pos];
      if (ch >= ' ' && ch <= '~') {
        this.putChar(ch);
      } else if (ch === '\n') {
        this.cursorRow++;
        this.cursorCol = 0;
      } else if (ch === '\r') {
        this.cursorCol = 0;
      }
      pos++;
    }
  }

  private putChar(ch: string): void {
    if (
      this.cursorRow >= 0 &&
      this.cursorRow < this.height &&
      this.cursorCol >= 0 &&
      this.cursorCol < this.width
    ) {
      this.cells[this.cursorRow][this.cursorCol] = ch;
    }
    this.cursorCol++;
    if (this.cursorCol >= this.width) {
      this.cursorCol = 0;
      this.cursorRow++;
    }
  }

  private processCSI(data: string, pos: number): number {
    let p = pos;
    let paramStr = '';
    while (p < data.length && data.charCodeAt(p) >= 0x30 && data.charCodeAt(p) <= 0x3f) {
      paramStr += data[p];
      p++;
    }
    while (p < data.length && data.charCodeAt(p) >= 0x20 && data.charCodeAt(p) <= 0x2f) p++;
    if (p >= data.length || data.charCodeAt(p) < 0x40 || data.charCodeAt(p) > 0x7e) return p;
    const final = data[p];
    p++;

    const params = paramStr.split(';').map((s) => parseInt(s, 10) || 0);

    switch (final) {
      case 'H': {
        this.cursorRow = Math.max(0, (params[0] || 1) - 1);
        this.cursorCol = Math.max(0, (params[1] || 1) - 1);
        break;
      }
      case 'J': {
        if ((params[0] || 0) === 2) {
          for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++) this.cells[y][x] = ' ';
        }
        break;
      }
      case 'K': {
        if ((params[0] || 0) === 0) {
          for (let x = this.cursorCol; x < this.width; x++) this.cells[this.cursorRow][x] = ' ';
        }
        break;
      }
      default:
        break;
    }

    return p;
  }

  /** Check for torn reads: rows with significant counts of two or more different digits. */
  checkTornReads(
    minDigitCount = 3
  ): { row: number; digits: string[]; counts: Map<string, number> }[] {
    const torn: { row: number; digits: string[]; counts: Map<string, number> }[] = [];
    for (let y = 0; y < this.height; y++) {
      const counts = new Map<string, number>();
      for (let x = 0; x < this.width; x++) {
        const ch = this.cells[y][x];
        if (ch >= '0' && ch <= '9') counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
      const significant = [...counts.entries()]
        .filter(([, c]) => c >= minDigitCount)
        .map(([d]) => d);
      if (significant.length > 1) torn.push({ row: y, digits: significant, counts });
    }
    return torn;
  }
}

async function runRendererTest(useThread: boolean): Promise<{
  torn: { row: number; digits: string[]; counts: Map<string, number> }[];
  frames: number;
  outputSize: number;
}> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

  const stdin = new PassThrough();
  Object.defineProperty(stdin, 'isTTY', { value: true });
  Object.defineProperty(stdin, 'columns', { value: TERMINAL_WIDTH });
  Object.defineProperty(stdin, 'rows', { value: TERMINAL_HEIGHT });

  let renderer: CliRenderer | null = null;
  let frameCount = 0;

  try {
    renderer = await createCliRenderer({
      stdin,
      stdout: stdout as any,
      width: TERMINAL_WIDTH,
      height: TERMINAL_HEIGHT,
      useThread,
      exitOnCtrlC: false,
      useMouse: false,
      useKittyKeyboard: false,
    });

    const testRenderable = new Renderable(renderer as any, {
      id: 'tear-test',
      width: TERMINAL_WIDTH,
      height: TERMINAL_HEIGHT,
      renderAfter: function (this: any, renderBuffer: OptimizedBuffer) {
        if (frameCount >= TOTAL_FRAMES) return;

        const { char: charArr, fg: fgArr, bg: bgArr, attributes: attrArr } = renderBuffer.buffers;
        const w = renderBuffer.width;
        const h = renderBuffer.height;
        const digit = String(frameCount % 10).charCodeAt(0);
        const fgR = (frameCount * 37) & 0xff;
        const fgG = (frameCount * 71) & 0xff;
        const fgB = (frameCount * 113) & 0xff;
        const fgRGBA = RGBA.fromInts(fgR, fgG, fgB, 255);

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const off = y * w + x;
            charArr[off] = digit;
            const fg4 = off * 4;
            fgArr[fg4] = fgR;
            fgArr[fg4 + 1] = fgG;
            fgArr[fg4 + 2] = fgB;
            fgArr[fg4 + 3] = 0xff;
            const bg4 = off * 4;
            bgArr[bg4] = 13;
            bgArr[bg4 + 1] = 17;
            bgArr[bg4 + 2] = 23;
            bgArr[bg4 + 3] = 0xff;
            attrArr[off] = 0;
          }
          renderBuffer.drawChar(digit, 0, y, fgRGBA, DARK_BG, 0);
        }
        frameCount++;
      },
    });

    renderer.root.add(testRenderable);
    renderer.start({ fps: 60 });

    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => resolve(), 15000);
      const check = setInterval(() => {
        if (frameCount >= TOTAL_FRAMES) {
          clearTimeout(deadline);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    await new Promise((r) => setTimeout(r, 300));
  } finally {
    try {
      renderer?.stop();
    } catch {}
    try {
      renderer?.destroy();
    } catch {}
  }

  const raw = Buffer.concat(chunks).toString('latin1');
  const vt = new VTSimulator(TERMINAL_WIDTH, TERMINAL_HEIGHT);
  vt.process(raw);

  return { torn: vt.checkTornReads(), frames: frameCount, outputSize: raw.length };
}

describe('Threaded renderer does not produce torn reads', () => {
  it(
    'useThread=true: no torn reads from concurrent JS writes and native diff reads',
    async () => {
      const result = await runRendererTest(true);
      expect(result.torn.length).toBe(0);
    },
    { timeout: 30_000 }
  );

  it(
    'useThread=false: no torn reads (baseline)',
    async () => {
      const result = await runRendererTest(false);
      expect(result.torn.length).toBe(0);
    },
    { timeout: 30_000 }
  );
});

/**
 * Scrollback contamination: verify that CSI 2J normalization works for
 * sync-wrapped pi frames, and document the known gap where drainRawToEmulator
 * bypasses normalization for background panes.
 *
 * Ghostty's VT emulator treats CSI 2J (erase display) as a scrollClear at a
 * shell prompt — it pushes the visible viewport into scrollback. Pi frames
 * contain CSI 2J as part of their full-redraw cycle. If this passes through
 * un-normalized, every pi frame pushes a duplicate copy of the screen into
 * scrollback. Scroll up → ghost/duplicate content.
 *
 * The data-handler's normalizePiFullRedrawSegment replaces CSI 2J + CSI H +
 * (optional) CSI 3J with CSI H + CSI J + CSI 3J (cursor home, erase-to-end,
 * clear scrollback). The replacement clears in-place without triggering
 * scrollClear while also resetting accumulated scrollback to keep the
 * emulator's scroll position in sync with pi's viewportTop tracking.
 *
 * Known gap: drainRawToEmulator writes raw buffered data directly to the
 * emulator, bypassing processChunk → syncParser → normalizePiFullRedrawSegment.
 * This is used by the 1fps background pulse for non-focused panes. Background
 * panes with pi output will have CSI 2J applied un-normalized.
 */
function makePiFrame(content: string, with3J = false): string {
  const suffix = with3J ? '\x1b[3J' : '';
  return `\x1b[?2026h\x1b[2J\x1b[H${suffix}${content}\x1b[?2026l`;
}

describe('scrollback contamination: CSI 2J normalization', () => {
  it('normalizes basic pi frame with CSI 3J', () => {
    const parser = createSyncModeParser();
    const { readySegments } = parser.process(makePiFrame('hello', true));
    expect(readySegments.length).toBe(1);

    const normalized = normalizePiFullRedrawSegment(readySegments[0], 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes basic pi frame without CSI 3J', () => {
    const parser = createSyncModeParser();
    const { readySegments } = parser.process(makePiFrame('hello', false));
    expect(readySegments.length).toBe(1);

    const normalized = normalizePiFullRedrawSegment(readySegments[0], 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes large truecolor frame', () => {
    const content = Array.from({ length: 5 }, (_, y) => {
      const r = (y * 13) & 0xff;
      const g = (y * 17) & 0xff;
      const b = (y * 23) & 0xff;
      return `\x1b[38;2;${r};${g};${b}m${'X'.repeat(80)}\x1b[0m`;
    }).join('\r\n');
    const parser = createSyncModeParser();
    const { readySegments } = parser.process(makePiFrame(content));

    const normalized = normalizePiFullRedrawSegment(readySegments[0], 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes frame split across two data chunks', () => {
    const parser = createSyncModeParser();
    const fullFrame = makePiFrame('split frame content');
    const mid = Math.floor(fullFrame.length / 2);

    const { isBuffering: buf1 } = parser.process(fullFrame.slice(0, mid));
    expect(buf1).toBe(true);

    const { readySegments: segs2 } = parser.process(fullFrame.slice(mid));
    const normalized = normalizePiFullRedrawSegment(segs2[0], 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes pi frame after shell prompt in same chunk', () => {
    const parser = createSyncModeParser();
    const { readySegments } = parser.process('$ ' + makePiFrame('frame content'));
    expect(readySegments.length).toBe(2);
    expect(readySegments[0]).toBe('$ ');

    const normalized = normalizePiFullRedrawSegment(readySegments[1], 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes pi frame after startup queries', () => {
    const parser = createSyncModeParser();
    const { readySegments } = parser.process(
      '\x1b]10;?\x07\x1b]11;?\x07\x1b[>c' + makePiFrame('first frame')
    );
    const last = readySegments[readySegments.length - 1];
    const normalized = normalizePiFullRedrawSegment(last, 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes CSI 2J mid-segment when preceded by Kitty image delete', () => {
    // Pi's fullRender prepends Kitty image delete sequences before CSI 2J.
    // The regex matches CSI 2J + CSI H at any position, preserving the prefix.
    const input = '\x1b_Ga=d,d=A,q=2\x1b\\\x1b[2J\x1b[H\x1b[3Jhello';
    const normalized = normalizePiFullRedrawSegment(input, 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.startsWith('\x1b_Ga=d,d=A,q=2\x1b\\')).toBe(true);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });

  it('normalizes rapid consecutive pi frames', () => {
    const parser = createSyncModeParser();
    const { readySegments } = parser.process(
      makePiFrame('f0') + makePiFrame('f1') + makePiFrame('f2')
    );
    for (const seg of readySegments) {
      const normalized = normalizePiFullRedrawSegment(seg, 24);
      expect(normalized.includes('\x1b[2J')).toBe(false);
      expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
    }
  });

  it('normalizes sync timeout flush', () => {
    const parser = createSyncModeParser();
    parser.process(makePiFrame('partial').replace('\x1b[?2026l', ''));
    const flushed = parser.flush();
    const normalized = normalizePiFullRedrawSegment(flushed, 24);
    expect(normalized.includes('\x1b[2J')).toBe(false);
    expect(normalized.includes('\x1b[H\x1b[J\x1b[3J')).toBe(true);
  });
});
