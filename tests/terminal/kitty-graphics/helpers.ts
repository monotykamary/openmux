import { Buffer } from 'buffer';
import { vi } from 'vitest';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
  type KittyGraphicsImageInfo,
  type KittyGraphicsPlacement,
} from '../../../src/terminal/emulator-interface';
import type { KittyTransmitBroker } from '../../../src/terminal/kitty-graphics';

vi.mock('../../../src/terminal/capabilities', () => ({
  getHostCapabilities: () => ({
    terminalName: 'kitty',
    da1Response: null,
    da2Response: null,
    xtversionResponse: null,
    kittyGraphics: true,
    trueColor: true,
    colors: null,
  }),
}));

export const defaultRenderTarget = (output: string[], size = 10) => ({
  resolution: { width: size, height: size },
  terminalWidth: size,
  terminalHeight: size,
  writeOut: (chunk: string) => output.push(chunk),
});

export const createImageInfo = (id: number, transmitTime: bigint): KittyGraphicsImageInfo => ({
  id,
  number: 0,
  width: 1,
  height: 1,
  dataLength: 3,
  format: KittyGraphicsFormat.RGB,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime,
});

export const createPlacement = (imageId: number, placementId: number = 1): KittyGraphicsPlacement => ({
  imageId,
  placementId,
  placementTag: KittyGraphicsPlacementTag.INTERNAL,
  screenX: 0,
  screenY: 0,
  xOffset: 0,
  yOffset: 0,
  sourceX: 0,
  sourceY: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  columns: 1,
  rows: 1,
  z: 0,
});

export const sendKittyTransmit = (
  broker: KittyTransmitBroker,
  ptyId: string,
  imageId: number,
  data: number[]
) => {
  const ESC = '\x1b';
  const payload = Buffer.from(data).toString('base64');
  broker.handleSequence(ptyId, `${ESC}_Ga=t,f=24,i=${imageId};${payload}${ESC}\\`);
};
