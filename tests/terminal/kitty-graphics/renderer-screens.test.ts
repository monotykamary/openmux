import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';
import { KittyTransmitBroker, setKittyTransmitBroker } from '../../../src/terminal/kitty-graphics';
import { createImageInfo, createPlacement, defaultRenderTarget, sendKittyTransmit } from './helpers';

let KittyGraphicsRenderer: typeof import('../../../src/terminal/kitty-graphics').KittyGraphicsRenderer;

beforeAll(async () => {
  ({ KittyGraphicsRenderer } = await import('../../../src/terminal/kitty-graphics'));
});

describe('KittyGraphicsRenderer (screen transitions)', () => {
  afterEach(() => {
    setKittyTransmitBroker(null);
  });

  it('keeps host images across alternate screen switches', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    let isAlternate = false;
    const imageInfo = createImageInfo(10, 10n);
    const placement = createPlacement(10);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => (isAlternate ? [] : [10]),
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => (isAlternate ? [] : [placement]),
      isAlternateScreen: () => isAlternate,
    } as ITerminalEmulator;

    sendKittyTransmit(broker, 'pty-10', 10, [255, 0, 0]);

    renderer.updatePane('pane-10', {
      ptyId: 'pty-10',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');

    output.length = 0;
    isAlternate = true;
    renderer.updatePane('pane-10', {
      ptyId: 'pty-10',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);

    const switchOutput = output.join('');
    expect(switchOutput).toContain('a=d');
    expect(switchOutput).toContain('d=i');
    expect(switchOutput).not.toContain('d=I');
    expect(broker.resolveHostId('pty-10', imageInfo)).toBe(1);
  });

  it('replays cached placements when returning to the main screen', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    let isAlternate = false;
    const imageInfo = createImageInfo(11, 11n);
    const placement = createPlacement(11);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => (isAlternate ? [] : [11]),
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => (isAlternate ? [] : [placement]),
      isAlternateScreen: () => isAlternate,
    } as ITerminalEmulator;

    sendKittyTransmit(broker, 'pty-11', 11, [255, 0, 0]);

    renderer.updatePane('pane-11', {
      ptyId: 'pty-11',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');

    output.length = 0;
    isAlternate = true;
    renderer.updatePane('pane-11', {
      ptyId: 'pty-11',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);

    output.length = 0;
    isAlternate = false;
    renderer.updatePane('pane-11', {
      ptyId: 'pty-11',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);

    expect(output.join('')).toContain('\x1b_Ga=p');
  });

  it('reuses cached placements after alt switch when placements are missing', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = defaultRenderTarget(output);

    let dirty = true;
    let isAlternate = false;
    let dropPlacementsOnReturn = false;
    const imageInfo = createImageInfo(12, 12n);
    const placement = createPlacement(12);
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => (isAlternate ? [] : [12]),
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => {
        if (isAlternate) return [];
        if (dropPlacementsOnReturn) return [];
        return [placement];
      },
      isAlternateScreen: () => isAlternate,
    } as ITerminalEmulator;

    sendKittyTransmit(broker, 'pty-12', 12, [255, 0, 0]);

    renderer.updatePane('pane-12', {
      ptyId: 'pty-12',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);
    expect(output.join('')).toContain('\x1b_Ga=p');

    output.length = 0;
    isAlternate = true;
    renderer.updatePane('pane-12', {
      ptyId: 'pty-12',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);

    output.length = 0;
    isAlternate = false;
    dropPlacementsOnReturn = true;
    renderer.updatePane('pane-12', {
      ptyId: 'pty-12',
      emulator,
      offsetX: 0,
      offsetY: 0,
      width: 10,
      height: 10,
      cols: 10,
      rows: 10,
      viewportOffset: 0,
      scrollbackLength: 0,
      isAlternateScreen: isAlternate,
    });
    renderer.flush(renderTarget);

    expect(output.join('')).toContain('\x1b_Ga=p');
  });
});
