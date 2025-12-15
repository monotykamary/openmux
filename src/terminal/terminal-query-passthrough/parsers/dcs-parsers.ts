/**
 * DCS (Device Control String) query parsers
 * Handles ESC P sequences
 */

import type { ParseResult, QueryParser } from './base';
import { TerminatedSequenceParser } from './base';
import { XTGETTCAP_PREFIX, DECRQSS_PREFIX } from '../constants';

/**
 * Parser for XTGETTCAP (Termcap Query) - DCS+qXXXX...ST
 */
export class XtgettcapQueryParser extends TerminatedSequenceParser {
  protected readonly prefix = XTGETTCAP_PREFIX;

  parse(data: string, index: number): ParseResult | null {
    // Find the terminator (ST = ESC\ or BEL)
    const termResult = this.findTerminator(data, index + this.prefix.length);
    if (!termResult) return null;

    const [endPos, terminatorLen] = termResult;

    // Extract capability names (hex-encoded, separated by ;)
    const capsHex = data.slice(index + this.prefix.length, endPos);
    const capabilities = capsHex.split(';').filter((s) => s.length > 0);

    const totalLength = endPos + terminatorLen - index;
    return {
      query: {
        type: 'xtgettcap',
        startIndex: index,
        endIndex: index + totalLength,
        capabilities,
      },
      length: totalLength,
    };
  }
}

/**
 * Parser for DECRQSS (Request Status String) - DCS$qPt ST
 * Pt can be: m (SGR), "p (DECSCL), SP q (DECSCUSR), "q (DECSCA), r (DECSTBM), etc.
 */
export class DecrqssQueryParser extends TerminatedSequenceParser {
  protected readonly prefix = DECRQSS_PREFIX;

  parse(data: string, index: number): ParseResult | null {
    // Find the terminator (ST = ESC\ or BEL)
    const termResult = this.findTerminator(data, index + this.prefix.length);
    if (!termResult) return null;

    const [endPos, terminatorLen] = termResult;

    // Extract the status type (the part between $q and ST)
    const statusType = data.slice(index + this.prefix.length, endPos);

    const totalLength = endPos + terminatorLen - index;
    return {
      query: {
        type: 'decrqss',
        startIndex: index,
        endIndex: index + totalLength,
        statusType,
      },
      length: totalLength,
    };
  }
}

/**
 * Get all DCS query parsers
 */
export function getDcsParsers(): QueryParser[] {
  return [new XtgettcapQueryParser(), new DecrqssQueryParser()];
}
