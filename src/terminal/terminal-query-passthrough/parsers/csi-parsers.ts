/**
 * CSI (Control Sequence Introducer) query parsers
 * Handles ESC[ sequences
 */

import type { TerminalQuery } from '../types';
import type { ParseResult, QueryParser } from './base';
import { FixedPatternParser } from './base';
import {
  DSR_CPR_QUERY,
  DSR_STATUS_QUERY,
  DA1_QUERY,
  DA1_QUERY_FULL,
  DA2_QUERY,
  DA2_QUERY_FULL,
  DA3_QUERY,
  DA3_QUERY_FULL,
  XTVERSION_QUERY,
  XTVERSION_QUERY_FULL,
  DECRQM_PREFIX,
  DECRQM_SUFFIX,
  KITTY_KEYBOARD_QUERY,
  XTWINOPS_14T,
  XTWINOPS_16T,
  XTWINOPS_18T,
  DECXCPR_QUERY,
} from '../constants';

/**
 * Parser for Cursor Position Report query (ESC[6n)
 */
export class CprQueryParser extends FixedPatternParser {
  protected readonly patterns = [DSR_CPR_QUERY];
  protected readonly queryType = 'cpr' as const;
}

/**
 * Parser for Device Status query (ESC[5n)
 */
export class StatusQueryParser extends FixedPatternParser {
  protected readonly patterns = [DSR_STATUS_QUERY];
  protected readonly queryType = 'status' as const;
}

/**
 * Parser for Primary Device Attributes (ESC[c or ESC[0c)
 */
export class Da1QueryParser extends FixedPatternParser {
  protected readonly patterns = [DA1_QUERY_FULL, DA1_QUERY]; // Check full first
  protected readonly queryType = 'da1' as const;
}

/**
 * Parser for Secondary Device Attributes (ESC[>c or ESC[>0c)
 */
export class Da2QueryParser extends FixedPatternParser {
  protected readonly patterns = [DA2_QUERY_FULL, DA2_QUERY]; // Check full first
  protected readonly queryType = 'da2' as const;
}

/**
 * Parser for Tertiary Device Attributes (ESC[=c or ESC[=0c)
 */
export class Da3QueryParser extends FixedPatternParser {
  protected readonly patterns = [DA3_QUERY_FULL, DA3_QUERY]; // Check full first
  protected readonly queryType = 'da3' as const;
}

/**
 * Parser for Terminal Version query (ESC[>q or ESC[>0q)
 */
export class XtversionQueryParser extends FixedPatternParser {
  protected readonly patterns = [XTVERSION_QUERY_FULL, XTVERSION_QUERY]; // Check full first
  protected readonly queryType = 'xtversion' as const;
}

/**
 * Parser for Extended Cursor Position Report (ESC[?6n)
 */
export class DecxcprQueryParser extends FixedPatternParser {
  protected readonly patterns = [DECXCPR_QUERY];
  protected readonly queryType = 'decxcpr' as const;
}

/**
 * Parser for Kitty Keyboard Protocol Query (ESC[?u)
 */
export class KittyKeyboardQueryParser extends FixedPatternParser {
  protected readonly patterns = [KITTY_KEYBOARD_QUERY];
  protected readonly queryType = 'kitty-keyboard' as const;
}

/**
 * Parser for DECRQM (Request DEC Private Mode) - ESC[?Ps$p
 * Dynamically parses the mode number
 */
export class DecrqmQueryParser implements QueryParser {
  canParse(data: string, index: number): boolean {
    return data.startsWith(DECRQM_PREFIX, index);
  }

  parse(data: string, index: number): ParseResult | null {
    // Look for the $p suffix and extract the mode number
    let endPos = index + DECRQM_PREFIX.length;
    let modeStr = '';

    while (endPos < data.length && /\d/.test(data[endPos])) {
      modeStr += data[endPos];
      endPos++;
    }

    if (modeStr.length > 0 && data.startsWith(DECRQM_SUFFIX, endPos)) {
      const totalLength = endPos + DECRQM_SUFFIX.length - index;
      return {
        query: {
          type: 'decrqm',
          startIndex: index,
          endIndex: index + totalLength,
          mode: parseInt(modeStr, 10),
        },
        length: totalLength,
      };
    }

    return null;
  }
}

/**
 * Parser for XTWINOPS window size queries (ESC[14t, ESC[16t, ESC[18t)
 */
export class XtwinopsQueryParser implements QueryParser {
  private readonly patterns: { pattern: string; winop: number }[] = [
    { pattern: XTWINOPS_14T, winop: 14 },
    { pattern: XTWINOPS_16T, winop: 16 },
    { pattern: XTWINOPS_18T, winop: 18 },
  ];

  canParse(data: string, index: number): boolean {
    return this.patterns.some(({ pattern }) => data.startsWith(pattern, index));
  }

  parse(data: string, index: number): ParseResult | null {
    for (const { pattern, winop } of this.patterns) {
      if (data.startsWith(pattern, index)) {
        return {
          query: {
            type: 'xtwinops',
            startIndex: index,
            endIndex: index + pattern.length,
            winop,
          },
          length: pattern.length,
        };
      }
    }
    return null;
  }
}

/**
 * Parser for other XTWINOPS sequences to drop silently (ESC[Ps;...t)
 * Catches window manipulation commands like resize (8;rows;cols;t) that
 * ghostty-web doesn't support and would log warnings.
 * This parser should come AFTER XtwinopsQueryParser to not intercept queries.
 */
export class XtwinopsDropParser implements QueryParser {
  // CSI followed by digits/semicolons ending in 't'
  private readonly csiPattern = '\x1b[';

  canParse(data: string, index: number): boolean {
    if (!data.startsWith(this.csiPattern, index)) return false;
    // Look ahead to see if this looks like a CSI...t sequence
    let pos = index + this.csiPattern.length;
    while (pos < data.length) {
      const char = data[pos];
      if (char === 't') return true;
      if (!/[\d;]/.test(char)) return false;
      pos++;
    }
    return false;
  }

  parse(data: string, index: number): ParseResult | null {
    if (!data.startsWith(this.csiPattern, index)) return null;

    let pos = index + this.csiPattern.length;
    // Parse digits and semicolons until we hit 't'
    while (pos < data.length) {
      const char = data[pos];
      if (char === 't') {
        const totalLength = pos + 1 - index;
        return {
          query: {
            type: 'xtwinops-drop',
            startIndex: index,
            endIndex: index + totalLength,
          },
          length: totalLength,
        };
      }
      if (!/[\d;]/.test(char)) return null;
      pos++;
    }
    return null;
  }
}

/**
 * Get all CSI query parsers in the order they should be checked.
 * Order matters for patterns that share prefixes (e.g., DA2 before DA1).
 */
export function getCsiParsers(): QueryParser[] {
  return [
    new CprQueryParser(),
    new StatusQueryParser(),
    // DA2/DA3 must come before DA1 (ESC[>c and ESC[=c before ESC[c)
    new Da2QueryParser(),
    new Da3QueryParser(),
    // XTVERSION must come before DA1 (ESC[>q before ESC[c)
    new XtversionQueryParser(),
    new Da1QueryParser(),
    // DECXCPR must come before DECRQM (both start with ESC[?)
    new DecxcprQueryParser(),
    new DecrqmQueryParser(),
    new KittyKeyboardQueryParser(),
    // XTWINOPS queries first, then drop parser for unhandled CSI...t sequences
    new XtwinopsQueryParser(),
    new XtwinopsDropParser(),
  ];
}
