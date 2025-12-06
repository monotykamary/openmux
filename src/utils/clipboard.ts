/**
 * Clipboard utilities for terminal copy/paste
 * Uses system commands (pbcopy/pbpaste on macOS, xclip on Linux)
 */

import { $ } from 'bun';

const platform = process.platform;

/**
 * Copy text to system clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (platform === 'darwin') {
      // macOS
      await $`echo -n ${text} | pbcopy`.quiet();
    } else if (platform === 'linux') {
      // Linux - try xclip first, then xsel
      try {
        await $`echo -n ${text} | xclip -selection clipboard`.quiet();
      } catch {
        await $`echo -n ${text} | xsel --clipboard --input`.quiet();
      }
    } else if (platform === 'win32') {
      // Windows
      await $`echo ${text} | clip`.quiet();
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read text from system clipboard
 */
export async function readFromClipboard(): Promise<string | null> {
  try {
    if (platform === 'darwin') {
      // macOS
      const result = await $`pbpaste`.quiet();
      return result.text();
    } else if (platform === 'linux') {
      // Linux - try xclip first, then xsel
      try {
        const result = await $`xclip -selection clipboard -o`.quiet();
        return result.text();
      } catch {
        const result = await $`xsel --clipboard --output`.quiet();
        return result.text();
      }
    } else if (platform === 'win32') {
      // Windows - use PowerShell
      const result = await $`powershell -command "Get-Clipboard"`.quiet();
      return result.text();
    }
    return null;
  } catch {
    return null;
  }
}
