/**
 * Parser for terminal queries
 *
 * Parses PTY output to identify terminal queries that need responses.
 */

import type { TerminalQuery, QueryParseResult } from './types';
import {
  ESC, BEL, ST, DCS,
  DSR_CPR_QUERY, DSR_STATUS_QUERY,
  DA1_QUERY, DA1_QUERY_FULL, DA2_QUERY, DA2_QUERY_FULL, DA3_QUERY, DA3_QUERY_FULL,
  XTVERSION_QUERY, XTVERSION_QUERY_FULL,
  DECRQM_PREFIX, DECRQM_SUFFIX,
  DECRQSS_PREFIX,
  XTGETTCAP_PREFIX,
  KITTY_KEYBOARD_QUERY,
  XTWINOPS_14T, XTWINOPS_16T, XTWINOPS_18T,
  DECXCPR_QUERY,
  OSC_PALETTE_PREFIX,
  OSC_FG_QUERY_BEL, OSC_FG_QUERY_ST,
  OSC_BG_QUERY_BEL, OSC_BG_QUERY_ST,
  OSC_CURSOR_QUERY_BEL, OSC_CURSOR_QUERY_ST,
  OSC_CLIPBOARD_PREFIX,
} from './constants';

/**
 * Quick check if data might contain terminal queries
 * This is a fast-path optimization to avoid expensive parsing on most data
 */
export function mightContainQueries(data: string): boolean {
  // Check for CSI sequences (ESC[)
  if (data.includes(`${ESC}[`)) {
    // DSR queries (5n, 6n), DA queries (c), XTVERSION (q), DECRQM ($p), Kitty (?u)
    // XTWINOPS uses specific patterns 14t, 16t, 18t to avoid false positives
    if (data.includes('n') || data.includes('c') || data.includes('q') ||
        data.includes('$p') || data.includes('?u') ||
        data.includes('14t') || data.includes('16t') || data.includes('18t')) {
      return true;
    }
  }
  // Check for OSC queries (ESC]4;, ESC]10;?, ESC]11;?, ESC]12;?, ESC]52;)
  if (data.includes(`${ESC}]`)) {
    if (data.includes(';?') || data.includes(']4;') || data.includes(']52;')) {
      return true;
    }
  }
  // Check for DCS sequences (XTGETTCAP, DECRQSS)
  if (data.includes(DCS)) {
    return true;
  }
  return false;
}

/**
 * Parse PTY output for terminal queries
 */
