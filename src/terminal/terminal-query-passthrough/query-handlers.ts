import type { TerminalQuery } from './types';
import { tracePtyEvent } from '../pty-trace';
import { KNOWN_CAPABILITIES, KNOWN_MODES, DEFAULT_PALETTE } from './constants';
import {
  hexToString,
  generateCprResponse,
  generateDecxcprResponse,
  generateStatusOkResponse,
  generateDa1Response,
  generateDa2Response,
  generateDa3Response,
  generateOscFgResponse,
  generateOscBgResponse,
  generateOscCursorResponse,
  generateOscPaletteResponse,
  generateDecrpmResponse,
  generateXtgettcapResponse,
  generateXtwinopsResponse,
  generateXtversionResponse,
  generateKittyKeyboardResponse,
  generateDecrqssValidResponse,
  generateDecrqssInvalidResponse,
  generateOscClipboardEmptyResponse,
} from './responses';

export type QueryHandlerContext = {
  write: (data: string) => void;
  cursorGetter: (() => { x: number; y: number }) | null;
  colorsGetter: (() => { foreground: number; background: number }) | null;
  modeGetter: ((mode: number) => boolean | null) | null;
  paletteGetter: ((index: number) => number | null) | null;
  sizeGetter: (() => {
    cols: number;
    rows: number;
    pixelWidth: number;
    pixelHeight: number;
    cellWidth: number;
    cellHeight: number;
  }) | null;
  kittyKeyboardFlags: number;
  kittyKeyboardFlagsGetter: (() => number) | null;
  terminalVersion: string;
  cursorColor: number;
};

