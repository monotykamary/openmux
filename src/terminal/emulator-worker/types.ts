/**
 * Types for the Emulator Worker
 */

import type { GhosttyTerminal } from 'ghostty-web';
import type { WorkerTerminalColors, TerminalModes } from '../emulator-interface';
import type { PackedRowUpdate } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import { createTitleParser } from '../title-parser';

// Scrollback limit constant - ghostty-web default
export const SCROLLBACK_LIMIT = 2000;

export interface WorkerSession {
  terminal: GhosttyTerminal;
  cols: number;
  rows: number;
  /** Worker colors in RGB object format */
  workerColors: WorkerTerminalColors;
  /** TerminalColors format for cell converter (0xRRGGBB) */
  terminalColors: TerminalColors;
  titleParser: ReturnType<typeof createTitleParser>;
  currentTitle: string;
  lastModes: TerminalModes;
  // Scrollback cache (LRU would be better, but Map is simpler for now)
  scrollbackCache: Map<number, PackedRowUpdate>;
  // Track scrollback length for cache invalidation
  lastScrollbackLength: number;
}
