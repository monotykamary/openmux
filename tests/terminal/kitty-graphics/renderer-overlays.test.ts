import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
import { KittyTransmitBroker, setKittyTransmitBroker } from '../../../src/terminal/kitty-graphics';
import { createImageInfo, createPlacement, defaultRenderTarget } from './helpers';

let KittyGraphicsRenderer: typeof import('../../../src/terminal/kitty-graphics').KittyGraphicsRenderer;

beforeAll(async () => {
  ({ KittyGraphicsRenderer } = await import('../../../src/terminal/kitty-graphics'));
});

describe('KittyGraphicsRenderer (overlays)', () => {
  afterEach(() => {
    setKittyTransmitBroker(null);
  });

  it('clips placements when overlay rects are set', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    const imageInfo = createImageInfo(3, 3n);
    const placement = createPlacement(3);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [3],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 0, 255]),
      getKittyPlacements: () => [placement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    renderer.updatePane('pane-3', {
      ptyId: 'pty-3',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
    });

    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');

    output.length = 0;
    renderer.setClipRects([{ x: 0, y: 0, width: 10, height: 10 }]);
    renderer.flush(renderTarget);

    const cleared = output.join('');
    expect(cleared).toContain('a=d');
    expect(cleared).toContain('d=i');
    expect(cleared).not.toContain('\x1b_Ga=p');

    output.length = 0;
    renderer.setClipRects([]);
    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');
  });

  it('respects visible kitty layers', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirtyBase = true;
    const baseImage = createImageInfo(4, 4n);
    const basePlacement = createPlacement(4);
    const baseEmulator = {
      getKittyImagesDirty: () => dirtyBase,
      clearKittyImagesDirty: () => {
        dirtyBase = false;
      },
      getKittyImageIds: () => [4],
      getKittyImageInfo: () => baseImage,
      getKittyImageData: () => new Uint8Array([255, 255, 0]),
      getKittyPlacements: () => [basePlacement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    let dirtyOverlay = true;
    const overlayImage = createImageInfo(5, 5n);
    const overlayPlacement = createPlacement(5);
    const overlayEmulator = {
      getKittyImagesDirty: () => dirtyOverlay,
      clearKittyImagesDirty: () => {
        dirtyOverlay = false;
      },
      getKittyImageIds: () => [5],
      getKittyImageInfo: () => overlayImage,
      getKittyImageData: () => new Uint8Array([255, 0, 255]),
      getKittyPlacements: () => [overlayPlacement],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    renderer.updatePane('pane-base', {
      ptyId: 'pty-base',
      emulator: baseEmulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
      layer: 'base',
    });

    renderer.updatePane('pane-overlay', {
      ptyId: 'pty-overlay',
      emulator: overlayEmulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: false,
      layer: 'overlay',
    });

    renderer.setVisibleLayers(['base']);
    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');

    output.length = 0;
    renderer.setVisibleLayers(['overlay']);
    renderer.flush(renderTarget);
    const joined = output.join('');
    expect(joined).toContain('a=d');
    expect(joined).toContain('\x1b_Ga=p');
  });
});
