/**
 * Graphics Protocol Passthrough
 *
 * Intercepts Kitty graphics and Sixel sequences from PTY output
 * and routes them directly to the host terminal, bypassing ghostty-web parsing.
 *
 * This enables GPU-accelerated apps (like OpenTUI) to render graphics
 * when running inside openmux panes.
 *
 * Protocols supported:
 * - Kitty Graphics Protocol: ESC_G...ESC\  or ESC_G...ST
 * - Sixel: ESCP...ESC\
 */

// Escape sequences
const ESC = '\x1b';
const APC = `${ESC}_`; // Application Program Command (Kitty uses this)
const DCS = `${ESC}P`; // Device Control String (Sixel uses this)
const ST = `${ESC}\\`; // String Terminator

// Kitty graphics starts with APC + 'G' or 'g'
const KITTY_START = `${APC}G`;
const KITTY_START_LOWER = `${APC}g`;

// Sixel starts with DCS + params + 'q'
// Format: ESC P <params> q <data> ESC \
const SIXEL_REGEX = /\x1bP[0-9;]*q/;

export interface GraphicsSequence {
  type: 'kitty' | 'sixel';
  data: string;
  startIndex: number;
  endIndex: number;
}

export interface ParseResult {
  /** Text segments to send to ghostty (non-graphics) */
  textSegments: string[];
  /** Graphics sequences to passthrough directly */
  graphicsSequences: GraphicsSequence[];
}

/**
 * Find the end of a Kitty graphics sequence
 * Kitty sequences end with ST (ESC \) or BEL (\x07)
 */
function findKittyEnd(data: string, startIndex: number): number {
  let i = startIndex;
  while (i < data.length) {
    // Check for ST (ESC \)
    if (data[i] === ESC && i + 1 < data.length && data[i + 1] === '\\') {
      return i + 2;
    }
    // Check for BEL
    if (data[i] === '\x07') {
      return i + 1;
    }
    i++;
  }
  return -1; // Not found, sequence incomplete
}

/**
 * Find the end of a Sixel sequence
 * Sixel sequences end with ST (ESC \)
 */
function findSixelEnd(data: string, startIndex: number): number {
  let i = startIndex;
  while (i < data.length) {
    // Check for ST (ESC \)
    if (data[i] === ESC && i + 1 < data.length && data[i + 1] === '\\') {
      return i + 2;
    }
    i++;
  }
  return -1; // Not found, sequence incomplete
}

/**
 * Parse PTY output for graphics sequences
 * Returns segments that should go to ghostty and graphics that should be passed through
 *
 * This is a conservative parser that only extracts COMPLETE sequences
 * to avoid interfering with normal terminal output.
 */
export function parseGraphicsSequences(data: string): ParseResult {
  const textSegments: string[] = [];
  const graphicsSequences: GraphicsSequence[] = [];

  let currentIndex = 0;
  let textStart = 0;

  while (currentIndex < data.length) {
    // Check for Kitty graphics (APC G or APC g)
    // Only match if we have at least the start sequence
    if (currentIndex + 3 <= data.length &&
        (data.startsWith(KITTY_START, currentIndex) ||
         data.startsWith(KITTY_START_LOWER, currentIndex))) {

      const endIndex = findKittyEnd(data, currentIndex + 3);
      if (endIndex !== -1) {
        // Complete sequence found - extract it
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }

        graphicsSequences.push({
          type: 'kitty',
          data: data.slice(currentIndex, endIndex),
          startIndex: currentIndex,
          endIndex,
        });

        currentIndex = endIndex;
        textStart = currentIndex;
        continue;
      }
      // Incomplete sequence - don't extract, let it pass through as text
    }

    // Check for Sixel (DCS ... q)
    // Only match complete sequences
    if (currentIndex + 3 <= data.length && data.startsWith(DCS, currentIndex)) {
      const remaining = data.slice(currentIndex);
      const match = remaining.match(/^\x1bP[0-9;]*q/);

      if (match) {
        const endIndex = findSixelEnd(data, currentIndex + match[0].length);
        if (endIndex !== -1) {
          // Complete sequence found - extract it
          if (currentIndex > textStart) {
            textSegments.push(data.slice(textStart, currentIndex));
          }

          graphicsSequences.push({
            type: 'sixel',
            data: data.slice(currentIndex, endIndex),
            startIndex: currentIndex,
            endIndex,
          });

          currentIndex = endIndex;
          textStart = currentIndex;
          continue;
        }
        // Incomplete sequence - don't extract, let it pass through
      }
    }

    currentIndex++;
  }

  // Add remaining text
  if (textStart < data.length) {
    textSegments.push(data.slice(textStart));
  }

  return { textSegments, graphicsSequences };
}

