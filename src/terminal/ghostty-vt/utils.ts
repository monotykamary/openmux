/**
 * Utilities for native ghostty-vt integration.
 */

import type { TerminalCell } from "../../core/types";
import type { TerminalModes } from "../emulator-interface";
import type { GhosttyVtTerminal } from "./terminal";

/**
 * Extract text from a row of terminal cells, skipping wide character placeholders.
 */
export function extractLineText(cells: TerminalCell[]): string {
  const chars: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    chars.push(cells[i].char);
    if (cells[i].width === 2) {
      i++;
    }
  }
  return chars.join("");
}

/**
 * Get current terminal modes from the emulator.
 */
export function getModes(terminal: GhosttyVtTerminal): TerminalModes {
  return {
    mouseTracking:
      terminal.getMode(1000, false) ||
      terminal.getMode(1002, false) ||
      terminal.getMode(1003, false),
    cursorKeyMode: terminal.getMode(1, false) ? "application" : "normal",
    alternateScreen: terminal.isAlternateScreen(),
    inBandResize: terminal.getMode(2048, false),
  };
}
