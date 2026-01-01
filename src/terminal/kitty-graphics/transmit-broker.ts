import { Buffer } from 'buffer';
import fs from 'fs';
import { getHostCapabilities } from '../capabilities';
import type { KittyGraphicsImageInfo } from '../emulator-interface';
import type { RendererLike } from './types';
import { tracePtyEvent } from '../pty-trace';
import {
  ESC,
  KITTY_PREFIX_ESC,
  buildGuestKey,
  createTempFilePath,
  estimateDecodedSize,
  mergeTransmitParams,
  normalizeParamId,
  parseKittySequence,
  parsePngDimensionsFromBase64,
  parsePngDimensionsFromFilePayload,
  parseTransmitParams,
  rebuildControl,
  type KittySequence,
  type TransmitParams,
} from './sequence-utils';

type PendingChunk = {
  guestKey: string;
  hostId: number;
  params: TransmitParams;
  offload: OffloadState | null;
};

type PtyBrokerState = {
  hostIdByGuestKey: Map<string, number>;
  pendingChunk: PendingChunk | null;
  stubbedGuestKeys: Set<string>;
  nextSyntheticGuestId: number;
};

type OffloadState = {
  fd: number;
  filePath: string;
  carry: string;
  bytesWritten: number;
};

let activeBroker: KittyTransmitBroker | null = null;

export function getKittyTransmitBroker(): KittyTransmitBroker | null {
  return activeBroker;
}

export function setKittyTransmitBroker(broker: KittyTransmitBroker | null): void {
  activeBroker = broker;
}

export class KittyTransmitBroker {
  private writer: ((chunk: string) => void) | null = null;
  private enabled = getHostCapabilities()?.kittyGraphics ?? false;
  private nextHostImageId = 1;
  private stateByPty = new Map<string, PtyBrokerState>();
  private offloadThresholdBytes: number;
  private offloadCleanupDelayMs: number;
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private tempFileCounter = 0;

  constructor() {
    const thresholdEnv = Number(process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD ?? '');
    this.offloadThresholdBytes = Number.isFinite(thresholdEnv) && thresholdEnv >= 0
      ? thresholdEnv
      : 512 * 1024;
    const cleanupEnv = Number(process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS ?? '');
    this.offloadCleanupDelayMs = Number.isFinite(cleanupEnv) && cleanupEnv >= 0 ? cleanupEnv : 5000;
  }

  setWriter(writer: ((chunk: string) => void) | null): void {
    this.writer = writer;
  }

  setRenderer(renderer: RendererLike | null): void {
    if (!renderer) {
      this.writer = null;
      return;
    }
    const stdout = renderer.stdout ?? process.stdout;
    const writer = renderer.writeOut
      ? renderer.writeOut.bind(renderer)
      : renderer.realStdoutWrite
        ? renderer.realStdoutWrite.bind(stdout)
        : stdout.write.bind(stdout);
    this.writer = (chunk: string) => {
      writer(chunk);
    };
  }

