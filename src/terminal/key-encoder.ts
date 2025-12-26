/**
 * Ghostty key encoder adapter for PTY input.
 * Encodes key events using libghostty-vt to preserve modifier semantics.
 */

import type { Pointer } from "bun:ffi";
import { ghostty } from "./ghostty-vt/ffi";
import type { ITerminalEmulator } from "./emulator-interface";

export interface TerminalKeyEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  sequence?: string;
  baseCode?: number;
}

type KeyEncoderOptions = {
  cursorKeyApplication: boolean;
  keypadKeyApplication: boolean;
  ignoreKeypadWithNumlock: boolean;
  altEscPrefix: boolean;
  modifyOtherKeysState2: boolean;
  kittyFlags: number;
};

const GHOSTTY_SUCCESS = 0;
const GHOSTTY_OUT_OF_MEMORY = -1;

const KEY_ACTION_PRESS = 1;

const MOD_SHIFT = 1 << 0;
const MOD_CTRL = 1 << 1;
const MOD_ALT = 1 << 2;

const OPT_CURSOR_KEY_APPLICATION = 0;
const OPT_KEYPAD_KEY_APPLICATION = 1;
const OPT_IGNORE_KEYPAD_WITH_NUMLOCK = 2;
const OPT_ALT_ESC_PREFIX = 3;
const OPT_MODIFY_OTHER_KEYS_STATE_2 = 4;
const OPT_KITTY_FLAGS = 5;

const KEY_UNIDENTIFIED = 0;
const KEY_BACKQUOTE = 1;
const KEY_BACKSLASH = 2;
const KEY_BRACKET_LEFT = 3;
const KEY_BRACKET_RIGHT = 4;
const KEY_COMMA = 5;
const KEY_DIGIT_0 = 6;
const KEY_A = 20;
const KEY_EQUAL = 16;
const KEY_MINUS = 46;
const KEY_PERIOD = 47;
const KEY_QUOTE = 48;
const KEY_SEMICOLON = 49;
const KEY_SLASH = 50;
const KEY_BACKSPACE = 53;
const KEY_ENTER = 58;
const KEY_SPACE = 63;
const KEY_TAB = 64;
const KEY_DELETE = 68;
const KEY_END = 69;
const KEY_HOME = 71;
const KEY_INSERT = 72;
const KEY_PAGE_DOWN = 73;
const KEY_PAGE_UP = 74;
const KEY_ARROW_DOWN = 75;
const KEY_ARROW_LEFT = 76;
const KEY_ARROW_RIGHT = 77;
const KEY_ARROW_UP = 78;
const KEY_ESCAPE = 120;
const KEY_F1 = 121;
const KEY_F12 = 132;

const SPECIAL_KEY_MAP: Record<string, number> = {
  enter: KEY_ENTER,
  return: KEY_ENTER,
  linefeed: KEY_ENTER,
  tab: KEY_TAB,
  backspace: KEY_BACKSPACE,
  escape: KEY_ESCAPE,
  esc: KEY_ESCAPE,
  up: KEY_ARROW_UP,
  down: KEY_ARROW_DOWN,
  left: KEY_ARROW_LEFT,
  right: KEY_ARROW_RIGHT,
  home: KEY_HOME,
  end: KEY_END,
  pageup: KEY_PAGE_UP,
  page_up: KEY_PAGE_UP,
  pagedown: KEY_PAGE_DOWN,
  page_down: KEY_PAGE_DOWN,
  insert: KEY_INSERT,
  delete: KEY_DELETE,
  space: KEY_SPACE,
  f1: KEY_F1,
  f2: KEY_F1 + 1,
  f3: KEY_F1 + 2,
  f4: KEY_F1 + 3,
  f5: KEY_F1 + 4,
  f6: KEY_F1 + 5,
  f7: KEY_F1 + 6,
  f8: KEY_F1 + 7,
  f9: KEY_F1 + 8,
  f10: KEY_F1 + 9,
  f11: KEY_F1 + 10,
  f12: KEY_F12,
};

