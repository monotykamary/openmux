import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { KittyTransmitBroker } from '../../src/terminal/kitty-graphics/transmit-broker';

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

const ESC = '\x1b';

describe('KittyTransmitBroker', () => {
  it('forwards transmit payloads to the host writer', () => {
    const broker = new KittyTransmitBroker();
    const writes: string[] = [];
    broker.setWriter((chunk) => writes.push(chunk));

    const sequence = `${ESC}_Ga=t,f=100,i=7;QUJD${ESC}\\`;
    const output = broker.handleSequence('pty-1', sequence);

    expect(output).toBe(sequence);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('a=t');
    expect(writes[0]).toContain('f=100');
    expect(writes[0]).toContain('i=1');
    expect(writes[0]).toContain('QUJD');
  });

  it('rewrites implicit transmissions with a synthetic id', () => {
    const broker = new KittyTransmitBroker();
    const writes: string[] = [];
    broker.setWriter((chunk) => writes.push(chunk));

    const sequence = `${ESC}_Ga=T,f=24;QUJD${ESC}\\`;
    const output = broker.handleSequence('pty-2', sequence);

    expect(output).toContain('i=');
    expect(output).toContain('a=T');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('a=t');
    expect(writes[0]).toContain('i=1');
  });

  it('reuses host ids across chunked transmissions', () => {
    const broker = new KittyTransmitBroker();
    const writes: string[] = [];
    broker.setWriter((chunk) => writes.push(chunk));

    const first = `${ESC}_Ga=t,f=24,m=1;QUJ${ESC}\\`;
    const second = `${ESC}_G;DRA=${ESC}\\`;

    const outFirst = broker.handleSequence('pty-3', first);
    const outSecond = broker.handleSequence('pty-3', second);

    expect(outFirst).toContain('i=');
    expect(outSecond).not.toContain('i=');
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain('m=1');
    expect(writes[0]).toContain('i=1');
    expect(writes[1]).toContain('i=1');
  });

  it('strips png payloads for emulator sequences', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});

    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
    const sequence = `${ESC}_Ga=t,f=100;${png}${ESC}\\`;
    const output = broker.handleSequence('pty-4', sequence);

    expect(output).toContain('f=100');
    expect(output).toContain('s=1');
    expect(output).toContain('v=1');
    expect(output).not.toContain(png);
  });

  it('stubs file-based png transmissions for emulator parsing', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});

    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
    const filePath = path.join(os.tmpdir(), `openmux-kitty-broker-${Date.now()}.png`);
    fs.writeFileSync(filePath, Buffer.from(png, 'base64'));
    const payload = Buffer.from(filePath).toString('base64');
    const sequence = `${ESC}_Ga=t,f=100,t=f,i=7;${payload}${ESC}\\`;
    const output = broker.handleSequence('pty-5', sequence);

    expect(output).toContain('f=100');
    expect(output).toContain('s=1');
    expect(output).toContain('v=1');
    expect(output).not.toContain(payload);

    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  });

  it('drops compression flags when stubbing png payloads', () => {
    const broker = new KittyTransmitBroker();
    broker.setWriter(() => {});

    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAF/gL+Xltp8gAAAABJRU5ErkJggg==';
    const sequence = `${ESC}_Ga=t,f=100,o=z;${png}${ESC}\\`;
    const output = broker.handleSequence('pty-6', sequence);

    expect(output).toContain('f=100');
    expect(output).not.toContain('o=');
    expect(output).not.toContain(png);
  });

  it('treats i=0 as implicit and injects a synthetic id', () => {
    const broker = new KittyTransmitBroker();
    const writes: string[] = [];
    broker.setWriter((chunk) => writes.push(chunk));

    const sequence = `${ESC}_Ga=t,f=24,i=0;QUJD${ESC}\\`;
    const output = broker.handleSequence('pty-7', sequence);

    expect(output).toContain('i=');
    expect(output).not.toContain('i=0');
    expect(writes[0]).toContain('i=1');
  });

  it('offloads large direct payloads to file transfers', () => {
    const priorThreshold = process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD;
    const priorCleanup = process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS;
    process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD = '1';
    process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS = '60000';

    const broker = new KittyTransmitBroker();
    const writes: string[] = [];
    broker.setWriter((chunk) => writes.push(chunk));

    const payload = Buffer.from('abcd').toString('base64');
    const sequence = `${ESC}_Ga=t,f=24;${payload}${ESC}\\`;
    const output = broker.handleSequence('pty-8', sequence);

    expect(output).toContain(payload);
    expect(writes).toHaveLength(1);
    const host = writes[0];
    expect(host).toContain('t=f');
    const payloadStart = host.indexOf(';') + 1;
    const payloadEnd = host.indexOf(`${ESC}\\`);
    const hostPayload = host.slice(payloadStart, payloadEnd);
    const filePath = Buffer.from(hostPayload, 'base64').toString('utf8');
    expect(filePath.length).toBeGreaterThan(0);
    expect(filePath).toContain('tty-graphics-protocol');
    expect(host).not.toContain(payload);

    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup failures
    }

    process.env.OPENMUX_KITTY_OFFLOAD_THRESHOLD = priorThreshold;
    process.env.OPENMUX_KITTY_OFFLOAD_CLEANUP_MS = priorCleanup;
  });
});