/**
 * Check if data might contain incomplete graphics sequences at the end
 * Used for buffering partial sequences across data chunks
 */
export function hasIncompleteSequence(data: string): boolean {
  // Check for unterminated Kitty sequence
  const lastApc = data.lastIndexOf(APC);
  if (lastApc !== -1) {
    const remaining = data.slice(lastApc);
    if ((remaining.startsWith(KITTY_START) || remaining.startsWith(KITTY_START_LOWER)) &&
        !remaining.includes(ST) && !remaining.includes('\x07')) {
      return true;
    }
  }

  // Check for unterminated Sixel sequence
  const lastDcs = data.lastIndexOf(DCS);
  if (lastDcs !== -1) {
    const remaining = data.slice(lastDcs);
    if (SIXEL_REGEX.test(remaining) && !remaining.includes(ST)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate cursor positioning sequence
 * Used to position graphics at the correct pane location
 */
export function positionCursor(row: number, col: number): string {
  return `${ESC}[${row + 1};${col + 1}H`;
}

/**
 * Save and restore cursor sequences
 */
export const SAVE_CURSOR = `${ESC}7`;
export const RESTORE_CURSOR = `${ESC}8`;

/**
 * Write graphics sequence to host terminal with positioning
 * @param sequence - The graphics sequence to write
 * @param paneX - Pane X position in terminal coordinates
 * @param paneY - Pane Y position in terminal coordinates
 */
export function writeGraphicsToHost(
  sequence: string,
  paneX: number,
  paneY: number
): void {
  // Save cursor, position at pane, write graphics, restore cursor
  const output = SAVE_CURSOR + positionCursor(paneY, paneX) + sequence + RESTORE_CURSOR;
  process.stdout.write(output);
}

/**
 * Quick check if data might contain graphics sequences
 * This is a fast path to avoid expensive parsing when there's no graphics
 */
function mightContainGraphics(data: string): boolean {
  // Quick check for APC (ESC_) or DCS (ESCP) which start graphics sequences
  // This is much faster than full parsing for non-graphics data
  return data.includes('\x1b_') || data.includes('\x1bP');
}

/**
 * Graphics passthrough handler for a PTY session
 *
 * NOTE: We use a simple, non-buffering approach to avoid blocking normal
 * terminal output. Graphics sequences that span multiple data chunks may
 * not be handled correctly, but this is rare in practice.
 */
export class GraphicsPassthrough {
  private paneX: number = 0;
  private paneY: number = 0;

  constructor() {}

  /**
   * Update pane position for graphics rendering
   */
  setPanePosition(x: number, y: number): void {
    this.paneX = x;
    this.paneY = y;
  }

  /**
   * Process PTY data, extracting graphics for passthrough
   * Returns the non-graphics data to send to ghostty
   *
   * Uses a simple approach: only extract COMPLETE graphics sequences
   * that are fully contained within this data chunk. This avoids
   * buffering issues that could block normal terminal output.
   */
  process(data: string): string {
    // Fast path: if no graphics sequences possible, return data as-is
    if (!mightContainGraphics(data)) {
      return data;
    }

    const result = parseGraphicsSequences(data);

    // Write complete graphics sequences directly to host terminal
    for (const seq of result.graphicsSequences) {
      writeGraphicsToHost(seq.data, this.paneX, this.paneY);
    }

    // Return all text segments (including any incomplete graphics starts)
    // to ghostty - it will handle them appropriately
    return result.textSegments.join('');
  }
}
