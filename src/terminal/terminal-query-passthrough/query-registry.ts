/**
 * Query parser registry for extensible query parsing.
 * Uses the Strategy pattern to delegate parsing to specialized parsers.
 */

import type { QueryParser, ParseResult } from './parsers/base';
import { getCsiParsers } from './parsers/csi-parsers';
import { getOscParsers } from './parsers/osc-parsers';
import { getDcsParsers } from './parsers/dcs-parsers';

/**
 * Registry for query parsers.
 * Parsers are checked in registration order for priority.
 */
export class QueryParserRegistry {
  private parsers: QueryParser[] = [];

  /**
   * Register a parser
   * @param parser - The parser to register
   */
  register(parser: QueryParser): void {
    this.parsers.push(parser);
  }

  /**
   * Register multiple parsers
   * @param parsers - The parsers to register
   */
  registerAll(parsers: QueryParser[]): void {
    this.parsers.push(...parsers);
  }

  /**
   * Try to parse a query at the given position.
   * Checks each registered parser in order.
   *
   * @param data - The full data string
   * @param index - Current position in the data
   * @returns ParseResult if a parser matches, null otherwise
   */
  tryParse(data: string, index: number): ParseResult | null {
    for (const parser of this.parsers) {
      if (parser.canParse(data, index)) {
        const result = parser.parse(data, index);
        if (result) {
          return result;
        }
      }
    }
    return null;
  }

  /**
   * Get the number of registered parsers
   */
  get count(): number {
    return this.parsers.length;
  }

  /**
   * Clear all registered parsers
   */
  clear(): void {
    this.parsers = [];
  }
}

/**
 * Create a default registry with all standard query parsers.
 * The order of registration determines priority for overlapping patterns.
 */
export function createDefaultRegistry(): QueryParserRegistry {
  const registry = new QueryParserRegistry();

  // Register parsers in priority order
  // CSI parsers must be registered in correct order (DA2/DA3 before DA1, etc.)
  registry.registerAll(getCsiParsers());

  // OSC parsers
  registry.registerAll(getOscParsers());

  // DCS parsers
  registry.registerAll(getDcsParsers());

  return registry;
}

// Default singleton registry for convenience
let defaultRegistry: QueryParserRegistry | null = null;

/**
 * Get the default query parser registry.
 * Creates it lazily on first access.
 */
export function getDefaultRegistry(): QueryParserRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createDefaultRegistry();
  }
  return defaultRegistry;
}
