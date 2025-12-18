#!/usr/bin/env bun
/**
 * Simple PTY Logger - Logs escape sequences from a command
 * Uses zig-pty
 *
 * Usage: bun scripts/pty-logger-simple.ts <command> [args...]
 * Example: bun scripts/pty-logger-simple.ts opencode
 *
 * Output: pty-sequences.log
 */

import { spawn } from '../zig-pty/src/index';

const ESC = '\x1b';
const BEL = '\x07';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: bun scripts/pty-logger-simple.ts <command> [args...]');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// Open log file
const logFile = Bun.file('pty-sequences.log');
const logWriter = logFile.writer();

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  logWriter.write(line);
}

function describeSequence(seq: string): string {
  const visible = seq
    .replace(/\x1b/g, 'ESC')
    .replace(/\x07/g, 'BEL')
    .replace(/\x9c/g, 'ST')
    .replace(/[\x00-\x1f]/g, (c) => `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`);

  // OSC sequences
  if (seq.startsWith(`${ESC}]`)) {
    const match = seq.match(/^\x1b\](\d+)/);
    if (match) {
      const code = match[1];
      const oscNames: Record<string, string> = {
        '0': 'Window Title + Icon',
        '1': 'Icon Name',
        '2': 'Window Title',
        '4': 'Palette Color',
        '7': 'Working Directory',
        '8': 'Hyperlink',
        '10': 'Foreground Color',
        '11': 'Background Color',
        '12': 'Cursor Color',
        '22': 'Title Push',
        '23': 'Title Pop',
        '52': 'Clipboard',
        '66': 'Unknown Custom',
      };
      return `OSC ${code} [${oscNames[code] || 'Unknown'}]: ${visible.slice(0, 100)}`;
    }
  }

  // CSI ? (private modes)
  if (seq.startsWith(`${ESC}[?`)) {
    const match = seq.match(/^\x1b\[\?(\d+)([hl$])/);
    if (match) {
      const mode = match[1];
      const action = match[2];
      const modeNames: Record<string, string> = {
        '1': 'Cursor Keys',
        '25': 'Cursor Visible',
        '1000': 'Mouse X10',
        '1002': 'Mouse Cell',
        '1003': 'Mouse All',
        '1004': 'Focus Events',
        '1006': 'SGR Mouse',
        '1049': 'Alt Screen',
        '2004': 'Bracketed Paste',
        '2026': 'Sync Output',
      };
      const actionName = action === 'h' ? 'SET' : action === 'l' ? 'RESET' : 'QUERY';
      return `CSI ?${mode}${action} [${actionName} ${modeNames[mode] || 'Mode ' + mode}]`;
    }
  }

  // CSI sequences
  if (seq.startsWith(`${ESC}[`)) {
    if (seq.match(/m$/)) return `SGR: ${visible}`;
    if (seq.match(/H$/)) return `CUP (Cursor Pos): ${visible}`;
    if (seq.match(/J$/)) return `ED (Erase Display): ${visible}`;
    if (seq.match(/K$/)) return `EL (Erase Line): ${visible}`;
    if (seq === `${ESC}[6n`) return 'DSR (Cursor Query)';
    if (seq === `${ESC}[5n`) return 'DSR (Status Query)';
    if (seq.match(/c$/)) return `DA (Device Attrs): ${visible}`;
    return `CSI: ${visible}`;
  }

  // DCS
  if (seq.startsWith(`${ESC}P`)) {
    if (seq.includes('+q')) return `XTGETTCAP: ${visible.slice(0, 60)}`;
    if (seq.includes('$q')) return `DECRQSS: ${visible}`;
    return `DCS: ${visible.slice(0, 60)}`;
  }

  // APC (Kitty graphics)
  if (seq.startsWith(`${ESC}_`)) {
    return `APC/Kitty: ${visible.slice(0, 40)}...`;
  }

  // Simple sequences
  if (seq === `${ESC}7`) return 'DECSC (Save Cursor)';
  if (seq === `${ESC}8`) return 'DECRC (Restore Cursor)';
  if (seq === `${ESC}c`) return 'RIS (Full Reset)';

  return `Unknown: ${visible.slice(0, 60)}`;
}

function extractAndLogSequences(data: string) {
  let i = 0;
  while (i < data.length) {
    if (data[i] === ESC) {
      let end = i + 1;

      // Find sequence end based on type
      if (data[end] === '[') {
        // CSI - ends with letter
        end++;
        while (end < data.length && !/[A-Za-z~]/.test(data[end])) end++;
        if (end < data.length) end++;
      } else if (data[end] === ']') {
        // OSC - ends with BEL or ST
        end++;
        while (end < data.length) {
          if (data[end] === BEL) { end++; break; }
          if (data[end] === ESC && data[end + 1] === '\\') { end += 2; break; }
          end++;
        }
      } else if (data[end] === 'P' || data[end] === '_') {
        // DCS/APC - ends with ST or BEL
        end++;
        while (end < data.length) {
          if (data[end] === BEL) { end++; break; }
          if (data[end] === ESC && data[end + 1] === '\\') { end += 2; break; }
          end++;
        }
      } else if (end < data.length) {
        end++; // Single char escape
      }

      const seq = data.slice(i, end);
      log(describeSequence(seq));
      i = end;
    } else {
      i++;
    }
  }
}

// Create PTY
log(`=== Starting: ${command} ${commandArgs.join(' ')} ===`);
console.error(`Logging to pty-sequences.log...`);

const shell = process.env.SHELL || '/bin/bash';
const ptyProc = spawn(shell, ['-c', `${command} ${commandArgs.join(' ')}`], {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
});

ptyProc.onData((data: string) => {
  extractAndLogSequences(data);
  process.stdout.write(data);
});

ptyProc.onExit(({ exitCode }: { exitCode: number }) => {
  log(`=== Exited with code ${exitCode} ===`);
  logWriter.end();
  process.exit(exitCode);
});

process.stdin.setRawMode?.(true);
process.stdin.on('data', (data) => ptyProc.write(data.toString()));
process.stdout.on('resize', () => ptyProc.resize(process.stdout.columns, process.stdout.rows));
process.on('SIGINT', () => ptyProc.write('\x03'));
