/**
 * OSC sequence stripping for the Emulator Worker
 *
 * Strip OSC sequences that can cause screen flash/flicker when processed by ghostty-web.
 */

const ESC = '\x1b';
const BEL = '\x07';
const DIGIT_ZERO = 48;
const DIGIT_NINE = 57;
const OSC_PREFIX = `${ESC}]`;

// OSC codes to strip - these can cause flash/flicker
const STRIP_CODES = new Set([
  0, 1, 2,    // Title sequences (handled by title parser)
  7,          // Working directory (CWD notification)
  10, 11, 12, // Foreground/background/cursor color (SET commands)
  22, 23,     // Window icon / title stack operations
]);

/**
 * Strip OSC sequences that can cause screen flash/flicker when processed by ghostty-web.
 *
 * Stripped sequences:
 * - OSC 0/1/2: Title sequences (handled by title parser)
 * - OSC 7: Working directory notification (not needed for rendering)
 * - OSC 10/11/12: Foreground/background/cursor color SET commands (can cause flash)
 * - OSC 22/23: Window icon / title stack (rarely used, can cause issues)
 *
 * Note: Query sequences (with ?) are handled by query passthrough on main thread.
 * This only strips SET commands that go directly to ghostty-web.
 *
 * Format: ESC]code;params BEL  or  ESC]code;params ESC\
 */
export function stripProblematicOscSequences(text: string): string {
  if (text.indexOf(OSC_PREFIX) === -1) {
    return text;
  }

  const len = text.length;
  let i = 0;
  let lastIndex = 0;
  const parts: string[] = [];

  while (i < len) {
    // Check for OSC start (ESC])
    if (text[i] === ESC && i + 1 < len && text[i + 1] === ']') {
      let pos = i + 2;
      let code = 0;
      let hasCode = false;

      // Parse the OSC code number
      while (pos < len) {
        const codePoint = text.charCodeAt(pos);
        if (codePoint >= DIGIT_ZERO && codePoint <= DIGIT_NINE) {
          hasCode = true;
          code = code * 10 + (codePoint - DIGIT_ZERO);
          pos++;
          continue;
        }
        break;
      }

      // Check if this is a code we should strip
      if (hasCode && STRIP_CODES.has(code)) {
        // For OSC 10/11/12, only strip if it's a SET (not a query with ?)
        const isColorCode = code === 10 || code === 11 || code === 12;

        if (isColorCode) {
          // Query format: OSC 10;? or OSC 10;?ST - handled by passthrough
          if (pos < len && text[pos] === ';' && pos + 1 < len && text[pos + 1] === '?') {
            i++;
            continue;
          }
        }

        // Find the terminator (BEL or ST) and skip entire sequence
        let term = pos;
        let foundTerminator = false;
        while (term < len) {
          if (text[term] === BEL) {
            foundTerminator = true;
            term += 1;
            break;
          }
          if (text[term] === ESC && term + 1 < len && text[term + 1] === '\\') {
            foundTerminator = true;
            term += 2;
            break;
          }
          term++;
        }

        if (foundTerminator) {
          if (i > lastIndex) {
            parts.push(text.slice(lastIndex, i));
          }
          i = term;
          lastIndex = i;
          continue;
        }
        // If no terminator found, include the partial sequence
        // (it will be completed in a future write)
      }
    }

    i++;
  }

  if (lastIndex === 0) {
    return text;
  }
  if (lastIndex < len) {
    parts.push(text.slice(lastIndex));
  }

  return parts.join('');
}
