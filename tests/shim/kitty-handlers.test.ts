import { describe, expect, it } from 'vitest';
import type { ITerminalEmulator, KittyGraphicsImageInfo } from '../../src/terminal/emulator-interface';
import { KittyGraphicsCompression, KittyGraphicsFormat } from '../../src/terminal/emulator-interface';
import { createKittyHandlers } from '../../src/shim/server/kitty';
import { createShimServerState } from '../../src/shim/server-state';

const makeImageInfo = (id: number, transmitTime: bigint): KittyGraphicsImageInfo => ({
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

describe('createKittyHandlers', () => {
  it('forces image data after delete-all invalidation', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];
    state.activeClient = {} as any;

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const info = makeImageInfo(1, 1n);
    const emulator: ITerminalEmulator = {
      getKittyImagesDirty: () => true,
      clearKittyImagesDirty: () => {},
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => info,
      getKittyImageData: () => new Uint8Array([1, 2, 3]),
      getKittyPlacements: () => [],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    handlers.sendKittyTransmit('pty-1', '\x1b_Ga=t,f=24,i=1;QUJD\x1b\\');
    handlers.sendKittyUpdate('pty-1', emulator, true);

    events.length = 0;

    handlers.sendKittyTransmit('pty-1', '\x1b_Ga=d,d=a\x1b\\');
    handlers.sendKittyUpdate('pty-1', emulator, false);

    const update = events.find((event) => event.header.type === 'ptyKitty');
    expect(update?.header.kitty.imageDataIds).toEqual([1]);
    expect(update?.payloads.length).toBe(1);
  });
});
