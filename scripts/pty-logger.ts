#!/usr/bin/env bun
/**
 * PTY Logger - Wraps a command and logs all escape sequences
 *
 * Usage: bun scripts/pty-logger.ts <command> [args...]
 * Example: bun scripts/pty-logger.ts opencode
 *
 * Logs go to stderr so they don't interfere with the wrapped command.
 * The wrapped command's output goes to stdout normally.
 */

import { spawn } from '../zig-pty/src/index';

const ESC = '\x1b';
const BEL = '\x07';

// Get command from args
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: bun scripts/pty-logger.ts <command> [args...]');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// Log file
const logFile = Bun.file('pty-sequences.log');
const logWriter = logFile.writer();

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  logWriter.write(line);
  // Also write to stderr for real-time viewing
  process.stderr.write(`\x1b[90m${line}\x1b[0m`);
}

/**
 * Parse and describe an escape sequence
 */
function describeSequence(seq: string): string {
  // Make sequence visible by escaping control chars
  const visible = seq
    .replace(/\x1b/g, 'ESC')
    .replace(/\x07/g, 'BEL')
    .replace(/\x9c/g, 'ST');

  // OSC sequences (ESC])
  if (seq.startsWith(`${ESC}]`)) {
    const match = seq.match(/^\x1b\](\d+);?/);
    if (match) {
      const code = parseInt(match[1], 10);
      const oscNames: Record<number, string> = {
        0: 'Set Icon Name and Window Title',
        1: 'Set Icon Name',
        2: 'Set Window Title',
        4: 'Set/Query Palette Color',
        7: 'Set Working Directory (CWD)',
        8: 'Hyperlink',
        10: 'Set/Query Foreground Color',
        11: 'Set/Query Background Color',
        12: 'Set/Query Cursor Color',
        22: 'Set Window/Icon Title (push)',
        23: 'Restore Window/Icon Title (pop)',
        52: 'Clipboard',
        66: 'Custom (unknown)',
        104: 'Reset Palette Color',
        110: 'Reset Foreground Color',
        111: 'Reset Background Color',
        112: 'Reset Cursor Color',
      };
      const name = oscNames[code] || `Unknown OSC ${code}`;
      return `OSC ${code} (${name}): ${visible}`;
    }
  }

  // CSI sequences (ESC[)
  if (seq.startsWith(`${ESC}[`)) {
    // Private mode (ESC[?)
    if (seq.startsWith(`${ESC}[?`)) {
      const match = seq.match(/^\x1b\[\?(\d+)([hl])/);
      if (match) {
        const mode = parseInt(match[1], 10);
        const action = match[2] === 'h' ? 'SET' : 'RESET';
        const modeNames: Record<number, string> = {
          1: 'DECCKM (Cursor Keys Mode)',
          7: 'DECAWM (Auto-Wrap Mode)',
          12: 'Cursor Blink',
          25: 'DECTCEM (Text Cursor Enable)',
          1000: 'Mouse Tracking (X10)',
          1002: 'Mouse Tracking (Cell Motion)',
          1003: 'Mouse Tracking (All Motion)',
          1004: 'Focus Events',
          1006: 'SGR Mouse Mode',
          1049: 'Alternate Screen Buffer',
          2004: 'Bracketed Paste',
          2026: 'Synchronized Output',
        };
        const name = modeNames[mode] || `Unknown Mode ${mode}`;
        return `CSI ? ${mode} ${match[2]} - ${action} ${name}: ${visible}`;
      }
      // DECRQM query
      if (seq.includes('$p')) {
        return `DECRQM (Request Mode): ${visible}`;
      }
    }

    // SGR (Select Graphic Rendition)
    if (seq.match(/^\x1b\[[0-9;]*m$/)) {
      return `SGR (Set Graphics): ${visible}`;
    }

    // Cursor position
    if (seq.match(/^\x1b\[\d+;\d+H$/)) {
      return `CUP (Cursor Position): ${visible}`;
    }

    // Erase in Display
    if (seq.match(/^\x1b\[[0-2]?J$/)) {
      const match = seq.match(/^\x1b\[([0-2])?J$/);
      const param = match?.[1] || '0';
      const actions: Record<string, string> = {
        '0': 'Clear from cursor to end',
        '1': 'Clear from start to cursor',
        '2': 'Clear entire screen',
      };
      return `ED (Erase in Display) ${actions[param]}: ${visible}`;
    }

    // Erase in Line
    if (seq.match(/^\x1b\[[0-2]?K$/)) {
      return `EL (Erase in Line): ${visible}`;
    }

    // Device Status Report
    if (seq === `${ESC}[6n`) {
      return `DSR (Cursor Position Query): ${visible}`;
    }
    if (seq === `${ESC}[5n`) {
      return `DSR (Device Status Query): ${visible}`;
    }

    // Device Attributes
    if (seq.match(/^\x1b\[>?=?[0]?c$/)) {
      return `DA (Device Attributes Query): ${visible}`;
    }

    return `CSI: ${visible}`;
  }

  // DCS sequences (ESCP)
  if (seq.startsWith(`${ESC}P`)) {
    if (seq.includes('+q')) {
      return `XTGETTCAP (Termcap Query): ${visible}`;
    }
    if (seq.includes('$q')) {
      return `DECRQSS (Request Status String): ${visible}`;
    }
    if (seq.match(/^\x1bP[0-9;]*q/)) {
      return `SIXEL Graphics: ${visible.slice(0, 50)}...`;
    }
    return `DCS: ${visible}`;
  }

  // APC sequences (ESC_) - often Kitty graphics
  if (seq.startsWith(`${ESC}_`)) {
    if (seq.startsWith(`${ESC}_G`) || seq.startsWith(`${ESC}_g`)) {
      return `Kitty Graphics: ${visible.slice(0, 50)}...`;
    }
    return `APC: ${visible}`;
  }

  // Simple escape sequences
  if (seq === `${ESC}7`) return `DECSC (Save Cursor): ${visible}`;
  if (seq === `${ESC}8`) return `DECRC (Restore Cursor): ${visible}`;
  if (seq === `${ESC}c`) return `RIS (Full Reset): ${visible}`;
  if (seq === `${ESC}[>q` || seq === `${ESC}[>0q`) return `XTVERSION Query: ${visible}`;

  return `Unknown: ${visible}`;
}

/**
 * Extract escape sequences from data
 */
function extractSequences(data: string): { sequences: string[], text: string } {
  const sequences: string[] = [];
  let text = '';
  let i = 0;

  while (i < data.length) {
    if (data[i] === ESC) {
      // Start of escape sequence
      let seqEnd = i + 1;

      if (data[seqEnd] === '[') {
        // CSI sequence - find terminator (letter)
        seqEnd++;
        while (seqEnd < data.length && !/[A-Za-z~]/.test(data[seqEnd])) {
          seqEnd++;
        }
        if (seqEnd < data.length) seqEnd++;
      } else if (data[seqEnd] === ']') {
        // OSC sequence - find BEL or ST terminator
        seqEnd++;
        while (seqEnd < data.length) {
          if (data[seqEnd] === BEL) {
            seqEnd++;
            break;
          }
          if (data[seqEnd] === ESC && data[seqEnd + 1] === '\\') {
            seqEnd += 2;
            break;
          }
          seqEnd++;
        }
      } else if (data[seqEnd] === 'P') {
        // DCS sequence - find ST terminator
        seqEnd++;
        while (seqEnd < data.length) {
          if (data[seqEnd] === ESC && data[seqEnd + 1] === '\\') {
            seqEnd += 2;
            break;
          }
          seqEnd++;
        }
      } else if (data[seqEnd] === '_') {
        // APC sequence - find ST or BEL terminator
        seqEnd++;
        while (seqEnd < data.length) {
          if (data[seqEnd] === BEL) {
            seqEnd++;
            break;
          }
          if (data[seqEnd] === ESC && data[seqEnd + 1] === '\\') {
            seqEnd += 2;
            break;
          }
          seqEnd++;
        }
      } else if (seqEnd < data.length) {
        // Single-char escape sequence
        seqEnd++;
      }

      const seq = data.slice(i, seqEnd);
      sequences.push(seq);
      i = seqEnd;
    } else {
      text += data[i];
      i++;
    }
  }

  return { sequences, text };
}

// Create PTY
log(`Starting: ${command} ${commandArgs.join(' ')}`);

const shell = process.env.SHELL || '/bin/bash';
const ptyProcess = spawn(shell, ['-c', `${command} ${commandArgs.join(' ')}`], {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
});

// Handle PTY output
ptyProcess.onData((data: string) => {
  const { sequences, text } = extractSequences(data);

  // Log each sequence
  for (const seq of sequences) {
    log(describeSequence(seq));
  }

  // Pass through to stdout
  process.stdout.write(data);
});

// Handle PTY exit
ptyProcess.onExit(({ exitCode }) => {
  log(`Process exited with code ${exitCode}`);
  logWriter.end();
  process.exit(exitCode);
});

// Forward stdin to PTY
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  ptyProcess.write(data.toString());
});

// Handle resize
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
});

// Handle signals
process.on('SIGINT', () => {
  ptyProcess.write('\x03');
});

process.on('SIGTERM', () => {
  ptyProcess.kill();
});

log('PTY logger started - sequences will be logged to pty-sequences.log');
