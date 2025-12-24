/**
 * OSC (Operating System Command) query parsers
 * Handles ESC] sequences
 */

import type { ParseResult, QueryParser } from './base';
import { FixedPatternParser, TerminatedSequenceParser } from './base';
import {
  ESC,
  BEL,
  ST,
  OSC_PALETTE_PREFIX,
  OSC_FG_QUERY_BEL,
  OSC_FG_QUERY_ST,
  OSC_BG_QUERY_BEL,
  OSC_BG_QUERY_ST,
  OSC_CURSOR_QUERY_BEL,
  OSC_CURSOR_QUERY_ST,
  OSC_CLIPBOARD_PREFIX,
} from '../constants';

/**
 * Parser for OSC 10 Foreground color query
 */
export class OscFgQueryParser extends FixedPatternParser {
  protected readonly patterns = [OSC_FG_QUERY_BEL, OSC_FG_QUERY_ST];
  protected readonly queryType = 'osc-fg' as const;
}

/**
 * Parser for OSC 11 Background color query
 */
export class OscBgQueryParser extends FixedPatternParser {
  protected readonly patterns = [OSC_BG_QUERY_BEL, OSC_BG_QUERY_ST];
  protected readonly queryType = 'osc-bg' as const;
}

/**
 * Parser for OSC 12 Cursor color query
 */
export class OscCursorQueryParser extends FixedPatternParser {
  protected readonly patterns = [OSC_CURSOR_QUERY_BEL, OSC_CURSOR_QUERY_ST];
  protected readonly queryType = 'osc-cursor' as const;
}

/**
 * Parser for OSC 4 Palette color query (ESC]4;index;?terminator)
 */
export class OscPaletteQueryParser extends TerminatedSequenceParser {
  protected readonly prefix = OSC_PALETTE_PREFIX;

  parse(data: string, index: number): ParseResult | null {
    // Parse: ESC]4;index;?terminator
    let endPos = index + this.prefix.length;
    let indexStr = '';

    // Read the color index digits
    while (endPos < data.length && /\d/.test(data[endPos])) {
      indexStr += data[endPos];
      endPos++;
    }

    // Check for ;? followed by terminator
    if (indexStr.length > 0 && data.startsWith(';?', endPos)) {
      endPos += 2; // Skip ;?

      let terminatorLen = 0;
      if (data[endPos] === this.BEL) {
        terminatorLen = 1;
      } else if (data.startsWith(this.ST, endPos)) {
        terminatorLen = this.ST.length;
      }

      if (terminatorLen > 0) {
        const totalLength = endPos + terminatorLen - index;
        return {
          query: {
            type: 'osc-palette',
            startIndex: index,
            endIndex: index + totalLength,
            colorIndex: parseInt(indexStr, 10),
          },
          length: totalLength,
        };
      }
    }

    return null;
  }
}

/**
 * Parser for OSC 52 Clipboard query (ESC]52;selection;?terminator)
 */
export class OscClipboardQueryParser extends TerminatedSequenceParser {
  protected readonly prefix = OSC_CLIPBOARD_PREFIX;

  parse(data: string, index: number): ParseResult | null {
    // Parse: ESC]52;selection;?terminator
    let endPos = index + this.prefix.length;
    let selection = '';

    // Selection can be c, p, q, s, or 0-7
    while (endPos < data.length && /[cpqs0-7]/.test(data[endPos])) {
      selection += data[endPos];
      endPos++;
    }

    // Check for ;? followed by terminator (query format)
    if (selection.length > 0 && data.startsWith(';?', endPos)) {
      endPos += 2; // Skip ;?

      let terminatorLen = 0;
      if (data[endPos] === this.BEL) {
        terminatorLen = 1;
      } else if (data.startsWith(this.ST, endPos)) {
        terminatorLen = this.ST.length;
      }

      if (terminatorLen > 0) {
        const totalLength = endPos + terminatorLen - index;
        return {
          query: {
            type: 'osc-clipboard',
            startIndex: index,
            endIndex: index + totalLength,
            clipboardSelection: selection,
          },
          length: totalLength,
        };
      }
    }

    return null;
  }
}

/**
 * Parser for unhandled OSC sequences to drop silently (e.g., OSC 66)
 * Catches OSC sequences that ghostty-vt doesn't support and would log warnings.
 *
 * Note: OSC 0/1/2 (title sequences) are NOT dropped here because the title parser
 * in the worker needs to see them. They are stripped in the worker after title parsing.
 *
 * Format: ESC]number;params;terminator where terminator is BEL or ST
 */
export class OscDropParser implements QueryParser {
  private readonly oscPrefix = `${ESC}]`;
  // List of OSC codes to drop silently (codes not handled by other parsers)
  private readonly dropCodes = [66];

  canParse(data: string, index: number): boolean {
    if (!data.startsWith(this.oscPrefix, index)) return false;

    // Parse the OSC code number
    let pos = index + this.oscPrefix.length;
    let codeStr = '';
    while (pos < data.length && /\d/.test(data[pos])) {
      codeStr += data[pos];
      pos++;
    }

    if (codeStr.length === 0) return false;
    const code = parseInt(codeStr, 10);

    return this.dropCodes.includes(code);
  }

  parse(data: string, index: number): ParseResult | null {
    if (!data.startsWith(this.oscPrefix, index)) return null;

    let pos = index + this.oscPrefix.length;

    // Parse the OSC code number
    let codeStr = '';
    while (pos < data.length && /\d/.test(data[pos])) {
      codeStr += data[pos];
      pos++;
    }

    if (codeStr.length === 0) return null;
    const code = parseInt(codeStr, 10);
    if (!this.dropCodes.includes(code)) return null;

    // Find the terminator (BEL or ST)
    while (pos < data.length) {
      if (data[pos] === BEL) {
        // Found BEL terminator
        const totalLength = pos + 1 - index;
        return {
          query: {
            type: 'osc-drop',
            startIndex: index,
            endIndex: index + totalLength,
          },
          length: totalLength,
        };
      }
      if (data.startsWith(ST, pos)) {
        // Found ST terminator
        const totalLength = pos + ST.length - index;
        return {
          query: {
            type: 'osc-drop',
            startIndex: index,
            endIndex: index + totalLength,
          },
          length: totalLength,
        };
      }
      pos++;
    }

    // No terminator found yet - sequence may be incomplete
    return null;
  }
}

/**
 * Get all OSC query parsers
 */
export function getOscParsers(): QueryParser[] {
  return [
    new OscFgQueryParser(),
    new OscBgQueryParser(),
    new OscCursorQueryParser(),
    new OscPaletteQueryParser(),
    new OscClipboardQueryParser(),
    // Drop parser must come last to not intercept handled sequences
    new OscDropParser(),
  ];
}
