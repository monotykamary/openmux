import { CELL_SIZE } from '../../cell-serialization';

export const DEFAULT_CODEPOINT = 0x20;
export const INVISIBLE_FLAG = 32;
export const PACKED_CELL_U32_STRIDE = 12;
export const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4;
export const ATTR_BOLD = 1;
export const ATTR_ITALIC = 4;
export const ATTR_UNDERLINE = 8;
export const ATTR_STRIKETHROUGH = 128;

export const normalizeColor = (value: number): number =>
  typeof value === 'number' && !Number.isNaN(value) ? value : 0;

export const normalizeCodepoint = (codepoint: number): number => {
  const cp = codepoint;
  if (typeof cp !== 'number' || cp < 0x20) return DEFAULT_CODEPOINT;
  if (cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xd7ff) return cp;
  if (cp >= 0xe000 && cp <= 0xfffd && cp !== 0xfffd) return cp;
  if (cp >= 0x10000 && cp <= 0xcffff) return cp;
  if (cp >= 0xe0000 && cp <= 0xeffff) return cp;
  if (cp >= 0xf0000 && cp <= 0xfffff) return cp;
  return DEFAULT_CODEPOINT;
};

export const writeCell = (
  view: DataView,
  offset: number,
  codepoint: number,
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
  flags: number,
  width: number,
  hyperlinkId: number
) => {
  view.setUint32(offset, codepoint, true);
  view.setUint8(offset + 4, fgR);
  view.setUint8(offset + 5, fgG);
  view.setUint8(offset + 6, fgB);
  view.setUint8(offset + 7, bgR);
  view.setUint8(offset + 8, bgG);
  view.setUint8(offset + 9, bgB);
  view.setUint16(offset + 10, flags, true);
  view.setUint8(offset + 12, width);
  view.setUint16(offset + 13, hyperlinkId, true);
  view.setUint8(offset + 15, 0);
};

export const CELL_BYTES = CELL_SIZE;
