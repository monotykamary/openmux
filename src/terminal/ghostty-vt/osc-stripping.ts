/**
 * OSC sequence stripping for ghostty-vt.
 *
 * Strips OSC sequences that can cause flash/flicker or unwanted mutations
 * when processed by the terminal emulator. Title changes are handled by
 * the title parser, and OSC queries are handled by passthrough.
 */

/**
 * Strip OSC sequences that can cause screen flash/flicker or unwanted state.
 *
 * Stripped sequences:
 * - OSC 0/1/2: Title sequences (handled by title parser)
 * - OSC 7: Working directory notification (not needed for rendering)
 * - OSC 10/11/12: Foreground/background/cursor color SET commands
 * - OSC 22/23: Window icon / title stack operations
 *
 * Note: Query sequences (with ?) are handled by query passthrough on main thread.
 * This only strips SET commands that go directly to the emulator.
 */
export function stripProblematicOscSequences(text: string): string {
  const ESC = '\x1b';
  const BEL = '\x07';

  const stripCodes = new Set([
    0, 1, 2,
    7,
    10, 11, 12,
    22, 23,
  ]);

  let result = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === ESC && i + 1 < text.length && text[i + 1] === ']') {
      let pos = i + 2;
      let codeStr = '';

      while (pos < text.length && /\d/.test(text[pos])) {
        codeStr += text[pos];
        pos++;
      }

      const code = parseInt(codeStr, 10);

      if (codeStr.length > 0 && stripCodes.has(code)) {
        const isColorCode = code === 10 || code === 11 || code === 12;

        if (isColorCode) {
          if (pos < text.length && text[pos] === ';') {
            if (pos + 1 < text.length && text[pos + 1] === '?') {
              result += text[i];
              i++;
              continue;
            }
          }
        }

        while (pos < text.length) {
          if (text[pos] === BEL) {
            i = pos + 1;
            break;
          }
          if (text[pos] === ESC && pos + 1 < text.length && text[pos + 1] === '\\') {
            i = pos + 2;
            break;
          }
          pos++;
        }

        if (i > pos - 1) {
          continue;
        }
      }
    }

    result += text[i];
    i++;
  }

  return result;
}
