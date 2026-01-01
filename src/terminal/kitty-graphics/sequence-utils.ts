import { Buffer } from 'buffer';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const ESC = '\x1b';
export const APC_C1 = '\x9f';
export const ST_C1 = '\x9c';
export const KITTY_PREFIX_ESC = `${ESC}_G`;
export const KITTY_PREFIX_C1 = `${APC_C1}G`;

export type KittySequence = {
  prefix: string;
  suffix: string;
  control: string;
  data: string;
  params: Map<string, string>;
};

export type TransmitParams = {
  action: 't' | 'T';
  format?: string;
  medium?: string;
  width?: string;
  height?: string;
  compression?: string;
  more: boolean;
};

export function parseKittySequence(sequence: string): KittySequence | null {
  const prefixLen = sequence.startsWith(KITTY_PREFIX_ESC)
    ? KITTY_PREFIX_ESC.length
    : sequence.startsWith(KITTY_PREFIX_C1)
      ? KITTY_PREFIX_C1.length
      : 0;
  if (prefixLen === 0) return null;

  const suffixLen = sequence.endsWith(`${ESC}\\`) ? 2 : sequence.endsWith(ST_C1) ? 1 : 0;
  if (suffixLen === 0) return null;

  const body = sequence.slice(prefixLen, sequence.length - suffixLen);
  const semicolon = body.indexOf(';');
  const control = semicolon === -1 ? body : body.slice(0, semicolon);
  const data = semicolon === -1 ? '' : body.slice(semicolon + 1);
  const params = parseParams(control);
  return {
    prefix: sequence.slice(0, prefixLen),
    suffix: sequence.slice(sequence.length - suffixLen),
    control,
    data,
    params,
  };
}

export function parseParams(control: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!control) return params;
  let start = 0;
  while (start < control.length) {
    let end = control.indexOf(',', start);
    if (end === -1) end = control.length;
    if (end > start) {
      const part = control.slice(start, end);
      const eq = part.indexOf('=');
      if (eq !== -1) {
        const key = part.slice(0, eq);
        const value = part.slice(eq + 1);
        if (key) params.set(key, value);
      }
    }
    start = end + 1;
  }
  return params;
}

export function parseTransmitParams(parsed: KittySequence): TransmitParams | null {
  const params = parsed.params;
  const action = params.get('a');
  const hasTransmitFields =
    params.has('f') || params.has('t') || params.has('s') || params.has('v') || params.has('o') || params.has('m');
  const resolvedAction = action ?? (hasTransmitFields ? 't' : null);
  if (resolvedAction !== 't' && resolvedAction !== 'T') return null;

  return {
    action: resolvedAction,
    format: params.get('f'),
    medium: params.get('t'),
    width: params.get('s'),
    height: params.get('v'),
    compression: params.get('o'),
    more: params.get('m') === '1',
  };
}

export function mergeTransmitParams(base: TransmitParams | null, next: TransmitParams): TransmitParams {
  if (!base) return next;
  return {
    action: next.action,
    format: next.format ?? base.format,
    medium: next.medium ?? base.medium,
    width: next.width ?? base.width,
    height: next.height ?? base.height,
    compression: next.compression ?? base.compression,
    more: next.more,
  };
}

export function rebuildControl(params: Map<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(',');
}

export function buildGuestKey(imageId: string | number | null, imageNumber: string | number | null): string | null {
  if (imageId !== null && imageId !== undefined && imageId !== '' && imageId !== 0) {
    return `i:${imageId}`;
  }
  if (imageNumber !== null && imageNumber !== undefined && imageNumber !== '' && imageNumber !== 0) {
    return `I:${imageNumber}`;
  }
  return null;
}

export function normalizeParamId(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    try {
      const parsed = BigInt(value);
      if (parsed <= 0n) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }
  return value;
}

export function parsePngDimensionsFromBase64(data: string): { width: number; height: number } | null {
  if (!data) return null;
  const neededChars = 64;
  const sample = data.length > neededChars ? data.slice(0, neededChars) : data;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(sample, 'base64');
  } catch {
    return null;
  }
  return parsePngDimensionsFromBuffer(decoded);
}

export function decodeKittyFilePayload(payload: string): string | null {
  if (!payload) return null;
  try {
    return Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function parsePngDimensionsFromFilePath(filePath: string): { width: number; height: number } | null {
  if (!filePath) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(24);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead < header.length) return null;
    return parsePngDimensionsFromBuffer(header);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function parsePngDimensionsFromFilePayload(payload: string): { width: number; height: number } | null {
  const filePath = decodeKittyFilePayload(payload);
  if (!filePath) return null;
  return parsePngDimensionsFromFilePath(filePath);
}

export function estimateDecodedSize(base64: string): number {
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function createTempFilePath(counter: number): string {
  const tempDir = os.tmpdir();
  const stamp = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2);
  const name = `openmux-tty-graphics-protocol-${stamp}-${counter}-${rand}.bin`;
  return path.join(tempDir, name);
}

function parsePngDimensionsFromBuffer(decoded: Buffer): { width: number; height: number } | null {
  if (decoded.length < 24) return null;
  if (
    decoded[0] !== 0x89 ||
    decoded[1] !== 0x50 ||
    decoded[2] !== 0x4e ||
    decoded[3] !== 0x47 ||
    decoded[4] !== 0x0d ||
    decoded[5] !== 0x0a ||
    decoded[6] !== 0x1a ||
    decoded[7] !== 0x0a
  ) {
    return null;
  }
  const width = decoded.readUInt32BE(16);
  const height = decoded.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}
