import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
} from '../../src/terminal/emulator-interface';
import {
  KittyTransmitBroker,
  setKittyTransmitBroker,
} from '../../src/terminal/kitty-graphics';

vi.mock('../../src/terminal/capabilities', () => ({
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

let KittyGraphicsRenderer: typeof import('../../src/terminal/kitty-graphics').KittyGraphicsRenderer;

beforeAll(async () => {
  ({ KittyGraphicsRenderer } = await import('../../src/terminal/kitty-graphics'));
});

describe('KittyGraphicsRenderer', () => {
  afterEach(() => {
    setKittyTransmitBroker(null);
  });

  it('litmus: renders kitty placements when broker provides ids', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});
    setKittyTransmitBroker(broker);
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirty = true;
    const imageInfo = {
      id: 1,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 1n,
    };
    const placement = {
      imageId: 1,
      placementId: 1,
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
    };
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([255, 0, 0]),
      getKittyPlacements: () => [placement],
    } as ITerminalEmulator;

    const ESC = '\x1b';
    const payload = Buffer.from([255, 0, 0]).toString('base64');
    broker.handleSequence('pty-1', `${ESC}_Ga=t,f=24,i=1;${payload}${ESC}\\`);

    renderer.updatePane('pane-1', {
      ptyId: 'pty-1',
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

    const joined = output.join('');
    expect(joined).toContain('\x1b_Ga=p');
    expect(dirty).toBe(false);
  });

  it('clips placements when overlay rects are set', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirty = true;
    const imageInfo = {
      id: 3,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 3n,
    };
    const placement = {
      imageId: 3,
      placementId: 1,
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
    };
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [3],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 0, 255]),
      getKittyPlacements: () => [placement],
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
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirtyBase = true;
    const baseImage = {
      id: 4,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 4n,
    };
    const basePlacement = {
      imageId: 4,
      placementId: 1,
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
    };
    const baseEmulator = {
      getKittyImagesDirty: () => dirtyBase,
      clearKittyImagesDirty: () => {
        dirtyBase = false;
      },
      getKittyImageIds: () => [4],
      getKittyImageInfo: () => baseImage,
      getKittyImageData: () => new Uint8Array([255, 255, 0]),
      getKittyPlacements: () => [basePlacement],
    } as ITerminalEmulator;

    let dirtyOverlay = true;
    const overlayImage = {
      id: 5,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 5n,
    };
    const overlayPlacement = {
      imageId: 5,
      placementId: 1,
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
    };
    const overlayEmulator = {
      getKittyImagesDirty: () => dirtyOverlay,
      clearKittyImagesDirty: () => {
        dirtyOverlay = false;
      },
      getKittyImageIds: () => [5],
      getKittyImageInfo: () => overlayImage,
      getKittyImageData: () => new Uint8Array([255, 0, 255]),
      getKittyPlacements: () => [overlayPlacement],
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

  it('ignores disposed emulators', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    const emulator = {
      isDisposed: true,
      getKittyImagesDirty: () => {
        throw new Error('should not query disposed emulator');
      },
      getKittyImageIds: () => {
        throw new Error('should not query disposed emulator');
      },
      getKittyPlacements: () => {
        throw new Error('should not query disposed emulator');
      },
    } as ITerminalEmulator;

    renderer.updatePane('pane-disposed', {
      ptyId: 'pty-disposed',
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
    expect(output.join('')).toBe('');
  });

  it('clears placements when panes are removed', () => {
    const renderer = new KittyGraphicsRenderer();
    const output: string[] = [];
    const renderTarget = {
      resolution: { width: 10, height: 10 },
      terminalWidth: 10,
      terminalHeight: 10,
      writeOut: (chunk: string) => output.push(chunk),
    };

    let dirty = true;
    const imageInfo = {
      id: 2,
      number: 0,
      width: 1,
      height: 1,
      dataLength: 3,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 2n,
    };
    const placement = {
      imageId: 2,
      placementId: 1,
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
    };
    const emulator = {
      getKittyImagesDirty: () => dirty,
      clearKittyImagesDirty: () => {
        dirty = false;
      },
      getKittyImageIds: () => [2],
      getKittyImageInfo: () => imageInfo,
      getKittyImageData: () => new Uint8Array([0, 255, 0]),
      getKittyPlacements: () => [placement],
    } as ITerminalEmulator;

    renderer.updatePane('pane-2', {
      ptyId: 'pty-2',
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
    output.length = 0;

    renderer.removePane('pane-2');
    renderer.flush(renderTarget);

    const joined = output.join('');
    expect(joined).toContain('a=d');
    expect(joined).toContain('d=i');
    expect(joined).toContain('d=I');
  });
});
