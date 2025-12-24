#!/usr/bin/env bun
/**
 * Standalone ghostty-vt terminal - bypasses OpenTUI entirely
 * Run: bun scripts/test-ghostty-terminal.ts [command]
 *
 * This spawns a real PTY, pipes it through ghostty-vt's VT parser,
 * and renders directly to stdout using ANSI sequences.
 * No OpenTUI involved - just ghostty-vt → terminal output.
 *
 * Examples:
 *   bun scripts/test-ghostty-terminal.ts
 *   bun scripts/test-ghostty-terminal.ts nvim
 *   bun scripts/test-ghostty-terminal.ts htop
 *   bun scripts/test-ghostty-terminal.ts bash -c "cat /path/to/large/file"
 */

import { CellFlags, GhosttyVtTerminal, type GhosttyCell } from '../src/terminal/ghostty-vt';
import { spawn, type IPty } from '../zig-pty/src/index';

// Get terminal size
let cols = process.stdout.columns || 80;
let rows = process.stdout.rows || 24;

// ANSI escape helpers
const ESC = '\x1b';
const CSI = `${ESC}[`;

function moveCursor(x: number, y: number): string {
  return `${CSI}${y + 1};${x + 1}H`;
}

function setFg(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

function setBg(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

function setAttrs(cell: GhosttyCell): string {
  let seq = '';
  if (cell.flags & CellFlags.BOLD) seq += `${CSI}1m`;
  if (cell.flags & CellFlags.FAINT) seq += `${CSI}2m`;
  if (cell.flags & CellFlags.ITALIC) seq += `${CSI}3m`;
  if (cell.flags & CellFlags.UNDERLINE) seq += `${CSI}4m`;
  if (cell.flags & CellFlags.BLINK) seq += `${CSI}5m`;
  if (cell.flags & CellFlags.INVERSE) seq += `${CSI}7m`;
  if (cell.flags & CellFlags.INVISIBLE) seq += `${CSI}8m`;
  if (cell.flags & CellFlags.STRIKETHROUGH) seq += `${CSI}9m`;
  return seq;
}

function resetAttrs(): string {
  return `${CSI}0m`;
}

function hideCursor(): string {
  return `${CSI}?25l`;
}

function showCursor(): string {
  return `${CSI}?25h`;
}

function clearScreen(): string {
  return `${CSI}2J${CSI}H`;
}

function enterAltScreen(): string {
  return `${CSI}?1049h`;
}

function leaveAltScreen(): string {
  return `${CSI}?1049l`;
}

// Render full screen from ghostty terminal state
function renderScreen(term: GhosttyVtTerminal, cols: number, rows: number): string {
  term.update();
  const viewport = term.getViewport();
  let out = moveCursor(0, 0);

  for (let y = 0; y < rows; y++) {
    const start = y * cols;
    const line = viewport.length > 0 ? viewport.slice(start, start + cols) : null;

    out += moveCursor(0, y);

    if (!line) {
      // Empty line - just spaces with default colors
      out += resetAttrs();
      out += ' '.repeat(cols);
      continue;
    }

    for (let x = 0; x < cols; x++) {
      if (x < line.length) {
        const cell = line[x];

        // Skip continuation cells (width=0) - the wide char already rendered
        if (cell.width === 0) continue;

        out += resetAttrs();
        out += setFg(cell.fg_r, cell.fg_g, cell.fg_b);
        out += setBg(cell.bg_r, cell.bg_g, cell.bg_b);
        out += setAttrs(cell);

        // Convert codepoint to character
        let char = ' ';
        if (cell.codepoint >= 0x20 && !(cell.flags & CellFlags.INVISIBLE)) {
          try {
            char = String.fromCodePoint(cell.codepoint);
          } catch {
            char = ' ';
          }
        }

        out += char;
      } else {
        out += resetAttrs() + ' ';
      }
    }
  }

  // Render cursor
  const cursor = term.getCursor();
  if (cursor.visible) {
    out += moveCursor(cursor.x, cursor.y);
    out += showCursor();
  } else {
    out += hideCursor();
  }

  return out;
}

async function main() {
  const command = process.argv[2] || process.env.SHELL || '/bin/bash';
  const args = process.argv.slice(3);

  console.error(`[ghostty-terminal] Starting: ${command} ${args.join(' ')}`);
  console.error(`[ghostty-terminal] Size: ${cols}x${rows}`);
  console.error(`[ghostty-terminal] Press Ctrl+C to exit\n`);

  // Small delay to let user read the message
  await Bun.sleep(500);

  // Initialize ghostty-vt
  const term = new GhosttyVtTerminal(cols, rows, {
    scrollbackLimit: 1000,
    fgColor: 0xffffff,
    bgColor: 0x000000,
  });

  // Spawn PTY
  const pty: IPty = spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>,
  });

  // Enter alternate screen and hide cursor initially
  process.stdout.write(enterAltScreen() + hideCursor() + clearScreen());

  let renderScheduled = false;

  // Throttled render
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    setImmediate(() => {
      renderScheduled = false;
      process.stdout.write(renderScreen(term, cols, rows));
    });
  }

  // Handle PTY output → ghostty → render
  const dataHandler = pty.onData((data: string) => {
    // Write to ghostty terminal (VT parsing happens here)
    term.write(data);
    // Schedule render
    scheduleRender();
  });

  // Handle PTY exit
  const exitHandler = pty.onExit(({ exitCode }) => {
    cleanup();
  });

  // Handle stdin → PTY
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('data', (data) => {
    pty.write(data.toString());
  });

  // Handle terminal resize
  process.stdout.on('resize', () => {
    cols = process.stdout.columns || 80;
    rows = process.stdout.rows || 24;
    term.resize(cols, rows);
    pty.resize(cols, rows);
    scheduleRender();
  });

  // Cleanup on exit
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;

    process.stdout.write(leaveAltScreen() + showCursor() + resetAttrs());
    dataHandler.dispose();
    exitHandler.dispose();
    try {
      pty.kill();
    } catch {
      // Already dead
    }
    term.free();
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.stdout.write(leaveAltScreen() + showCursor() + resetAttrs());
  process.exit(1);
});
