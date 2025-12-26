/**
 * Input handler - converts mouse events to terminal escape sequences
 */

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
 * InputHandler class for encoding mouse input to terminal sequences
 */
class InputHandlerImpl {
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
export type { KeySequence, MouseEvent as MouseInputEvent };