  dispose(): void {
    this.stateByPty.clear();
    this.writer = null;
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  clearPty(ptyId: string): void {
    const state = this.stateByPty.get(ptyId);
    if (state?.pendingChunk?.offload) {
      this.abortOffload(state.pendingChunk.offload);
    }
    this.stateByPty.delete(ptyId);
  }

  resolveHostId(ptyId: string, info: KittyGraphicsImageInfo): number | null {
    const state = this.stateByPty.get(ptyId);
    if (!state) return null;
    const idKey = buildGuestKey(info.id, null);
    const numberKey = info.number > 0 ? buildGuestKey(null, info.number) : null;
    if (idKey && state.hostIdByGuestKey.has(idKey)) {
      return state.hostIdByGuestKey.get(idKey)!;
    }
    if (numberKey && state.hostIdByGuestKey.has(numberKey)) {
      return state.hostIdByGuestKey.get(numberKey)!;
    }
    return null;
  }

  dropMapping(ptyId: string, info: KittyGraphicsImageInfo): void {
    const state = this.stateByPty.get(ptyId);
    if (!state) return;
    const idKey = buildGuestKey(info.id, null);
    if (idKey) state.hostIdByGuestKey.delete(idKey);
    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) state.hostIdByGuestKey.delete(numberKey);
    }
    if (idKey) state.stubbedGuestKeys.delete(idKey);
    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) state.stubbedGuestKeys.delete(numberKey);
    }
    if (state.hostIdByGuestKey.size === 0 && !state.pendingChunk) {
      this.stateByPty.delete(ptyId);
    }
  }

  handleSequence(ptyId: string, sequence: string): string {
    if (!this.enabled || !this.writer) return sequence;
    const parsed = parseKittySequence(sequence);
    if (!parsed) return sequence;
    tracePtyEvent('kitty-broker-seq', {
      ptyId,
      control: parsed.control,
      dataLen: parsed.data.length,
      action: parsed.params.get('a') ?? '',
      format: parsed.params.get('f') ?? '',
      medium: parsed.params.get('t') ?? '',
      more: parsed.params.get('m') ?? '',
      imageId: parsed.params.get('i') ?? '',
      imageNumber: parsed.params.get('I') ?? '',
    });
    const state = this.getState(ptyId);
    let transmit = parseTransmitParams(parsed);
    if (!transmit && state.pendingChunk && parsed.params.size === 0) {
      transmit = { ...state.pendingChunk.params, more: false };
    }
    if (!transmit) return sequence;
    const guestId = normalizeParamId(parsed.params.get('i'));
    const guestNumber = normalizeParamId(parsed.params.get('I'));
    let guestKey = guestId || guestNumber ? buildGuestKey(guestId, guestNumber) : null;
    let shouldInjectId = false;
    let injectedGuestId: string | null = null;

    if (!guestKey && state.pendingChunk) {
      guestKey = state.pendingChunk.guestKey;
    }

    if (!guestKey) {
      injectedGuestId = String(state.nextSyntheticGuestId);
      state.nextSyntheticGuestId = nextSynthetic(state.nextSyntheticGuestId);
      guestKey = buildGuestKey(injectedGuestId, null);
      shouldInjectId = true;
    }

    let hostId = state.hostIdByGuestKey.get(guestKey);
    if (!hostId) {
      hostId = this.nextHostImageId++;
      state.hostIdByGuestKey.set(guestKey, hostId);
    }

    const mergedParams = mergeTransmitParams(state.pendingChunk?.params ?? null, transmit);
    const activeOffload = state.pendingChunk?.offload ?? null;
    const shouldOffload = activeOffload ?? this.shouldOffload(mergedParams, parsed.data, transmit.more);
    if (shouldOffload) {
      const offload = activeOffload ?? this.startOffload();
      if (!activeOffload && transmit.more) {
        state.pendingChunk = { guestKey, hostId, params: mergedParams, offload };
      }
      this.appendOffload(offload, parsed.data);
      if (!transmit.more) {
        const filePath = this.finishOffload(offload);
        const hostSequence = buildHostFileTransmitSequence(hostId, mergedParams, filePath);
        if (hostSequence.length > 0) {
          this.writer(hostSequence);
        }
        tracePtyEvent('kitty-broker-host', {
          ptyId,
          hostId,
          guestKey,
          offload: true,
          filePath,
          bytesWritten: offload.bytesWritten,
        });
        this.scheduleCleanup(filePath);
      }
    } else {
      const hostSequence = buildHostTransmitSequence(hostId, mergedParams, parsed.data);
      if (hostSequence.length > 0) {
        this.writer(hostSequence);
      }
      tracePtyEvent('kitty-broker-host', {
        ptyId,
        hostId,
        guestKey,
        offload: false,
        dataLen: parsed.data.length,
      });
    }

    if (shouldInjectId && injectedGuestId) {
      parsed.params.set('i', injectedGuestId);
    }

    const { emuSequence, dropEmulator } = buildEmulatorSequence(
      parsed,
      mergedParams,
      guestKey,
      state.stubbedGuestKeys
    );

    if (transmit.more) {
      if (!state.pendingChunk) {
        state.pendingChunk = { guestKey, hostId, params: mergedParams, offload: null };
      } else {
        state.pendingChunk.guestKey = guestKey;
        state.pendingChunk.hostId = hostId;
        state.pendingChunk.params = mergedParams;
      }
    } else if (!state.pendingChunk?.offload || activeOffload) {
      state.pendingChunk = null;
    }

    if (dropEmulator) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey,
        drop: true,
      });
      return '';
    }

    if (emuSequence) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey,
        stubbed: true,
      });
      return emuSequence;
    }

    if (shouldInjectId && injectedGuestId) {
      const rebuiltControl = rebuildControl(parsed.params);
      return `${parsed.prefix}${rebuiltControl};${parsed.data}${parsed.suffix}`;
    }

    return sequence;
  }

  private getState(ptyId: string): PtyBrokerState {
    let state = this.stateByPty.get(ptyId);
    if (!state) {
      state = {
        hostIdByGuestKey: new Map(),
        pendingChunk: null,
        stubbedGuestKeys: new Set(),
        nextSyntheticGuestId: 2147483647,
      };
      this.stateByPty.set(ptyId, state);
    }
    return state;
  }

  private shouldOffload(params: TransmitParams, data: string, isChunked: boolean): boolean {
    if (this.offloadThresholdBytes <= 0) return false;
    const medium = params.medium ?? 'd';
    if (medium !== 'd') return false;
    if (!data && !isChunked) return false;
    if (isChunked) return true;
    const estimated = estimateDecodedSize(data);
    return estimated >= this.offloadThresholdBytes;
  }

  private startOffload(): OffloadState {
    const filePath = createTempFilePath(this.tempFileCounter++);
    const fd = fs.openSync(filePath, 'w');
    return { fd, filePath, carry: '', bytesWritten: 0 };
  }

  private appendOffload(offload: OffloadState, data: string): void {
    if (!data) return;
    const combined = `${offload.carry}${data}`;
    const usableLen = Math.floor(combined.length / 4) * 4;
    const toDecode = usableLen > 0 ? combined.slice(0, usableLen) : '';
    offload.carry = combined.slice(usableLen);
    if (toDecode.length === 0) return;
    const decoded = Buffer.from(toDecode, 'base64');
    if (decoded.length === 0) return;
    fs.writeSync(offload.fd, decoded);
    offload.bytesWritten += decoded.length;
  }

  private finishOffload(offload: OffloadState): string {
    if (offload.carry.length > 0) {
      const decoded = Buffer.from(offload.carry, 'base64');
      if (decoded.length > 0) {
        fs.writeSync(offload.fd, decoded);
        offload.bytesWritten += decoded.length;
      }
      offload.carry = '';
    }
    fs.closeSync(offload.fd);
    return offload.filePath;
  }

  private abortOffload(offload: OffloadState): void {
    try {
      fs.closeSync(offload.fd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(offload.filePath);
    } catch {
      // ignore
    }
  }

  private scheduleCleanup(filePath: string): void {
    if (this.offloadCleanupDelayMs <= 0) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      return;
    }

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }, this.offloadCleanupDelayMs);
    this.cleanupTimers.add(timer);
  }
}

