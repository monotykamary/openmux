/**
 * Clipboard service for cross-platform clipboard operations.
 * Migrated from Effect to errore - uses plain promises instead of Effect.Effect.
 */
import * as errore from 'errore';
import { ClipboardError } from '../errors';

export interface Clipboard {
  /** Write text to the system clipboard */
  write(text: string): Promise<ClipboardError | void>;
  /** Read text from the system clipboard */
  read(): Promise<ClipboardError | string>;
}

/** Detect if running under Wayland */
function isWayland(): boolean {
  return !!process.env.WAYLAND_DISPLAY;
}

/** Check if a command is available in PATH */
async function commandExists(cmd: string): Promise<boolean> {
  const result = await Bun.$`which ${cmd}`.quiet().catch(() => ({ exitCode: 1 }));
  return result.exitCode === 0;
}

/** Production implementation - uses platform-specific clipboard commands */
export async function createClipboard(): Promise<Clipboard> {
  const platform = process.platform;
  const wayland = isWayland();

  // Pre-detect available clipboard tools for Linux
  let hasWlCopy = false;
  let hasWlPaste = false;
  let hasXclip = false;
  let hasXsel = false;

  if (platform === 'linux') {
    hasWlCopy = await commandExists('wl-copy');
    hasWlPaste = await commandExists('wl-paste');
    hasXclip = await commandExists('xclip');
    hasXsel = await commandExists('xsel');

    // Debug logging
    if (process.env.CLIPBOARD_DEBUG) {
      console.log('[clipboard] Detection:', {
        wayland: wayland ? process.env.WAYLAND_DISPLAY : false,
        hasWlCopy,
        hasWlPaste,
        hasXclip,
        hasXsel,
      });
    }
  }

  const write = async (text: string): Promise<ClipboardError | void> => {
    // Early error for Linux with no available tools (avoids raw throw inside tryAsync)
    if (platform === 'linux' && !(wayland && hasWlCopy) && !hasXclip && !hasXsel) {
      return new ClipboardError({
        operation: 'write',
        reason: 'No clipboard tool found. Install wl-clipboard (Wayland) or xclip/xsel (X11).',
      });
    }

    const result = await errore.tryAsync<void, ClipboardError>({
      try: async () => {
        if (platform === 'darwin') {
          const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' });
          proc.stdin.write(text);
          proc.stdin.end();
          await proc.exited;
        } else if (platform === 'linux') {
          // Try Wayland first if available, then fall back to X11
          if (wayland && hasWlCopy) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using wl-copy for write');
            }
            const proc = Bun.spawn(['wl-copy'], { stdin: 'pipe' });
            proc.stdin.write(text);
            proc.stdin.end();
            await proc.exited;
          } else if (hasXclip) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using xclip for write');
            }
            const proc = Bun.spawn(['xclip', '-selection', 'clipboard'], {
              stdin: 'pipe',
            });
            proc.stdin.write(text);
            proc.stdin.end();
            await proc.exited;
          } else if (hasXsel) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using xsel for write');
            }
            const proc = Bun.spawn(['xsel', '--clipboard', '--input'], {
              stdin: 'pipe',
            });
            proc.stdin.write(text);
            proc.stdin.end();
            await proc.exited;
          }
          // No else: pre-check above guarantees a tool exists for linux
        } else if (platform === 'win32') {
          const proc = Bun.spawn(['clip'], { stdin: 'pipe' });
          proc.stdin.write(text);
          proc.stdin.end();
          await proc.exited;
        }
      },
      catch: (e) => new ClipboardError({ operation: 'write', reason: String(e), cause: e }),
    });

    // Add timeout handling
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new ClipboardError({
            operation: 'write',
            reason: 'Clipboard write timed out after 5 seconds',
          })
        );
      }, 5000);
    });

    // Race with timeout - Promise.race unwraps the error, so catch and wrap
    return Promise.race([result, timeoutPromise]).catch((error) => {
      if (error instanceof ClipboardError) return error;
      return new ClipboardError({ operation: 'write', reason: String(error) });
    });
  };

  const read = async (): Promise<ClipboardError | string> => {
    // Early error for Linux with no available tools (avoids raw throw inside tryAsync)
    if (platform === 'linux' && !(wayland && hasWlPaste) && !hasXclip && !hasXsel) {
      return new ClipboardError({
        operation: 'read',
        reason: 'No clipboard tool found. Install wl-clipboard (Wayland) or xclip/xsel (X11).',
      });
    }

    const result = await errore.tryAsync<string, ClipboardError>({
      try: async () => {
        if (platform === 'darwin') {
          const result = await Bun.$`pbpaste`.quiet();
          return result.text();
        } else if (platform === 'linux') {
          // Try Wayland first if available, then fall back to X11
          if (wayland && hasWlPaste) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using wl-paste for read');
            }
            const result = await Bun.$`wl-paste --no-newline`.quiet();
            return result.text();
          } else if (hasXclip) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using xclip for read');
            }
            const result = await Bun.$`xclip -selection clipboard -o`.quiet();
            return result.text();
          } else if (hasXsel) {
            if (process.env.CLIPBOARD_DEBUG) {
              console.log('[clipboard] Using xsel for read');
            }
            const result = await Bun.$`xsel --clipboard --output`.quiet();
            return result.text();
          }
          // No else: pre-check above guarantees a tool exists for linux
        } else if (platform === 'win32') {
          const result = await Bun.$`powershell -command "Get-Clipboard"`.quiet();
          return result.text();
        }
        return '';
      },
      catch: (e) => new ClipboardError({ operation: 'read', reason: String(e), cause: e }),
    });

    // Add timeout handling
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new ClipboardError({
            operation: 'read',
            reason: 'Clipboard read timed out after 5 seconds',
          })
        );
      }, 5000);
    });

    // Race with timeout - Promise.race unwraps the error, so catch and wrap
    return Promise.race([result, timeoutPromise]).catch((error) => {
      if (error instanceof ClipboardError) return error;
      return new ClipboardError({ operation: 'read', reason: String(error) });
    });
  };

  return {
    write,
    read,
  };
}

/** Test implementation - in-memory clipboard for testing */
export function createTestClipboard(): Clipboard {
  let buffer = '';

  const write = async (text: string): Promise<ClipboardError | void> => {
    buffer = text;
  };

  const read = async (): Promise<ClipboardError | string> => {
    return buffer;
  };

  return {
    write,
    read,
  };
}
