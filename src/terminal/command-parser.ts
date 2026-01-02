/**
 * OSC Command Parser - Captures openmux shell hook commands.
 *
 * Parses OSC 777 sequences of the form:
 *   ESC ] 777 ; openmux ; cmd=<encoded> BEL
 *   ESC ] 777 ; openmux ; cmd=<encoded> ST
 *
 * Where <encoded> is percent-encoded to avoid control characters.
 */

const ESC = '\x1b';
const BEL = '\x07';
const COMMAND_CODE = 777;
const COMMAND_PREFIX = 'openmux;cmd=';
const NOTIFY_CODE = 9;
const NOTIFY_PREFIX = 'notify;';

export type DesktopNotificationSource = 'osc9' | 'osc777';

export interface DesktopNotification {
  title: string;
  body: string;
  source: DesktopNotificationSource;
}

export interface CommandParserOptions {
  onCommand: (command: string) => void;
  onNotification?: (notification: DesktopNotification) => void;
  shellName?: string;
}

function decodeOscText(encoded: string): string {
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function decodeCommand(encoded: string): string {
  return decodeOscText(encoded);
}

function splitNotificationPayload(payload: string): { title: string; body: string } | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  const separatorIndex = trimmed.indexOf(';');
  if (separatorIndex === -1) {
    return { title: '', body: trimmed };
  }

  const title = trimmed.slice(0, separatorIndex).trim();
  const body = trimmed.slice(separatorIndex + 1).trim();

  if (!body) {
    return { title: '', body: title };
  }

  return { title, body };
}

function parseDesktopNotification(code: number, oscText: string): DesktopNotification | null {
  if (code === NOTIFY_CODE) {
    const decoded = decodeOscText(oscText);
    const payload = splitNotificationPayload(decoded);
    if (!payload) return null;
    return { ...payload, source: 'osc9' };
  }

  if (code === COMMAND_CODE) {
    if (!oscText.startsWith(NOTIFY_PREFIX)) return null;
    const decoded = decodeOscText(oscText.slice(NOTIFY_PREFIX.length));
    const payload = splitNotificationPayload(decoded);
    if (!payload) return null;
    return { ...payload, source: 'osc777' };
  }

  return null;
}

function stripZshPromptEolMark(command: string): string {
  const trimmed = command.trimEnd();
  if (!trimmed.endsWith('%')) return trimmed;

  const before = trimmed.slice(0, -1);
  if (before.endsWith('%')) {
    return trimmed;
  }

  const lastToken = trimmed.split(/\s+/).pop() ?? '';
  if (/^\d+%$/.test(lastToken)) {
    return trimmed;
  }

  return before.trimEnd();
}

function sanitizeCommand(command: string, shellName?: string): string {
  let result = command.trim();
  if (!result) return '';
  if ((shellName ?? '').toLowerCase() === 'zsh') {
    result = stripZshPromptEolMark(result).trim();
  }
  return result;
}

/**
 * Creates a command parser that can be called with data chunks.
 */
export function createCommandParser(options: CommandParserOptions) {
  const { onCommand, shellName, onNotification } = options;

  // State for OSC sequence parsing
  let inOscSequence = false;
  let collectingText = false;
  let oscCodeBuffer: string[] = [];
  let oscTextBuffer: string[] = [];

  function processData(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      if (inOscSequence) {
        if (char === BEL) {
          handleOscComplete();
          continue;
        }

        if (char === ESC && i + 1 < data.length && data[i + 1] === '\\') {
          i += 1;
          handleOscComplete();
          continue;
        }

        if (!collectingText) {
          if (char === ';') {
            collectingText = true;
          } else if (char >= '0' && char <= '9') {
            oscCodeBuffer.push(char);
          } else {
            resetOsc();
          }
        } else {
          oscTextBuffer.push(char);
        }
        continue;
      }

      if (char === ESC && i + 1 < data.length && data[i + 1] === ']') {
        inOscSequence = true;
        collectingText = false;
        oscCodeBuffer = [];
        oscTextBuffer = [];
        i += 1;
      }
    }
  }

  function handleOscComplete(): void {
    const oscCode = oscCodeBuffer.join('');
    const oscText = oscTextBuffer.join('');
    const code = Number.parseInt(oscCode, 10);

    let handledCommand = false;

    if (code === COMMAND_CODE && oscText.startsWith(COMMAND_PREFIX)) {
      const encoded = oscText.slice(COMMAND_PREFIX.length);
      const decoded = decodeCommand(encoded);
      const sanitized = sanitizeCommand(decoded, shellName);
      if (sanitized) {
        onCommand(sanitized);
      }
      handledCommand = true;
    }

    if (!handledCommand && onNotification) {
      const notification = parseDesktopNotification(code, oscText);
      if (notification) {
        onNotification(notification);
      }
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
  };
}