function nextSynthetic(current: number): number {
  const next = current + 1;
  if (next > 0xffffffff) return 2147483647;
  return next;
}

function buildHostTransmitSequence(hostId: number, params: TransmitParams, data: string): string {
  if (!data && !params.more) return '';
  const control: string[] = [];
  control.push('a=t');
  control.push('q=2');
  if (params.format) {
    control.push(`f=${params.format}`);
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
  if (params.more) {
    control.push('m=1');
  }
  control.push(`i=${hostId}`);

  return `${KITTY_PREFIX_ESC}${control.join(',')};${data}${ESC}\\`;
}

function buildHostFileTransmitSequence(hostId: number, params: TransmitParams, filePath: string): string {
  const control: string[] = [];
  control.push('a=t');
  control.push('q=2');
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

function buildEmulatorSequence(
  parsed: KittySequence,
  params: TransmitParams,
  guestKey: string,
  stubbed: Set<string>
): { emuSequence: string | null; dropEmulator: boolean } {
  const format = params.format ?? '';
  const isPng = format === '100';
  if (!isPng) {
    return { emuSequence: null, dropEmulator: false };
  }

  const medium = params.medium ?? 'd';
  if (medium !== 'd' && medium !== 'f' && medium !== 't') {
    return { emuSequence: null, dropEmulator: false };
  }

  if (stubbed.has(guestKey)) {
    return { emuSequence: null, dropEmulator: true };
  }

  const controlParams = new Map(parsed.params);
  if (!controlParams.get('s') || !controlParams.get('v')) {
    const dims = medium === 'd'
      ? parsePngDimensionsFromBase64(parsed.data)
      : parsePngDimensionsFromFilePayload(parsed.data);
    if (dims) {
      controlParams.set('s', String(dims.width));
      controlParams.set('v', String(dims.height));
    }
  }

  if (!controlParams.get('s') || !controlParams.get('v')) {
    return { emuSequence: parsed.prefix + parsed.control + ';' + parsed.data + parsed.suffix, dropEmulator: false };
  }

  if (medium !== 'd') {
    controlParams.delete('t');
  }
  controlParams.delete('m');
  controlParams.delete('o');
  const rebuiltControl = rebuildControl(controlParams);
  stubbed.add(guestKey);
  return { emuSequence: `${parsed.prefix}${rebuiltControl};${parsed.suffix}`, dropEmulator: false };
}