export function parseTerminalQueries(data: string): QueryParseResult {
  const textSegments: string[] = [];
  const queries: TerminalQuery[] = [];

  if (!mightContainQueries(data)) {
    return { textSegments: [data], queries: [] };
  }

  let currentIndex = 0;
  let textStart = 0;

  while (currentIndex < data.length) {
    // Check for CPR query (ESC[6n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_CPR_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'cpr',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    // Check for Device Status query (ESC[5n)
    if (currentIndex + 4 <= data.length && data.startsWith(DSR_STATUS_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'status',
        startIndex: currentIndex,
        endIndex: currentIndex + 4,
      });
      currentIndex += 4;
      textStart = currentIndex;
      continue;
    }

    // Check for DA2 (Secondary Device Attributes) - must check before DA1
    // DA2: ESC[>c or ESC[>0c
    if (data.startsWith(DA2_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY_FULL.length,
      });
      currentIndex += DA2_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA2_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da2',
        startIndex: currentIndex,
        endIndex: currentIndex + DA2_QUERY.length,
      });
      currentIndex += DA2_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DA3 (Tertiary Device Attributes) - must check before DA1
    // DA3: ESC[=c or ESC[=0c
    if (data.startsWith(DA3_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da3',
        startIndex: currentIndex,
        endIndex: currentIndex + DA3_QUERY_FULL.length,
      });
      currentIndex += DA3_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA3_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da3',
        startIndex: currentIndex,
        endIndex: currentIndex + DA3_QUERY.length,
      });
      currentIndex += DA3_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for XTVERSION - must check before DA1 since ESC[>0q contains 'c'-like pattern
    // XTVERSION: ESC[>q or ESC[>0q
    if (data.startsWith(XTVERSION_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtversion',
        startIndex: currentIndex,
        endIndex: currentIndex + XTVERSION_QUERY_FULL.length,
      });
      currentIndex += XTVERSION_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(XTVERSION_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtversion',
        startIndex: currentIndex,
        endIndex: currentIndex + XTVERSION_QUERY.length,
      });
      currentIndex += XTVERSION_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DA1 (Primary Device Attributes)
    // DA1: ESC[c or ESC[0c
    if (data.startsWith(DA1_QUERY_FULL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY_FULL.length,
      });
      currentIndex += DA1_QUERY_FULL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(DA1_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'da1',
        startIndex: currentIndex,
        endIndex: currentIndex + DA1_QUERY.length,
      });
      currentIndex += DA1_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DECXCPR (Extended Cursor Position Report) - ESC[?6n
    // Must check before DECRQM since both start with ESC[?
    if (data.startsWith(DECXCPR_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'decxcpr',
        startIndex: currentIndex,
        endIndex: currentIndex + DECXCPR_QUERY.length,
      });
      currentIndex += DECXCPR_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for DECRQM (Request DEC Private Mode) - ESC[?Ps$p
    // Need to parse the mode number dynamically
    if (data.startsWith(DECRQM_PREFIX, currentIndex)) {
      // Look for the $p suffix and extract the mode number
      let endPos = currentIndex + DECRQM_PREFIX.length;
      let modeStr = '';
      while (endPos < data.length && /\d/.test(data[endPos])) {
        modeStr += data[endPos];
        endPos++;
      }
      if (modeStr.length > 0 && data.startsWith(DECRQM_SUFFIX, endPos)) {
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }
        queries.push({
          type: 'decrqm',
          startIndex: currentIndex,
          endIndex: endPos + DECRQM_SUFFIX.length,
          mode: parseInt(modeStr, 10),
        });
        currentIndex = endPos + DECRQM_SUFFIX.length;
        textStart = currentIndex;
        continue;
      }
    }

    // Check for Kitty Keyboard Protocol Query - ESC[?u
    if (data.startsWith(KITTY_KEYBOARD_QUERY, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'kitty-keyboard',
        startIndex: currentIndex,
        endIndex: currentIndex + KITTY_KEYBOARD_QUERY.length,
      });
      currentIndex += KITTY_KEYBOARD_QUERY.length;
      textStart = currentIndex;
      continue;
    }

    // Check for XTWINOPS window size queries - use full patterns to avoid false positives
    // ESC[14t = window size in pixels, ESC[16t = cell size, ESC[18t = text area chars
    if (data.startsWith(XTWINOPS_14T, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtwinops',
        startIndex: currentIndex,
        endIndex: currentIndex + XTWINOPS_14T.length,
        winop: 14,
      });
      currentIndex += XTWINOPS_14T.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(XTWINOPS_16T, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtwinops',
        startIndex: currentIndex,
        endIndex: currentIndex + XTWINOPS_16T.length,
        winop: 16,
      });
      currentIndex += XTWINOPS_16T.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(XTWINOPS_18T, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'xtwinops',
        startIndex: currentIndex,
        endIndex: currentIndex + XTWINOPS_18T.length,
        winop: 18,
      });
      currentIndex += XTWINOPS_18T.length;
      textStart = currentIndex;
      continue;
    }

    // Check for XTGETTCAP (Termcap Query) - DCS+qXXXX...ST or DCS+qXXXX...BEL
    if (data.startsWith(XTGETTCAP_PREFIX, currentIndex)) {
      // Find the terminator (ST = ESC\ or BEL)
      let endPos = currentIndex + XTGETTCAP_PREFIX.length;
      let terminated = false;
      let terminatorLen = 0;
      while (endPos < data.length) {
        if (data[endPos] === BEL) {
          terminated = true;
          terminatorLen = 1;
          break;
        }
        if (data.startsWith(ST, endPos)) {
          terminated = true;
          terminatorLen = ST.length;
          break;
        }
        endPos++;
      }
      if (terminated) {
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }
        // Extract capability names (hex-encoded, separated by ;)
        const capsHex = data.slice(currentIndex + XTGETTCAP_PREFIX.length, endPos);
        const capabilities = capsHex.split(';').filter(s => s.length > 0);
        queries.push({
          type: 'xtgettcap',
          startIndex: currentIndex,
          endIndex: endPos + terminatorLen,
          capabilities,
        });
        currentIndex = endPos + terminatorLen;
        textStart = currentIndex;
        continue;
      }
    }

    // Check for OSC 4 palette color query - ESC]4;index;?BEL or ESC]4;index;?ST
    if (data.startsWith(OSC_PALETTE_PREFIX, currentIndex)) {
      // Parse: ESC]4;index;?terminator
      let endPos = currentIndex + OSC_PALETTE_PREFIX.length;
      let indexStr = '';
      while (endPos < data.length && /\d/.test(data[endPos])) {
        indexStr += data[endPos];
        endPos++;
      }
      // Check for ;? followed by terminator
      if (indexStr.length > 0 && data.startsWith(';?', endPos)) {
        endPos += 2; // Skip ;?
        let terminatorLen = 0;
        if (data[endPos] === BEL) {
          terminatorLen = 1;
        } else if (data.startsWith(ST, endPos)) {
          terminatorLen = ST.length;
        }
        if (terminatorLen > 0) {
          if (currentIndex > textStart) {
            textSegments.push(data.slice(textStart, currentIndex));
          }
          queries.push({
            type: 'osc-palette',
            startIndex: currentIndex,
            endIndex: endPos + terminatorLen,
            colorIndex: parseInt(indexStr, 10),
          });
          currentIndex = endPos + terminatorLen;
          textStart = currentIndex;
          continue;
        }
      }
    }

    // Check for OSC foreground color query (ESC]10;? with BEL or ST terminator)
    if (data.startsWith(OSC_FG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_BEL.length,
      });
      currentIndex += OSC_FG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_FG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-fg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_FG_QUERY_ST.length,
      });
      currentIndex += OSC_FG_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC background color query (ESC]11;? with BEL or ST terminator)
    if (data.startsWith(OSC_BG_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_BEL.length,
      });
      currentIndex += OSC_BG_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_BG_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-bg',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_BG_QUERY_ST.length,
      });
      currentIndex += OSC_BG_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC cursor color query (ESC]12;? with BEL or ST terminator)
    if (data.startsWith(OSC_CURSOR_QUERY_BEL, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-cursor',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_CURSOR_QUERY_BEL.length,
      });
      currentIndex += OSC_CURSOR_QUERY_BEL.length;
      textStart = currentIndex;
      continue;
    }
    if (data.startsWith(OSC_CURSOR_QUERY_ST, currentIndex)) {
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }
      queries.push({
        type: 'osc-cursor',
        startIndex: currentIndex,
        endIndex: currentIndex + OSC_CURSOR_QUERY_ST.length,
      });
      currentIndex += OSC_CURSOR_QUERY_ST.length;
      textStart = currentIndex;
      continue;
    }

    // Check for OSC 52 clipboard query - ESC]52;selection;?BEL or ESC]52;selection;?ST
    if (data.startsWith(OSC_CLIPBOARD_PREFIX, currentIndex)) {
      // Parse: ESC]52;selection;?terminator
      let endPos = currentIndex + OSC_CLIPBOARD_PREFIX.length;
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
        if (data[endPos] === BEL) {
          terminatorLen = 1;
        } else if (data.startsWith(ST, endPos)) {
          terminatorLen = ST.length;
        }
        if (terminatorLen > 0) {
          if (currentIndex > textStart) {
            textSegments.push(data.slice(textStart, currentIndex));
          }
          queries.push({
            type: 'osc-clipboard',
            startIndex: currentIndex,
            endIndex: endPos + terminatorLen,
            clipboardSelection: selection,
          });
          currentIndex = endPos + terminatorLen;
          textStart = currentIndex;
          continue;
        }
      }
    }

    // Check for DECRQSS (Request Status String) - DCS$qPt ST
    // Pt can be: m (SGR), "p (DECSCL), SP q (DECSCUSR), "q (DECSCA), r (DECSTBM), etc.
    if (data.startsWith(DECRQSS_PREFIX, currentIndex)) {
      // Find the terminator (ST = ESC\ or BEL)
      let endPos = currentIndex + DECRQSS_PREFIX.length;
      let terminated = false;
      let terminatorLen = 0;
      while (endPos < data.length) {
        if (data[endPos] === BEL) {
          terminated = true;
          terminatorLen = 1;
          break;
        }
        if (data.startsWith(ST, endPos)) {
          terminated = true;
          terminatorLen = ST.length;
          break;
        }
        endPos++;
      }
      if (terminated) {
        if (currentIndex > textStart) {
          textSegments.push(data.slice(textStart, currentIndex));
        }
        // Extract the status type (the part between $q and ST)
        const statusType = data.slice(currentIndex + DECRQSS_PREFIX.length, endPos);
        queries.push({
          type: 'decrqss',
          startIndex: currentIndex,
          endIndex: endPos + terminatorLen,
          statusType,
        });
        currentIndex = endPos + terminatorLen;
        textStart = currentIndex;
        continue;
      }
    }

    currentIndex++;
  }

  // Add remaining text
  if (textStart < data.length) {
    textSegments.push(data.slice(textStart));
  }

  return { textSegments, queries };
}
