/**
 * Tests for terminal query parser
 * These tests capture the behavior of parseTerminalQueries and mightContainQueries
 */
import { describe, test, expect } from 'vitest';
import { parseTerminalQueries, mightContainQueries } from '../../src/terminal/terminal-query-passthrough/parser';
import {
  ESC, BEL, ST, DCS,
  DSR_CPR_QUERY, DSR_STATUS_QUERY,
  DA1_QUERY, DA1_QUERY_FULL, DA2_QUERY, DA2_QUERY_FULL, DA3_QUERY, DA3_QUERY_FULL,
  XTVERSION_QUERY, XTVERSION_QUERY_FULL,
  KITTY_KEYBOARD_QUERY,
  XTWINOPS_14T, XTWINOPS_16T, XTWINOPS_18T,
  DECXCPR_QUERY,
  OSC_FG_QUERY_BEL, OSC_FG_QUERY_ST,
  OSC_BG_QUERY_BEL, OSC_BG_QUERY_ST,
  OSC_CURSOR_QUERY_BEL, OSC_CURSOR_QUERY_ST,
} from '../../src/terminal/terminal-query-passthrough/constants';

describe('mightContainQueries', () => {
  describe('returns false for regular text', () => {
    test('plain text without escapes', () => {
      expect(mightContainQueries('hello world')).toBe(false);
    });

    test('text with common characters', () => {
      expect(mightContainQueries('The quick brown fox jumps over the lazy dog')).toBe(false);
    });

    test('text with numbers', () => {
      expect(mightContainQueries('123456789')).toBe(false);
    });

    test('empty string', () => {
      expect(mightContainQueries('')).toBe(false);
    });
  });

  describe('returns true for CSI queries', () => {
    test('DSR CPR query (ESC[6n)', () => {
      expect(mightContainQueries(DSR_CPR_QUERY)).toBe(true);
    });

    test('DSR status query (ESC[5n)', () => {
      expect(mightContainQueries(DSR_STATUS_QUERY)).toBe(true);
    });

    test('DA1 query (ESC[c)', () => {
      expect(mightContainQueries(DA1_QUERY)).toBe(true);
    });

    test('DA2 query (ESC[>c)', () => {
      expect(mightContainQueries(DA2_QUERY)).toBe(true);
    });

    test('DA3 query (ESC[=c)', () => {
      expect(mightContainQueries(DA3_QUERY)).toBe(true);
    });

    test('XTVERSION query (ESC[>q)', () => {
      expect(mightContainQueries(XTVERSION_QUERY)).toBe(true);
    });

    test('DECRQM query ($p suffix)', () => {
      expect(mightContainQueries(`${ESC}[?25$p`)).toBe(true);
    });

    test('Kitty keyboard query (ESC[?u)', () => {
      expect(mightContainQueries(KITTY_KEYBOARD_QUERY)).toBe(true);
    });

    test('DECXCPR query (ESC[?6n)', () => {
      expect(mightContainQueries(DECXCPR_QUERY)).toBe(true);
    });

    test('XTWINOPS queries', () => {
      expect(mightContainQueries(XTWINOPS_14T)).toBe(true);
      expect(mightContainQueries(XTWINOPS_16T)).toBe(true);
      expect(mightContainQueries(XTWINOPS_18T)).toBe(true);
    });
  });

  describe('returns true for OSC queries', () => {
    test('OSC foreground query', () => {
      expect(mightContainQueries(OSC_FG_QUERY_BEL)).toBe(true);
    });

    test('OSC background query', () => {
      expect(mightContainQueries(OSC_BG_QUERY_BEL)).toBe(true);
    });

    test('OSC palette query', () => {
      expect(mightContainQueries(`${ESC}]4;0;?${BEL}`)).toBe(true);
    });

    test('OSC clipboard query', () => {
      expect(mightContainQueries(`${ESC}]52;c;?${BEL}`)).toBe(true);
    });
  });

  describe('returns true for DCS queries', () => {
    test('XTGETTCAP query', () => {
      expect(mightContainQueries(`${DCS}+q${ST}`)).toBe(true);
    });

    test('DECRQSS query', () => {
      expect(mightContainQueries(`${DCS}$qm${ST}`)).toBe(true);
    });
  });

  describe('embedded in text', () => {
    test('query at start', () => {
      expect(mightContainQueries(`${DSR_CPR_QUERY}hello`)).toBe(true);
    });

    test('query at end', () => {
      expect(mightContainQueries(`hello${DSR_CPR_QUERY}`)).toBe(true);
    });

    test('query in middle', () => {
      expect(mightContainQueries(`hello${DSR_CPR_QUERY}world`)).toBe(true);
    });
  });
});

