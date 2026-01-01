import { Buffer } from 'buffer';
import fs from 'fs';
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
  parsePngDimensionsFromFilePath,
  parsePngDimensionsFromFilePayload,
  parseTransmitParams,
  rebuildControl,
  type KittySequence,
  type TransmitParams,
} from './sequence-utils';

type PendingChunk = {
  guestKey: string;
  params: TransmitParams;
  offload: OffloadState | null;
  filePayload: string;
  mode: 'stub' | 'pass' | 'buffer';
  controlParams: Map<string, string> | null;
};

type OffloadState = {
  fd: number;
  filePath: string;
  carry: string;
  bytesWritten: number;
};

export type KittyTransmitRelayResult = {
  emuSequence: string;
  forwardSequence: string | null;
};

export class KittyTransmitRelay {
  private pendingChunk: PendingChunk | null = null;
  private stubbedGuestKeys = new Set<string>();
  private nextSyntheticGuestId = 2147483647;
  private offloadThresholdBytes: number;
  private offloadCleanupDelayMs: number;
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private tempFileCounter = 0;
  private stubEmulator = false;
  private stubPng = false;

  constructor(options?: { stubPng?: boolean }) {
    const thresholdEnv = Number(process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD ?? '');
    this.offloadThresholdBytes = Number.isFinite(thresholdEnv) && thresholdEnv >= 0
      ? thresholdEnv
      : 512 * 1024;
    const cleanupEnv = Number(process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS ?? '');
    this.offloadCleanupDelayMs = Number.isFinite(cleanupEnv) && cleanupEnv >= 0 ? cleanupEnv : 5000;
    const stubEnv = (process.env.OPENMUX_KITTY_EMULATOR_STUB ?? '').toLowerCase();
    this.stubEmulator = stubEnv === '1' || stubEnv === 'true';
    this.stubPng = options?.stubPng ?? false;
  }

