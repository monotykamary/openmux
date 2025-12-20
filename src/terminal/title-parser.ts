/**
 * OSC Title Parser - Detects terminal title changes from escape sequences
 *
 * Parses OSC 0/1/2 sequences that set the terminal title:
 * - OSC 0: Set both icon name and window title
 * - OSC 1: Set icon name (we treat as title)
 * - OSC 2: Set window title
 *
 * Format: ESC ] <code> ; <text> BEL  or  ESC ] <code> ; <text> ST
 * Where ST is ESC \
 */

const ESC = '\x1b';
const BEL = '\x07';
const ST = '\x1b\\'; // String Terminator

export interface TitleParserOptions {
  onTitleChange: (title: string) => void;
}

/**
 * Creates a title parser that can be called with data chunks
 */
export function createTitleParser(options: TitleParserOptions) {
  const { onTitleChange } = options;

  // State for OSC sequence parsing
  let inOscSequence = false;
  let collectingText = false; // Whether we've passed the semicolon
  // Use array buffers instead of string concatenation for O(n) instead of O(n²)
  let oscCodeBuffer: string[] = [];
  let oscTextBuffer: string[] = [];

  /**
   * Process a chunk of data and extract title changes
   */
  function processData(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (inOscSequence) {
        // Check for terminator
        if (char === BEL) {
          // BEL terminates OSC
          handleOscComplete();
          continue;
        }

        if (char === ESC && i + 1 < data.length && data[i + 1] === '\\') {
          // ST (ESC \) terminates OSC
          i++; // Skip the backslash
          handleOscComplete();
          continue;
        }

        // Still collecting OSC sequence
        if (!collectingText) {
          // Collecting code (until semicolon)
          if (char === ';') {
            // Code complete, now collecting text
            collectingText = true;
          } else if (char >= '0' && char <= '9') {
            oscCodeBuffer.push(char);
          } else {
            // Invalid OSC, abort
            resetOsc();
          }
        } else {
          // Collecting text (after semicolon)
          oscTextBuffer.push(char);
        }
        continue;
      }

      // Not in OSC sequence - look for start
      if (char === ESC && i + 1 < data.length && data[i + 1] === ']') {
        // Found ESC ] - start of OSC
        inOscSequence = true;
        collectingText = false;
        oscCodeBuffer = [];
        oscTextBuffer = [];
        i++; // Skip the ]
        continue;
      }
    }
  }

  function handleOscComplete(): void {
    const oscCode = oscCodeBuffer.join('');
    const oscText = oscTextBuffer.join('');
    const code = parseInt(oscCode, 10);

    // OSC 0, 1, 2 all set title (0 sets both icon and title, 1 sets icon, 2 sets title)
    if (code === 0 || code === 1 || code === 2) {
      onTitleChange(oscText);
    }

    resetOsc();
  }

  function resetOsc(): void {
    inOscSequence = false;
    collectingText = false;
    oscCodeBuffer = [];
    oscTextBuffer = [];
  }

  return {
    processData,
    isInOscSequence: () => inOscSequence,
  };
}
