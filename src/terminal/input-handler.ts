/**
 * Input handler - converts keyboard and mouse events to terminal escape sequences
 */

interface KeyEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

interface MouseEvent {
  type: 'down' | 'up' | 'move' | 'drag' | 'scroll';
  button: number; // 0=left, 1=middle, 2=right, 4=scrollUp, 5=scrollDown
  x: number;
  y: number;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

type KeySequence = string;

/**
 * InputHandler class for encoding keyboard input to terminal sequences
 */
class InputHandlerImpl {
  private modeCursor: 'normal' | 'application' = 'normal';
  private modeKeypad: 'normal' | 'application' = 'normal';

  /**
   * Convert keyboard event to terminal escape sequence
   */
  encodeKey(event: KeyEvent): KeySequence {
    const { key, ctrl, alt, shift, meta } = event;

    // Control key combinations
    if (ctrl && !alt && !meta) {
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        return String.fromCharCode(key.charCodeAt(0) - 96);
      }
      if (key.length === 1 && key >= 'A' && key <= 'Z') {
        return String.fromCharCode(key.charCodeAt(0) - 64);
      }
      // Ctrl+[ = ESC
      if (key === '[') return '\x1b';
      // Ctrl+\ = FS
      if (key === '\\') return '\x1c';
      // Ctrl+] = GS
      if (key === ']') return '\x1d';
      // Ctrl+^ = RS
      if (key === '^') return '\x1e';
      // Ctrl+_ = US
      if (key === '_') return '\x1f';
    }

    // Function keys
    const fnKeyMap: Record<string, string> = {
      F1: '\x1bOP',
      F2: '\x1bOQ',
      F3: '\x1bOR',
      F4: '\x1bOS',
      F5: '\x1b[15~',
      F6: '\x1b[17~',
      F7: '\x1b[18~',
      F8: '\x1b[19~',
      F9: '\x1b[20~',
      F10: '\x1b[21~',
      F11: '\x1b[23~',
      F12: '\x1b[24~',
    };

    if (fnKeyMap[key]) {
      return this.addModifiers(fnKeyMap[key], { ctrl, alt, shift });
    }

    // Navigation keys
    const cursorPrefix = this.modeCursor === 'application' ? '\x1bO' : '\x1b[';
    const navKeyMap: Record<string, string> = {
      up: `${cursorPrefix}A`,
      down: `${cursorPrefix}B`,
      right: `${cursorPrefix}C`,
      left: `${cursorPrefix}D`,
      home: '\x1b[H',
      end: '\x1b[F',
      pageup: '\x1b[5~',
      pagedown: '\x1b[6~',
      insert: '\x1b[2~',
      delete: '\x1b[3~',
    };

    const lowerKey = key.toLowerCase();
    if (navKeyMap[lowerKey]) {
      return this.addModifiers(navKeyMap[lowerKey], { ctrl, alt, shift });
    }

    // Special keys
    switch (lowerKey) {
      case 'return':
      case 'enter':
        // Alt+Enter = soft newline (insert line without submit)
        // Note: Shift+Enter detection is unreliable due to OpenTUI/kitty protocol issues
        if (alt && !ctrl) {
          return '\n';
        }
        return '\r';
      case 'tab':
        return shift ? '\x1b[Z' : '\t';
      case 'backspace':
        return '\x7f';
      case 'escape':
        return '\x1b';
      case 'space':
        return ' ';
    }

    // Alt key prefix
    if (alt && key.length === 1) {
      return '\x1b' + key;
    }

    // Regular character
    if (key.length === 1) {
      return key;
    }

    return '';
  }

  /**
   * Set cursor mode (DECCKM)
   */
  setCursorMode(mode: 'normal' | 'application'): void {
    this.modeCursor = mode;
  }

  /**
   * Set keypad mode (DECKPNM/DECKPAM)
   */
  setKeypadMode(mode: 'normal' | 'application'): void {
    this.modeKeypad = mode;
  }

  private addModifiers(
    seq: string,
    mods: { ctrl?: boolean; alt?: boolean; shift?: boolean }
  ): string {
    const { ctrl, alt, shift } = mods;

    if (!ctrl && !alt && !shift) {
      return seq;
    }

    // Calculate modifier code
    let code = 1;
    if (shift) code += 1;
    if (alt) code += 2;
    if (ctrl) code += 4;

    // Insert modifier into sequence
    if (seq.startsWith('\x1b[') && seq.length > 2) {
      const lastChar = seq[seq.length - 1];
      const middle = seq.slice(2, -1);

      if (middle === '' || middle.match(/^\d+$/)) {
        const num = middle === '' ? '1' : middle;
        return `\x1b[${num};${code}${lastChar}`;
      }
    }

    return seq;
  }

  /**
   * Encode mouse event to SGR mouse escape sequence
   * SGR format: ESC [ < button ; x ; y M (press) or ESC [ < button ; x ; y m (release)
   */
  encodeMouse(event: MouseEvent): KeySequence {
    const { type, button, x, y, shift, alt, ctrl } = event;

    // SGR button encoding:
    // 0 = left, 1 = middle, 2 = right
    // 64 = scroll up, 65 = scroll down
    // Add 4 for shift, 8 for alt, 16 for ctrl
    // Add 32 for motion events
    let btn = button;

    // Convert scroll button values
    if (button === 4) btn = 64; // scroll up
    if (button === 5) btn = 65; // scroll down

    // Add modifiers
    if (shift) btn += 4;
    if (alt) btn += 8;
    if (ctrl) btn += 16;

    // Add motion flag for move/drag
    if (type === 'move' || type === 'drag') {
      btn += 32;
    }

    // Terminal coordinates are 1-based
    const tx = x + 1;
    const ty = y + 1;

    // SGR format: ESC [ < btn ; x ; y M (press) or m (release)
    const terminator = type === 'up' ? 'm' : 'M';

    return `\x1b[<${btn};${tx};${ty}${terminator}`;
  }
}

export const inputHandler = new InputHandlerImpl();
export type { KeyEvent, KeySequence, MouseEvent as MouseInputEvent };
