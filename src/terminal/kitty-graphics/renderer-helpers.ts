import type { KittyGraphicsImageInfo } from '../emulator-interface';
import type { CellMetrics, PlacementRender, RendererLike } from './types';

export const buildScreenKey = (ptyId: string, isAlternateScreen: boolean): string =>
  `${ptyId}:${isAlternateScreen ? 'alt' : 'main'}`;

export const getScreenKeys = (ptyId: string): string[] => [
  buildScreenKey(ptyId, false),
  buildScreenKey(ptyId, true),
];

export function getCellMetrics(renderer: RendererLike): CellMetrics | null {
  const resolution = renderer.resolution ?? null;
  const terminalWidth = renderer.width || renderer.terminalWidth || 0;
  const terminalHeight = renderer.height || renderer.terminalHeight || 0;
  if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;

  const cellWidth = Math.max(1, Math.floor(resolution.width / terminalWidth));
  const cellHeight = Math.max(1, Math.floor(resolution.height / terminalHeight));
  return { cellWidth, cellHeight };
}

export function getWriter(renderer: RendererLike): ((chunk: string) => void) | null {
  if (typeof renderer.writeOut === 'function') {
    return renderer.writeOut.bind(renderer);
  }

  const stdout = renderer.stdout ?? process.stdout;
  const writer = renderer.realStdoutWrite ?? stdout.write.bind(stdout);
  if (!writer) return null;

  return (chunk: string) => {
    writer.call(stdout, chunk);
  };
}

export function isSameImage(a: KittyGraphicsImageInfo, b: KittyGraphicsImageInfo): boolean {
  return (
    a.transmitTime === b.transmitTime &&
    a.dataLength === b.dataLength &&
    a.width === b.width &&
    a.height === b.height &&
    a.format === b.format &&
    a.compression === b.compression
  );
}

export function isSameRender(a: PlacementRender, b: PlacementRender): boolean {
  return (
    a.globalRow === b.globalRow &&
    a.globalCol === b.globalCol &&
    a.columns === b.columns &&
    a.rows === b.rows &&
    a.xOffset === b.xOffset &&
    a.yOffset === b.yOffset &&
    a.sourceX === b.sourceX &&
    a.sourceY === b.sourceY &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight &&
    a.z === b.z &&
    a.hostImageId === b.hostImageId
  );
}