const PUNCT_KEY_MAP: Record<string, number> = {
  "`": KEY_BACKQUOTE,
  "-": KEY_MINUS,
  "=": KEY_EQUAL,
  "[": KEY_BRACKET_LEFT,
  "]": KEY_BRACKET_RIGHT,
  "\\": KEY_BACKSLASH,
  ";": KEY_SEMICOLON,
  "'": KEY_QUOTE,
  ",": KEY_COMMA,
  ".": KEY_PERIOD,
  "/": KEY_SLASH,
};

const SHIFTED_SYMBOLS: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  "_": "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  "\"": "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

class GhosttyKeyEncoder {
  private encoder: Pointer;
  private event: Pointer;
  private optionBuffer = new Uint8Array(1);
  private outLenBuffer = new BigUint64Array(1);
  private outBuffer = Buffer.alloc(128);
  private lastOptions: KeyEncoderOptions | null = null;

  constructor() {
    this.encoder = createHandle(ghostty.symbols.ghostty_key_encoder_new);
    this.event = createHandle(ghostty.symbols.ghostty_key_event_new);
  }

  encode(event: TerminalKeyEvent, options: KeyEncoderOptions): string {
    this.applyOptions(options);
    this.configureEvent(event);
    return this.encodeEvent();
  }

  private applyOptions(options: KeyEncoderOptions): void {
    if (
      this.lastOptions &&
      this.lastOptions.cursorKeyApplication === options.cursorKeyApplication &&
      this.lastOptions.keypadKeyApplication === options.keypadKeyApplication &&
      this.lastOptions.ignoreKeypadWithNumlock === options.ignoreKeypadWithNumlock &&
      this.lastOptions.altEscPrefix === options.altEscPrefix &&
      this.lastOptions.modifyOtherKeysState2 === options.modifyOtherKeysState2 &&
      this.lastOptions.kittyFlags === options.kittyFlags
    ) {
      return;
    }

    this.setOption(OPT_CURSOR_KEY_APPLICATION, options.cursorKeyApplication);
    this.setOption(OPT_KEYPAD_KEY_APPLICATION, options.keypadKeyApplication);
    this.setOption(OPT_IGNORE_KEYPAD_WITH_NUMLOCK, options.ignoreKeypadWithNumlock);
    this.setOption(OPT_ALT_ESC_PREFIX, options.altEscPrefix);
    this.setOption(OPT_MODIFY_OTHER_KEYS_STATE_2, options.modifyOtherKeysState2);
    this.setOption(OPT_KITTY_FLAGS, options.kittyFlags);

    this.lastOptions = { ...options };
  }

  private setOption(option: number, value: boolean | number): void {
    const numeric = typeof value === "boolean" ? (value ? 1 : 0) : value;
    this.optionBuffer[0] = numeric;
    ghostty.symbols.ghostty_key_encoder_setopt(this.encoder, option, this.optionBuffer);
  }

  private configureEvent(event: TerminalKeyEvent): void {
    const key = resolveKeyCode(event.key);
    const mods = resolveMods(event);
    const utf8 = getPrintableSequence(event.sequence);
    const unshifted = resolveUnshiftedCodepoint(event);

    ghostty.symbols.ghostty_key_event_set_action(this.event, KEY_ACTION_PRESS);
    ghostty.symbols.ghostty_key_event_set_key(this.event, key);
    ghostty.symbols.ghostty_key_event_set_mods(this.event, mods);
    ghostty.symbols.ghostty_key_event_set_consumed_mods(this.event, 0);
    ghostty.symbols.ghostty_key_event_set_composing(this.event, false);

    if (utf8) {
      const utf8Buffer = Buffer.from(utf8);
      ghostty.symbols.ghostty_key_event_set_utf8(this.event, utf8Buffer, utf8Buffer.length);
    } else {
      ghostty.symbols.ghostty_key_event_set_utf8(this.event, null, 0);
    }

    ghostty.symbols.ghostty_key_event_set_unshifted_codepoint(this.event, unshifted);
  }

