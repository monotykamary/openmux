/**
 * Paste handler for App
 * Handles bracketed paste from host terminal
 */

import type { PasteEvent } from '@opentui/core';

export interface PasteHandlerDeps {
  // State accessors
  getFocusedPtyId: () => string | undefined;

  // PTY operations
  writeToPTY: (ptyId: string, data: string) => void;
}

/**
 * Create paste handler
 */
export function createPasteHandler(deps: PasteHandlerDeps) {
  const {
    getFocusedPtyId,
    writeToPTY,
  } = deps;

  /**
   * Handle bracketed paste from host terminal (Cmd+V sends this)
   */
  const handleBracketedPaste = (event: PasteEvent) => {
    // Write the pasted text directly to the focused pane's PTY
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      writeToPTY(focusedPtyId, event.text);
    }
  };

  return {
    handleBracketedPaste,
  };
}
