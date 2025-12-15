/**
 * OSC (Operating System Command) query parsers
 * Handles ESC] sequences
 */

import type { ParseResult, QueryParser } from './base';
import { FixedPatternParser, TerminatedSequenceParser } from './base';
import {
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
 * Get all OSC query parsers
 */
export function getOscParsers(): QueryParser[] {
  return [
    new OscFgQueryParser(),
    new OscBgQueryParser(),
    new OscCursorQueryParser(),
    new OscPaletteQueryParser(),
    new OscClipboardQueryParser(),
  ];
}