describe('parseTerminalQueries', () => {
  describe('no queries', () => {
    test('returns text unchanged when no queries present', () => {
      const result = parseTerminalQueries('hello world');
      expect(result.textSegments).toEqual(['hello world']);
      expect(result.queries).toEqual([]);
    });

    test('handles empty string', () => {
      const result = parseTerminalQueries('');
      expect(result.textSegments).toEqual(['']);
      expect(result.queries).toEqual([]);
    });
  });

  describe('CPR query (ESC[6n)', () => {
    test('parses standalone CPR query', () => {
      const result = parseTerminalQueries(DSR_CPR_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual([]);
    });

    test('parses CPR query with text before', () => {
      const result = parseTerminalQueries(`prefix${DSR_CPR_QUERY}`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['prefix']);
    });

    test('parses CPR query with text after', () => {
      const result = parseTerminalQueries(`${DSR_CPR_QUERY}suffix`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['suffix']);
    });

    test('parses CPR query with text before and after', () => {
      const result = parseTerminalQueries(`prefix${DSR_CPR_QUERY}suffix`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['prefix', 'suffix']);
    });
  });

  describe('Device Status query (ESC[5n)', () => {
    test('parses status query', () => {
      const result = parseTerminalQueries(DSR_STATUS_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('status');
    });
  });

  describe('Device Attributes queries', () => {
    test('parses DA1 query (ESC[c)', () => {
      const result = parseTerminalQueries(DA1_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da1');
    });

    test('parses DA1 full query (ESC[0c)', () => {
      const result = parseTerminalQueries(DA1_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da1');
    });

    test('parses DA2 query (ESC[>c)', () => {
      const result = parseTerminalQueries(DA2_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da2');
    });

    test('parses DA2 full query (ESC[>0c)', () => {
      const result = parseTerminalQueries(DA2_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da2');
    });

    test('parses DA3 query (ESC[=c)', () => {
      const result = parseTerminalQueries(DA3_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da3');
    });

    test('parses DA3 full query (ESC[=0c)', () => {
      const result = parseTerminalQueries(DA3_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da3');
    });
  });

  describe('XTVERSION query (ESC[>q)', () => {
    test('parses XTVERSION query', () => {
      const result = parseTerminalQueries(XTVERSION_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtversion');
    });

    test('parses XTVERSION full query (ESC[>0q)', () => {
      const result = parseTerminalQueries(XTVERSION_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtversion');
    });
  });

  describe('DECXCPR query (ESC[?6n)', () => {
    test('parses DECXCPR query', () => {
      const result = parseTerminalQueries(DECXCPR_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decxcpr');
    });
  });

  describe('DECRQM query (ESC[?Ps$p)', () => {
    test('parses DECRQM query for mode 25', () => {
      const query = `${ESC}[?25$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(25);
    });

    test('parses DECRQM query for mode 1', () => {
      const query = `${ESC}[?1$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(1);
    });

    test('parses DECRQM query for mode 2004', () => {
      const query = `${ESC}[?2004$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(2004);
    });
  });

  describe('Kitty Keyboard query (ESC[?u)', () => {
    test('parses Kitty keyboard query', () => {
      const result = parseTerminalQueries(KITTY_KEYBOARD_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('kitty-keyboard');
    });
  });

  describe('XTWINOPS queries', () => {
    test('parses XTWINOPS 14t (window size pixels)', () => {
      const result = parseTerminalQueries(XTWINOPS_14T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(14);
    });

    test('parses XTWINOPS 16t (cell size)', () => {
      const result = parseTerminalQueries(XTWINOPS_16T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(16);
    });

    test('parses XTWINOPS 18t (text area)', () => {
      const result = parseTerminalQueries(XTWINOPS_18T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(18);
    });
  });

  describe('XTGETTCAP query (DCS+q...ST)', () => {
    test('parses XTGETTCAP query with BEL terminator', () => {
      const query = `${DCS}+qTN${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN']);
    });

    test('parses XTGETTCAP query with ST terminator', () => {
      const query = `${DCS}+qTN${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN']);
    });

    test('parses XTGETTCAP query with multiple capabilities', () => {
      const query = `${DCS}+qTN;Co;RGB${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN', 'Co', 'RGB']);
    });
  });

  describe('OSC color queries', () => {
    test('parses OSC 10 foreground query with BEL', () => {
      const result = parseTerminalQueries(OSC_FG_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-fg');
    });

    test('parses OSC 10 foreground query with ST', () => {
      const result = parseTerminalQueries(OSC_FG_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-fg');
    });

    test('parses OSC 11 background query with BEL', () => {
      const result = parseTerminalQueries(OSC_BG_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-bg');
    });

    test('parses OSC 11 background query with ST', () => {
      const result = parseTerminalQueries(OSC_BG_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-bg');
    });

    test('parses OSC 12 cursor color query with BEL', () => {
      const result = parseTerminalQueries(OSC_CURSOR_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-cursor');
    });

    test('parses OSC 12 cursor color query with ST', () => {
      const result = parseTerminalQueries(OSC_CURSOR_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-cursor');
    });
  });

  describe('OSC 4 palette query', () => {
    test('parses OSC 4 palette query with BEL', () => {
      const query = `${ESC}]4;0;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(0);
    });

    test('parses OSC 4 palette query with ST', () => {
      const query = `${ESC}]4;15;?${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(15);
    });

    test('parses OSC 4 palette query for color 255', () => {
      const query = `${ESC}]4;255;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(255);
    });
  });

  describe('OSC 52 clipboard query', () => {
    test('parses OSC 52 clipboard query for clipboard', () => {
      const query = `${ESC}]52;c;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-clipboard');
      expect(result.queries[0].clipboardSelection).toBe('c');
    });

    test('parses OSC 52 clipboard query for primary', () => {
      const query = `${ESC}]52;p;?${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-clipboard');
      expect(result.queries[0].clipboardSelection).toBe('p');
    });
  });

  describe('DECRQSS query (DCS$q...ST)', () => {
    test('parses DECRQSS query for SGR (m)', () => {
      const query = `${DCS}$qm${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe('m');
    });

    test('parses DECRQSS query for DECSCUSR (space q)', () => {
      const query = `${DCS}$q q${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe(' q');
    });

    test('parses DECRQSS query for DECSTBM (r)', () => {
      const query = `${DCS}$qr${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe('r');
    });
  });

  describe('multiple queries in one string', () => {
    test('parses multiple CPR queries', () => {
      const data = `${DSR_CPR_QUERY}${DSR_CPR_QUERY}`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(2);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.queries[1].type).toBe('cpr');
    });

    test('parses different query types', () => {
      const data = `${DSR_CPR_QUERY}${DA1_QUERY}${XTVERSION_QUERY}`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(3);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.queries[1].type).toBe('da1');
      expect(result.queries[2].type).toBe('xtversion');
    });

    test('parses queries with text between them', () => {
      const data = `hello${DSR_CPR_QUERY}world${DA1_QUERY}!`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(2);
      expect(result.textSegments).toEqual(['hello', 'world', '!']);
    });
  });

  describe('index tracking', () => {
    test('tracks correct indices for CPR query', () => {
      const result = parseTerminalQueries(DSR_CPR_QUERY);
      expect(result.queries[0].startIndex).toBe(0);
      expect(result.queries[0].endIndex).toBe(DSR_CPR_QUERY.length);
    });

    test('tracks correct indices with prefix', () => {
      const prefix = 'hello';
      const result = parseTerminalQueries(`${prefix}${DSR_CPR_QUERY}`);
      expect(result.queries[0].startIndex).toBe(prefix.length);
      expect(result.queries[0].endIndex).toBe(prefix.length + DSR_CPR_QUERY.length);
    });
  });

  describe('edge cases', () => {
    test('handles incomplete escape sequence', () => {
      const result = parseTerminalQueries(`${ESC}[`);
      // Should pass through as text since it's not a complete query
      expect(result.queries).toHaveLength(0);
      expect(result.textSegments[0]).toContain(ESC);
    });

    test('handles query-like text that is not a query', () => {
      const result = parseTerminalQueries('text with 6n in it');
      // Should not match because ESC[ is not present
      expect(result.queries).toHaveLength(0);
      expect(result.textSegments).toEqual(['text with 6n in it']);
    });
  });

  describe('XTWINOPS drop parser (filters non-query CSI...t sequences)', () => {
    test('filters CSI 8;rows;cols;t (resize command)', () => {
      const result = parseTerminalQueries(`${ESC}[8;51;181t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
      expect(result.textSegments).toEqual([]);
    });

    test('filters CSI 4;height;width;t (resize in pixels response format)', () => {
      const result = parseTerminalQueries(`${ESC}[4;800;1200t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('filters CSI 6;h;w;t (cell size response format)', () => {
      const result = parseTerminalQueries(`${ESC}[6;16;8t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('filters CSI 1t (deiconify window)', () => {
      const result = parseTerminalQueries(`${ESC}[1t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('does NOT filter XTWINOPS queries (14t, 16t, 18t)', () => {
      // These should be parsed as 'xtwinops' type, not 'xtwinops-drop'
      const result14 = parseTerminalQueries(XTWINOPS_14T);
      expect(result14.queries[0].type).toBe('xtwinops');

      const result16 = parseTerminalQueries(XTWINOPS_16T);
      expect(result16.queries[0].type).toBe('xtwinops');

      const result18 = parseTerminalQueries(XTWINOPS_18T);
      expect(result18.queries[0].type).toBe('xtwinops');
    });

    test('filters CSI with mixed params ending in t', () => {
      const result = parseTerminalQueries(`${ESC}[3;100;200t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('preserves text around filtered sequences', () => {
      const result = parseTerminalQueries(`hello${ESC}[8;51;181tworld`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
      expect(result.textSegments).toEqual(['hello', 'world']);
    });
  });
});
