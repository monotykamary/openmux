import { Buffer } from 'buffer';
import {
  ESC,
  KITTY_PREFIX_ESC,
  parsePngDimensionsFromBase64,
  parsePngDimensionsFromFilePayload,
  rebuildControl,
  type KittySequence,
  type TransmitParams,
} from '../sequence-utils';

const hostQueryMode = (() => {
  const explicit = (process.env.OPENMUX_KITTY_HOST_QUERY ?? '').toLowerCase();
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') return '1';
  if (explicit === '0' || explicit === 'false' || explicit === 'no') return '0';
  if (explicit === '2') return '2';
  return process.env.OPENMUX_PTY_TRACE ? '1' : '2';
})();

export function buildHostTransmitSequence(hostId: number, params: TransmitParams, data: string): string {
  if (!data && !params.more) return '';
  const control: string[] = [];
  control.push('a=t');
  control.push(`q=${hostQueryMode}`);
  let format = params.format;
  if (!format && params.medium === 's') {
    format = '32';
  }
  if (format) {
    control.push(`f=${format}`);
  }
  if (params.medium) {
    control.push(`t=${params.medium}`);
  }
  if (params.width) {
    control.push(`s=${params.width}`);
  }
  if (params.height) {
    control.push(`v=${params.height}`);
  }
  if (params.compression) {
    control.push(`o=${params.compression}`);
  }
  if (params.medium === 's') {
    if (params.size) {
      control.push(`S=${params.size}`);
    }
    if (params.offset) {
      control.push(`O=${params.offset}`);
    }
  }
  if (params.more) {
    control.push('m=1');
  }
  control.push(`i=${hostId}`);

  return `${KITTY_PREFIX_ESC}${control.join(',')};${data}${ESC}\\`;
}

export function buildHostFileTransmitSequence(hostId: number, params: TransmitParams, filePath: string): string {
  const control: string[] = [];
  control.push('a=t');
  control.push(`q=${hostQueryMode}`);
  if (params.format) {
    control.push(`f=${params.format}`);
  }
  control.push('t=f');
  if (params.width) {
    control.push(`s=${params.width}`);
  }
  if (params.height) {
    control.push(`v=${params.height}`);
  }
  if (params.compression) {
    control.push(`o=${params.compression}`);
  }
  control.push(`i=${hostId}`);
  const payload = Buffer.from(filePath).toString('base64');
  return `${KITTY_PREFIX_ESC}${control.join(',')};${payload}${ESC}\\`;
}

export function buildEmulatorSequence(
  parsed: KittySequence,
  params: TransmitParams,
  guestKey: string,
  stubbed: Set<string>,
  forceStub: boolean = false
): { emuSequence: string | null; dropEmulator: boolean } {
  const format = params.format ?? '';
  const isPng = format === '100';
  const allowNonPngStub = forceStub;

  const medium = params.medium ?? 'd';
  if (medium !== 'd' && medium !== 'f' && medium !== 't' && medium !== 's') {
    return { emuSequence: null, dropEmulator: false };
  }

  if (stubbed.has(guestKey)) {
    return { emuSequence: null, dropEmulator: true };
  }

  const controlParams = new Map(parsed.params);
  if (!controlParams.get('s') || !controlParams.get('v')) {
    if (medium === 's') {
      controlParams.set('s', '1');
      controlParams.set('v', '1');
    } else if (!isPng && !allowNonPngStub) {
      return { emuSequence: null, dropEmulator: false };
    }
    if (medium !== 's') {
      const dims = medium === 'd'
        ? parsePngDimensionsFromBase64(parsed.data)
        : parsePngDimensionsFromFilePayload(parsed.data);
      if (dims) {
        controlParams.set('s', String(dims.width));
        controlParams.set('v', String(dims.height));
      }
    }
  }

  if (!controlParams.get('s') || !controlParams.get('v')) {
    return { emuSequence: parsed.prefix + parsed.control + ';' + parsed.data + parsed.suffix, dropEmulator: false };
  }

  if (!isPng) {
    controlParams.set('f', '100');
  }

  if (medium !== 'd') {
    controlParams.delete('t');
  }
  controlParams.delete('m');
  controlParams.delete('o');
  controlParams.delete('S');
  controlParams.delete('O');
  const rebuiltControl = rebuildControl(controlParams);
  if (!forceStub) {
    stubbed.add(guestKey);
  }
  return { emuSequence: `${parsed.prefix}${rebuiltControl};${parsed.suffix}`, dropEmulator: false };
}
