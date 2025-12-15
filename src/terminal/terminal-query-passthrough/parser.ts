/**
 * Parser for terminal queries
 *
 * Parses PTY output to identify terminal queries that need responses.
 * Uses a Strategy pattern with pluggable query parsers for extensibility.
 */

import type { TerminalQuery, QueryParseResult } from './types';
import { ESC, DCS } from './constants';
import { getDefaultRegistry } from './query-registry';

/**
 * Quick check if data might contain terminal queries.
 * This is a fast-path optimization to avoid expensive parsing on most data.
 *
 * CRITICAL: Use specific multi-character patterns, NOT single characters!
 * Single chars like 'n', 'c', 'q' match almost ANY terminal output and cause
 * massive performance degradation as all text goes through expensive parsing.
 */
export function mightContainQueries(data: string): boolean {
  // Check for CSI sequences (ESC[)
  if (data.includes(`${ESC}[`)) {
    // DSR queries: ESC[5n (status), ESC[6n (cursor position)
    // Use 2-char patterns '5n' and '6n' - NOT single 'n' which matches everything
    if (data.includes('5n') || data.includes('6n')) {
      return true;
    }
    // DA1 queries: ESC[c or ESC[0c - check for pattern ending in 'c' after [
    // Must check specific patterns, not just 'c' which matches all text
    if (
      data.includes(`${ESC}[c`) ||
      data.includes(`${ESC}[0c`) ||
      data.includes(`${ESC}[>c`) ||
      data.includes(`${ESC}[>0c`) ||
      data.includes(`${ESC}[=c`) ||
      data.includes(`${ESC}[=0c`)
    ) {
      return true;
    }
    // XTVERSION: ESC[>q or ESC[>0q - check full patterns
    if (data.includes(`${ESC}[>q`) || data.includes(`${ESC}[>0q`)) {
      return true;
    }
    // DECRQM: ESC[?...$p - the $p suffix is specific enough
    if (data.includes('$p')) {
      return true;
    }
    // Kitty keyboard query: ESC[?u - must use full pattern
    if (data.includes(`${ESC}[?u`)) {
      return true;
    }
    // DECXCPR: ESC[?6n - extended cursor position report
    if (data.includes(`${ESC}[?6n`)) {
      return true;
    }
    // XTWINOPS: specific patterns 14t, 16t, 18t
    if (data.includes('14t') || data.includes('16t') || data.includes('18t')) {
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
 * Parse PTY output for terminal queries.
 * Uses the registry-based Strategy pattern for extensible parsing.
 *
 * @param data - The data to parse
 * @returns Object containing text segments (without queries) and parsed queries
 */
export function parseTerminalQueries(data: string): QueryParseResult {
  // Fast-path: skip parsing if no queries are likely present
  if (!mightContainQueries(data)) {
    return { textSegments: [data], queries: [] };
  }

  const textSegments: string[] = [];
  const queries: TerminalQuery[] = [];
  const registry = getDefaultRegistry();

  let currentIndex = 0;
  let textStart = 0;

  while (currentIndex < data.length) {
    // Try to parse a query at the current position
    const result = registry.tryParse(data, currentIndex);

    if (result) {
      // Found a query - save any text before it
      if (currentIndex > textStart) {
        textSegments.push(data.slice(textStart, currentIndex));
      }

      queries.push(result.query);
      currentIndex += result.length;
      textStart = currentIndex;
    } else {
      // No query at this position, move to next character
      currentIndex++;
    }
  }

  // Add remaining text after the last query
  if (textStart < data.length) {
    textSegments.push(data.slice(textStart));
  }

  return { textSegments, queries };
}

// Re-export types and registry for external use
export type { QueryParseResult, TerminalQuery } from './types';
export { QueryParserRegistry, createDefaultRegistry, getDefaultRegistry } from './query-registry';
export type { QueryParser, ParseResult } from './parsers/base';