  dispose(): void {
    if (this.pendingChunk?.offload) {
      this.abortOffload(this.pendingChunk.offload);
    }
    this.pendingChunk = null;
    this.stubbedGuestKeys.clear();
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  handleSequence(ptyId: string, sequence: string): KittyTransmitRelayResult {
    const parsed = parseKittySequence(sequence);
    if (!parsed) return { emuSequence: sequence, forwardSequence: null };

    const action = parsed.params.get('a');
    if (action === 'd') {
      const id = normalizeParamId(parsed.params.get('i'));
      const number = normalizeParamId(parsed.params.get('I'));
      const key = buildGuestKey(id, number);
      if (key) {
        this.stubbedGuestKeys.delete(key);
      }
      return { emuSequence: sequence, forwardSequence: null };
    }

    let transmit = parseTransmitParams(parsed);
    if (!transmit && this.pendingChunk && parsed.params.size === 0) {
      transmit = { ...this.pendingChunk.params, more: false };
    }
    if (!transmit) {
      return { emuSequence: sequence, forwardSequence: null };
    }

    const rawId = parsed.params.get('i');
    const guestId = normalizeParamId(rawId);
    const guestNumber = normalizeParamId(parsed.params.get('I'));
    let guestKey = buildGuestKey(guestId, guestNumber);
    let needsRebuild = false;

    if (!guestKey && this.pendingChunk) {
      guestKey = this.pendingChunk.guestKey;
    }

    if (!guestKey) {
      const injectedGuestId = String(this.nextSyntheticGuestId);
      this.nextSyntheticGuestId = nextSynthetic(this.nextSyntheticGuestId);
      guestKey = buildGuestKey(injectedGuestId, null);
      parsed.params.set('i', injectedGuestId);
      needsRebuild = true;
    } else if (rawId && !guestId && guestNumber) {
      parsed.params.delete('i');
      needsRebuild = true;
    }

    if (!guestKey) {
      return { emuSequence: sequence, forwardSequence: null };
    }

    if (!parsed.params.has('i') && !parsed.params.has('I')) {
      if (guestKey.startsWith('i:')) {
        parsed.params.set('i', guestKey.slice(2));
        needsRebuild = true;
      } else if (guestKey.startsWith('I:')) {
        parsed.params.set('I', guestKey.slice(2));
        needsRebuild = true;
      }
    }

    if (this.pendingChunk && this.pendingChunk.guestKey !== guestKey) {
      if (this.pendingChunk.offload) {
        this.abortOffload(this.pendingChunk.offload);
      }
      this.pendingChunk = null;
    }

    const mergedParams = mergeTransmitParams(this.pendingChunk?.params ?? null, transmit);
    const medium = mergedParams.medium ?? 'd';
    const isPng = (mergedParams.format ?? '') === '100';

    let baseSequence = sequence;
    if (needsRebuild) {
      const rebuiltControl = rebuildControl(parsed.params);
      baseSequence = `${parsed.prefix}${rebuiltControl};${parsed.data}${parsed.suffix}`;
    }

    const activeOffload = this.pendingChunk?.offload ?? null;
    const shouldOffload = activeOffload ?? this.shouldOffload(mergedParams, parsed.data, transmit.more);
    const shouldStubEmulator = this.stubEmulator || (this.stubPng && isPng);
    let offloadDims: { width: number; height: number } | null = null;
    let forwardSequence: string | null = null;
    if (shouldOffload) {
      const offload = activeOffload ?? this.startOffload();
      this.appendOffload(offload, parsed.data);
      if (transmit.more) {
        this.pendingChunk = {
          guestKey,
          params: mergedParams,
          offload,
          filePayload: '',
          mode: 'buffer',
          controlParams: new Map(parsed.params),
        };
      } else {
        const filePath = this.finishOffload(offload);
        const payload = Buffer.from(filePath).toString('base64');
        forwardSequence = buildForwardFileSequence(parsed, payload);
        if (shouldStubEmulator) {
          offloadDims = parsePngDimensionsFromFilePath(filePath);
        }
        tracePtyEvent('kitty-relay-forward', {
          ptyId,
          guestKey,
          offload: true,
          filePath,
          bytesWritten: offload.bytesWritten,
        });
        this.scheduleCleanup(filePath);
      }
    } else {
      forwardSequence = baseSequence;
      tracePtyEvent('kitty-relay-forward', {
        ptyId,
        guestKey,
        offload: false,
        dataLen: parsed.data.length,
      });
    }

    if (this.stubEmulator && (medium === 'f' || medium === 't') && transmit.more) {
      const filePayload = `${this.pendingChunk?.mode === 'buffer' ? this.pendingChunk.filePayload : ''}${parsed.data}`;
      const controlParams = this.pendingChunk?.mode === 'buffer'
        ? this.pendingChunk.controlParams
        : new Map(parsed.params);
      this.pendingChunk = {
        guestKey,
        params: mergedParams,
        offload: this.pendingChunk?.offload ?? null,
        filePayload,
        mode: 'buffer',
        controlParams,
      };
      return { emuSequence: '', forwardSequence: null };
    }

    let parsedForStub = parsed;
    let combinedSequence: string | null = null;
    if ((medium === 'f' || medium === 't') && this.pendingChunk?.mode === 'buffer') {
      const combinedPayload = `${this.pendingChunk.filePayload}${parsed.data}`;
      const baseParams = this.pendingChunk.controlParams ?? parsed.params;
      const controlParams = new Map(baseParams);
      const rebuiltControl = rebuildControl(controlParams);
      parsedForStub = { ...parsed, data: combinedPayload, params: controlParams, control: rebuiltControl };
      forwardSequence = buildForwardFileSequence(parsedForStub, combinedPayload);
      const emuParams = new Map(controlParams);
      emuParams.delete('m');
      const emuControl = rebuildControl(emuParams);
      combinedSequence = `${parsed.prefix}${emuControl};${combinedPayload}${parsed.suffix}`;
    }

    let emuSequence = baseSequence;
    let stubbed = false;
    let dropEmulator = false;

    if (shouldStubEmulator && this.pendingChunk?.mode !== 'pass') {
      const stub = this.buildEmulatorSequence(parsedForStub, mergedParams, guestKey, offloadDims);
      if (stub.dropEmulator) {
        emuSequence = '';
        dropEmulator = true;
      } else if (stub.emuSequence) {
        emuSequence = stub.emuSequence;
        stubbed = true;
      }
    }

    if (!shouldStubEmulator && combinedSequence) {
      emuSequence = combinedSequence;
    }

    if (transmit.more) {
      const mode = this.pendingChunk?.mode === 'buffer'
        ? 'buffer'
        : stubbed
          ? 'stub'
          : 'pass';
      this.pendingChunk = {
        guestKey,
        params: mergedParams,
        offload: shouldOffload ? (this.pendingChunk?.offload ?? activeOffload ?? null) : null,
        filePayload: '',
        mode,
        controlParams: new Map(parsed.params),
      };
    } else if (!this.pendingChunk?.offload || activeOffload) {
      this.pendingChunk = null;
    }

    if (dropEmulator) {
      tracePtyEvent('kitty-relay-emu', { ptyId, guestKey, drop: true });
      return { emuSequence: '', forwardSequence };
    }

    if (stubbed) {
      tracePtyEvent('kitty-relay-emu', { ptyId, guestKey, stubbed: true });
      return { emuSequence, forwardSequence };
    }

    return { emuSequence, forwardSequence };
  }

  private buildEmulatorSequence(
    parsed: KittySequence,
    params: TransmitParams,
    guestKey: string,
    dimsOverride: { width: number; height: number } | null = null
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

    if (this.stubbedGuestKeys.has(guestKey)) {
      return { emuSequence: null, dropEmulator: true };
    }

    const controlParams = new Map(parsed.params);
    if (!controlParams.get('s') || !controlParams.get('v')) {
      const dims = dimsOverride ?? (medium === 'd'
        ? parsePngDimensionsFromBase64(parsed.data)
        : parsePngDimensionsFromFilePayload(parsed.data));
      if (dims) {
        controlParams.set('s', String(dims.width));
        controlParams.set('v', String(dims.height));
      }
    }

    if (!controlParams.get('s') || !controlParams.get('v')) {
      return { emuSequence: null, dropEmulator: false };
    }

    if (medium !== 'd') {
      controlParams.delete('t');
    }
    controlParams.delete('m');
    controlParams.delete('o');
    const rebuiltControl = rebuildControl(controlParams);
    this.stubbedGuestKeys.add(guestKey);
    return { emuSequence: `${parsed.prefix}${rebuiltControl};${parsed.suffix}`, dropEmulator: false };
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

function buildForwardFileSequence(parsed: KittySequence, payload: string): string {
  const controlParams = new Map(parsed.params);
  controlParams.set('a', 't');
  controlParams.set('q', '2');
  controlParams.set('t', 'f');
  controlParams.delete('m');
  const rebuiltControl = rebuildControl(controlParams);
  return `${KITTY_PREFIX_ESC}${rebuiltControl};${payload}${ESC}\\`;
}
