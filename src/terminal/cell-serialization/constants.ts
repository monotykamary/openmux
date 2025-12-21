import type { TerminalCell } from '../../core/types';

export const CELL_SIZE = 16;

export const FLAG_BOLD = 1 << 0;
export const FLAG_ITALIC = 1 << 1;
export const FLAG_UNDERLINE = 1 << 2;
export const FLAG_STRIKETHROUGH = 1 << 3;
export const FLAG_INVERSE = 1 << 4;
export const FLAG_BLINK = 1 << 5;
export const FLAG_DIM = 1 << 6;

export function createEmptyCell(): TerminalCell {
  return {
    char: ' ',
    fg: { r: 0, g: 0, b: 0 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}
