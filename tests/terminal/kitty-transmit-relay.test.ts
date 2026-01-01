import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { KittyTransmitRelay } from '../../src/terminal/kitty-graphics/transmit-relay';

const ESC = '\x1b';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';

function withStubEnv<T>(fn: () => T): T {
  const prior = process.env.OPENMUX_KITTY_EMULATOR_STUB;
  process.env.OPENMUX_KITTY_EMULATOR_STUB = '1';
  try {
    return fn();
  } finally {
    if (prior === undefined) {
      delete process.env.OPENMUX_KITTY_EMULATOR_STUB;
    } else {
      process.env.OPENMUX_KITTY_EMULATOR_STUB = prior;
    }
  }
}

describe('KittyTransmitRelay', () => {
  it('injects synthetic ids for implicit transmissions', () => {
    const relay = new KittyTransmitRelay();
    const sequence = `${ESC}_Ga=t,f=24;QUJD${ESC}\\`;
    const result = relay.handleSequence('pty-1', sequence);

    expect(result.forwardSequence).toContain('i=');
    expect(result.emuSequence).toContain('i=');
  });

  it('stubs png payloads for emulator while forwarding to host', () => {
    withStubEnv(() => {
      const relay = new KittyTransmitRelay();
      const sequence = `${ESC}_Ga=t,f=100,i=7;${PNG_1X1}${ESC}\\`;
      const result = relay.handleSequence('pty-2', sequence);

      expect(result.forwardSequence).toBe(sequence);
      expect(result.emuSequence).toContain('f=100');
      expect(result.emuSequence).toContain('s=1');
      expect(result.emuSequence).toContain('v=1');
      expect(result.emuSequence).not.toContain(PNG_1X1);
    });
  });

  it('buffers file payloads and emits stub on final chunk', () => {
    withStubEnv(() => {
      const filePath = path.join(os.tmpdir(), `openmux-kitty-relay-${Date.now()}.png`);
      fs.writeFileSync(filePath, Buffer.from(PNG_1X1, 'base64'));
      const payload = Buffer.from(filePath).toString('base64');
      const first = payload.slice(0, 12);
      const second = payload.slice(12);

      const relay = new KittyTransmitRelay();
      const firstSeq = `${ESC}_Ga=t,f=100,t=f,m=1,i=9;${first}${ESC}\\`;
      const secondSeq = `${ESC}_G;${second}${ESC}\\`;

      const firstResult = relay.handleSequence('pty-3', firstSeq);
      expect(firstResult.forwardSequence).toBeNull();
      expect(firstResult.emuSequence).toBe('');

      const secondResult = relay.handleSequence('pty-3', secondSeq);
      expect(secondResult.forwardSequence).toContain('t=f');
      expect(secondResult.forwardSequence).toContain(payload);
      expect(secondResult.emuSequence).toContain('s=1');
      expect(secondResult.emuSequence).toContain('v=1');
      expect(secondResult.emuSequence).not.toContain(payload);

      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    });
  });

  it('offloads large direct payloads to file transfers', () => {
    withStubEnv(() => {
      const priorThreshold = process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD;
      const priorCleanup = process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS;
      process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD = '1';
      process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS = '60000';

      const relay = new KittyTransmitRelay();
      const sequence = `${ESC}_Ga=t,f=100,i=5;${PNG_1X1}${ESC}\\`;
      const result = relay.handleSequence('pty-4', sequence);

      expect(result.forwardSequence).toContain('t=f');
      const payloadStart = result.forwardSequence!.indexOf(';') + 1;
      const payloadEnd = result.forwardSequence!.indexOf(`${ESC}\\`);
      const hostPayload = result.forwardSequence!.slice(payloadStart, payloadEnd);
      const filePath = Buffer.from(hostPayload, 'base64').toString('utf8');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(result.emuSequence).toContain('s=1');
      expect(result.emuSequence).toContain('v=1');

      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }

      process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD = priorThreshold;
      process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS = priorCleanup;
    });
  });
});