export function handleTerminalQuery(query: TerminalQuery, context: QueryHandlerContext): void {
  tracePtyEvent('query-handle', {
    queryType: query.type,
    mode: query.type === 'decrqm' ? query.mode : undefined,
    winop: query.type === 'xtwinops' ? query.winop : undefined,
  });

  if (query.type === 'cpr') {
    const cursor = context.cursorGetter?.() ?? { x: 0, y: 0 };
    context.write(generateCprResponse(cursor.y, cursor.x));
  } else if (query.type === 'decxcpr') {
    const cursor = context.cursorGetter?.() ?? { x: 0, y: 0 };
    context.write(generateDecxcprResponse(cursor.y, cursor.x));
  } else if (query.type === 'status') {
    context.write(generateStatusOkResponse());
  } else if (query.type === 'osc-fg') {
    const colors = context.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
    const r = (colors.foreground >> 16) & 0xFF;
    const g = (colors.foreground >> 8) & 0xFF;
    const b = colors.foreground & 0xFF;
    context.write(generateOscFgResponse(r, g, b));
  } else if (query.type === 'da1') {
    context.write(generateDa1Response());
  } else if (query.type === 'da2') {
    context.write(generateDa2Response());
  } else if (query.type === 'da3') {
    context.write(generateDa3Response());
  } else if (query.type === 'xtversion') {
    context.write(generateXtversionResponse('openmux', context.terminalVersion));
  } else if (query.type === 'decrqm') {
    const mode = query.mode ?? 0;
    let value: 0 | 1 | 2 | 3 | 4 = 0;

    if (context.modeGetter) {
      const state = context.modeGetter(mode);
      if (state !== null) {
        value = state ? 1 : 2;
      } else if (mode in KNOWN_MODES) {
        value = KNOWN_MODES[mode];
      }
    } else if (mode in KNOWN_MODES) {
      value = KNOWN_MODES[mode];
    }

    context.write(generateDecrpmResponse(mode, value));
  } else if (query.type === 'xtgettcap') {
    const caps = new Map<string, string | null>();
    for (const hexName of query.capabilities ?? []) {
      const name = hexToString(hexName);
      if (name in KNOWN_CAPABILITIES) {
        caps.set(name, KNOWN_CAPABILITIES[name]);
      } else {
        caps.set(name, null);
      }
    }
    context.write(generateXtgettcapResponse(caps));
  } else if (query.type === 'kitty-keyboard') {
    const flags = context.kittyKeyboardFlagsGetter
      ? context.kittyKeyboardFlagsGetter()
      : context.kittyKeyboardFlags;
    context.write(generateKittyKeyboardResponse(flags));
  } else if (query.type === 'osc-bg') {
    const colors = context.colorsGetter?.() ?? { foreground: 0xFFFFFF, background: 0x000000 };
    const r = (colors.background >> 16) & 0xFF;
    const g = (colors.background >> 8) & 0xFF;
    const b = colors.background & 0xFF;
    context.write(generateOscBgResponse(r, g, b));
  } else if (query.type === 'osc-cursor') {
    const r = (context.cursorColor >> 16) & 0xFF;
    const g = (context.cursorColor >> 8) & 0xFF;
    const b = context.cursorColor & 0xFF;
    context.write(generateOscCursorResponse(r, g, b));
  } else if (query.type === 'osc-palette') {
    const index = query.colorIndex ?? 0;
    let color: number;
    if (context.paletteGetter) {
      const customColor = context.paletteGetter(index);
      color = customColor ?? (DEFAULT_PALETTE[index] ?? 0);
    } else {
      color = DEFAULT_PALETTE[index] ?? 0;
    }
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    context.write(generateOscPaletteResponse(index, r, g, b));
  } else if (query.type === 'xtwinops') {
    const winop = query.winop ?? 18;
    tracePtyEvent('xtwinops-start', { winop });
    try {
      if (context.sizeGetter) {
        const size = context.sizeGetter();
        tracePtyEvent('xtwinops-size', {
          winop,
          cols: size.cols,
          rows: size.rows,
          pixelWidth: size.pixelWidth,
          pixelHeight: size.pixelHeight,
          cellWidth: size.cellWidth,
          cellHeight: size.cellHeight,
        });
        let height: number, width: number;
        switch (winop) {
          case 14:
            height = size.pixelHeight;
            width = size.pixelWidth;
            break;
          case 16:
            height = size.cellHeight;
            width = size.cellWidth;
            break;
          case 18:
          default:
            height = size.rows;
            width = size.cols;
            break;
        }
        const response = generateXtwinopsResponse(winop, height, width);
        tracePtyEvent('xtwinops-response', { winop, height, width, len: response.length });
        context.write(response);
        tracePtyEvent('xtwinops-response-written', { winop, len: response.length });
      } else {
        const response = generateXtwinopsResponse(winop, 24, 80);
        tracePtyEvent('xtwinops-response', { winop, height: 24, width: 80, len: response.length });
        context.write(response);
        tracePtyEvent('xtwinops-response-written', { winop, len: response.length });
      }
    } catch (err) {
      tracePtyEvent('xtwinops-error', { winop, error: err });
    }
  } else if (query.type === 'osc-clipboard') {
    const selection = query.clipboardSelection ?? 'c';
    context.write(generateOscClipboardEmptyResponse(selection));
  } else if (query.type === 'decrqss') {
    const statusType = query.statusType ?? '';
    let response: string;

    switch (statusType) {
      case 'm':
        response = generateDecrqssValidResponse('0m');
        break;
      case ' q':
        response = generateDecrqssValidResponse('1 q');
        break;
      case '"q':
        response = generateDecrqssValidResponse('0"q');
        break;
      case 'r':
        if (context.sizeGetter) {
          const size = context.sizeGetter();
          response = generateDecrqssValidResponse(`1;${size.rows}r`);
        } else {
          response = generateDecrqssValidResponse('1;24r');
        }
        break;
      case '"p':
        response = generateDecrqssValidResponse('62;1"p');
        break;
      default:
        response = generateDecrqssInvalidResponse();
        break;
    }
    context.write(response);
  }
}
