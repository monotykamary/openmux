import { Buffer } from 'buffer';
import type { KittyGraphicsImageInfo } from '../emulator-interface';
import type { PlacementRender } from './types';
import { prepareImageData } from './image';

const ESC = '\x1b';
const KITTY_ESCAPE = `${ESC}_G`;
const KITTY_END = `${ESC}\\`;
const BASE64_CHUNK_SIZE = 4096;

export function buildTransmitImage(hostId: number, info: KittyGraphicsImageInfo, data: Uint8Array): string {
  const prepared = prepareImageData(info, data);
  if (!prepared) {
    return '';
  }
  const { format, payload } = prepared;
  const params: Array<[string, string | number]> = [
    ['a', 't'],
    ['q', 2],
    ['f', format],
    ['t', 'd'],
    ['s', info.width],
    ['v', info.height],
    ['i', hostId],
  ];

  const buffer = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  const encoded = buffer.toString('base64');
  const chunks: string[] = [];

  for (let offset = 0; offset < encoded.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = encoded.slice(offset, offset + BASE64_CHUNK_SIZE);
    const more = offset + BASE64_CHUNK_SIZE < encoded.length;
    const chunkParams: Array<[string, string | number]> = more
      ? [...params, ['m', 1] as [string, number]]
      : params;
    chunks.push(buildKittyCommand(chunkParams, chunk));
  }

  return chunks.join('');
}

export function buildDisplay(render: PlacementRender): string {
  const params: Array<[string, string | number]> = [
    ['a', 'p'],
    ['q', 2],
    ['C', 1],
    ['i', render.hostImageId],
    ['p', render.hostPlacementId],
    ['c', render.columns],
    ['r', render.rows],
  ];

  if (render.sourceX > 0) params.push(['x', render.sourceX]);
  if (render.sourceY > 0) params.push(['y', render.sourceY]);
  if (render.sourceWidth > 0) params.push(['w', render.sourceWidth]);
  if (render.sourceHeight > 0) params.push(['h', render.sourceHeight]);
  if (render.xOffset > 0) params.push(['X', render.xOffset]);
  if (render.yOffset > 0) params.push(['Y', render.yOffset]);
  if (render.z !== 0) params.push(['z', render.z]);

  const position = `${ESC}[${render.globalRow + 1};${render.globalCol + 1}H`;
  return `${ESC}7${position}${buildKittyCommand(params)}${ESC}8`;
}

export function buildDeletePlacement(hostImageId: number, hostPlacementId: number): string {
  return buildKittyCommand([
    ['a', 'd'],
    ['q', 2],
    ['d', 'i'],
    ['i', hostImageId],
    ['p', hostPlacementId],
  ]);
}

export function buildDeleteImage(hostImageId: number): string {
  return buildKittyCommand([
    ['a', 'd'],
    ['q', 2],
    ['d', 'I'],
    ['i', hostImageId],
  ]);
}

function buildKittyCommand(params: Array<[string, string | number]>, data = ''): string {
  const control = params.map(([key, value]) => `${key}=${value}`).join(',');
  return `${KITTY_ESCAPE}${control};${data}${KITTY_END}`;
}
