/**
 * Base interface and types for terminal query parsers
 */

import type { TerminalQuery } from '../types';

/**
 * Result of attempting to parse a query at a specific position
 */
export interface ParseResult {
  /** The parsed query */
  query: TerminalQuery;
  /** Number of characters consumed */
  length: number;
}

/**
 * Interface for query parsers using the Strategy pattern.
 * Each parser is responsible for detecting and parsing a specific query type.
 */
export interface QueryParser {
  /**
   * Check if this parser can handle the data at the given index.
   * This should be a fast check for prefix matching.
   *
   * @param data - The full data string
   * @param index - Current position in the data
   * @returns true if this parser should attempt to parse at this position
   */
  canParse(data: string, index: number): boolean;

  /**
   * Parse a query at the given position.
   * Should only be called after canParse returns true.
   *
   * @param data - The full data string
   * @param index - Current position in the data
   * @returns ParseResult if successful, null if parsing fails
   */
  parse(data: string, index: number): ParseResult | null;
}

/**
 * Base class for simple fixed-string query parsers.
 * Used for queries that match a single fixed pattern.
 */
export abstract class FixedPatternParser implements QueryParser {
  protected abstract readonly patterns: string[];
  protected abstract readonly queryType: TerminalQuery['type'];

  canParse(data: string, index: number): boolean {
    return this.patterns.some((pattern) => data.startsWith(pattern, index));
  }

  parse(data: string, index: number): ParseResult | null {
    for (const pattern of this.patterns) {
      if (data.startsWith(pattern, index)) {
        return {
          query: {
            type: this.queryType,
            startIndex: index,
            endIndex: index + pattern.length,
          },
          length: pattern.length,
        };
      }
    }
    return null;
  }
}

/**
 * Base class for parsers that look for a terminator sequence (BEL or ST)
 */
export abstract class TerminatedSequenceParser implements QueryParser {
  protected abstract readonly prefix: string;

  protected readonly BEL = '\x07';
  protected readonly ST = '\x1b\\';

  canParse(data: string, index: number): boolean {
    return data.startsWith(this.prefix, index);
  }

  /**
   * Find the terminator (BEL or ST) starting from the given position
   * @returns [endPosition, terminatorLength] or null if not found
   */
  protected findTerminator(data: string, startPos: number): [number, number] | null {
    let endPos = startPos;
    while (endPos < data.length) {
      if (data[endPos] === this.BEL) {
        return [endPos, 1];
      }
      if (data.startsWith(this.ST, endPos)) {
        return [endPos, this.ST.length];
      }
      endPos++;
    }
    return null;
  }

  abstract parse(data: string, index: number): ParseResult | null;
}
