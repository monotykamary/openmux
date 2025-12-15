/**
 * Parser module exports
 */

export type { QueryParser, ParseResult } from './base';
export { FixedPatternParser, TerminatedSequenceParser } from './base';

export {
  CprQueryParser,
  StatusQueryParser,
  Da1QueryParser,
  Da2QueryParser,
  Da3QueryParser,
  XtversionQueryParser,
  DecxcprQueryParser,
  KittyKeyboardQueryParser,
  DecrqmQueryParser,
  XtwinopsQueryParser,
  getCsiParsers,
} from './csi-parsers';

export {
  OscFgQueryParser,
  OscBgQueryParser,
  OscCursorQueryParser,
  OscPaletteQueryParser,
  OscClipboardQueryParser,
  getOscParsers,
} from './osc-parsers';

export { XtgettcapQueryParser, DecrqssQueryParser, getDcsParsers } from './dcs-parsers';