  private encodeEvent(): string {
    this.outLenBuffer[0] = 0n;

    let result = ghostty.symbols.ghostty_key_encoder_encode(
      this.encoder,
      this.event,
      this.outBuffer,
      this.outBuffer.byteLength,
      this.outLenBuffer
    );

    if (result === GHOSTTY_OUT_OF_MEMORY) {
      const required = Number(this.outLenBuffer[0]);
      if (!Number.isFinite(required) || required <= 0) {
        return "";
      }
      this.outBuffer = Buffer.alloc(required);
      result = ghostty.symbols.ghostty_key_encoder_encode(
        this.encoder,
        this.event,
        this.outBuffer,
        this.outBuffer.byteLength,
        this.outLenBuffer
      );
    }

    if (result !== GHOSTTY_SUCCESS) {
      return "";
    }

    const written = Number(this.outLenBuffer[0]);
    if (!written) {
      return "";
    }

    return this.outBuffer.subarray(0, written).toString("utf8");
  }
}

function createHandle(
  ctor: (allocator: Pointer | null, out: BigUint64Array) => number
): Pointer {
  const out = new BigUint64Array(1);
  const result = ctor(null, out);
  if (result !== GHOSTTY_SUCCESS) {
    throw new Error(`ghostty key encoder init failed (code ${result})`);
  }
  return Number(out[0]) as Pointer;
}

function resolveKeyCode(key: string): number {
  const normalized = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SPECIAL_KEY_MAP, normalized)) {
    return SPECIAL_KEY_MAP[normalized];
  }

  if (normalized.length === 1) {
    const char = normalized;
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return KEY_A + (code - 97);
    }
    if (code >= 48 && code <= 57) {
      return KEY_DIGIT_0 + (code - 48);
    }
    if (Object.prototype.hasOwnProperty.call(PUNCT_KEY_MAP, char)) {
      return PUNCT_KEY_MAP[char];
    }
  }

  return KEY_UNIDENTIFIED;
}

function resolveMods(event: TerminalKeyEvent): number {
  let mods = 0;
  if (event.shift) mods |= MOD_SHIFT;
  if (event.ctrl) mods |= MOD_CTRL;
  if (event.alt) mods |= MOD_ALT;
  return mods;
}

function getPrintableSequence(sequence?: string): string {
  if (!sequence) return "";
  for (const char of sequence) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      return "";
    }
  }
  return sequence;
}

function resolveUnshiftedCodepoint(event: TerminalKeyEvent): number {
  if (typeof event.baseCode === "number" && event.baseCode > 0) {
    return event.baseCode;
  }

  if (event.key.length !== 1) {
    return 0;
  }

  let char = event.key;
  if (event.shift) {
    char = SHIFTED_SYMBOLS[char] ?? char.toLowerCase();
  } else {
    char = char.toLowerCase();
  }

  return char.codePointAt(0) ?? 0;
}

function getModeSafe(emulator: ITerminalEmulator, mode: number): boolean {
  try {
    return emulator.getMode(mode);
  } catch {
    return false;
  }
}

function getEncoderOptions(emulator: ITerminalEmulator): KeyEncoderOptions {
  return {
    cursorKeyApplication: emulator.getCursorKeyMode() === "application",
    keypadKeyApplication: getModeSafe(emulator, 66),
    ignoreKeypadWithNumlock: getModeSafe(emulator, 1035),
    altEscPrefix: true,
    modifyOtherKeysState2: false,
    kittyFlags: emulator.getKittyKeyboardFlags(),
  };
}

const sharedEncoder = new GhosttyKeyEncoder();

export function encodeKeyForEmulator(
  event: TerminalKeyEvent,
  emulator: ITerminalEmulator | null
): string {
  if (!emulator) return "";
  if (
    event.sequence === "\n" &&
    !event.ctrl &&
    !event.alt &&
    !event.meta &&
    !event.shift
  ) {
    return "\n";
  }
  return sharedEncoder.encode(event, getEncoderOptions(emulator));
}
