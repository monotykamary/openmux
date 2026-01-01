import { describe, expect, it } from 'vitest';
import { TerminalQueryPassthrough } from '../../../src/terminal/terminal-query-passthrough';
import { generateDa1Response } from '../../../src/terminal/terminal-query-passthrough/responses';
import { BEL, ESC, ST } from '../../../src/terminal/terminal-query-passthrough/constants';

describe('TerminalQueryPassthrough', () => {
  it('buffers partial XTWINOPS queries across chunks', () => {
    const passthrough = new TerminalQueryPassthrough();
    const responses: string[] = [];
    passthrough.setPtyWriter((response) => responses.push(response));
    passthrough.setSizeGetter(() => ({
      cols: 80,
      rows: 24,
      pixelWidth: 800,
      pixelHeight: 480,
      cellWidth: 10,
      cellHeight: 20,
    }));

    const first = passthrough.process(`${ESC}[14`);
    expect(first).toBe('');
    expect(responses).toHaveLength(0);

    const second = passthrough.process('t');
    expect(second).toBe('');
    expect(responses).toEqual([`${ESC}[4;480;800t`]);
  });

  it('buffers partial OSC queries across chunks', () => {
    const passthrough = new TerminalQueryPassthrough();
    const responses: string[] = [];
    passthrough.setPtyWriter((response) => responses.push(response));
    passthrough.setColorsGetter(() => ({
      foreground: 0x112233,
      background: 0x445566,
    }));

    const first = passthrough.process(`${ESC}]10;?`);
    expect(first).toBe('');
    expect(responses).toHaveLength(0);

    const second = passthrough.process(`${BEL}`);
    expect(second).toBe('');
    expect(responses).toEqual([`${ESC}]10;rgb:1111/2222/3333${ST}`]);
  });

  it('strips kitty graphics responses from output', () => {
    const passthrough = new TerminalQueryPassthrough();
    const responseOk = `${ESC}_Gi=1;OK${ESC}\\`;
    const responseErr = `${ESC}_Gi=2;EINVAL: invalid data${ESC}\\`;

    const withText = passthrough.process(`before${responseOk}after`);
    expect(withText).toBe('beforeafter');

    const errOnly = passthrough.process(responseErr);
    expect(errOnly).toBe('');
  });

  it('keeps kitty graphics commands intact', () => {
    const passthrough = new TerminalQueryPassthrough();
    const commandWithAction = `${ESC}_Ga=t,f=24,s=1,v=1;QUJD${ESC}\\`;
    const commandNoAction = `${ESC}_Gi=1;QUJD${ESC}\\`;

    expect(passthrough.process(commandWithAction)).toBe(commandWithAction);
    expect(passthrough.process(commandNoAction)).toBe(commandNoAction);
  });

  it('allows a kitty sequence handler to rewrite output', () => {
    const passthrough = new TerminalQueryPassthrough();
    passthrough.setKittySequenceHandler((sequence) => `${sequence}tail`);
    const command = `${ESC}_Ga=t,f=24,s=1,v=1;QUJD${ESC}\\`;

    const output = passthrough.process(command);
    expect(output).toBe(`${command}tail`);
  });

  it('buffers partial kitty response across chunks', () => {
    const passthrough = new TerminalQueryPassthrough();
    const first = passthrough.process(`${ESC}_Gi=1;O`);
    expect(first).toBe('');

    const second = passthrough.process(`K${ESC}\\`);
    expect(second).toBe('');
  });

  it('passes through large kitty graphics payloads across chunks', () => {
    const passthrough = new TerminalQueryPassthrough();
    const payload = 'A'.repeat(70000);
    const command = `${ESC}_Ga=t,f=24;${payload}${ST}`;

    const first = passthrough.process(command.slice(0, 40000));
    const second = passthrough.process(command.slice(40000));

    expect(first + second).toBe(command);
  });

  it('captures query responses without writing to the PTY', () => {
    const passthrough = new TerminalQueryPassthrough();
    const responses: string[] = [];
    passthrough.setPtyWriter((response) => responses.push(response));

    const result = passthrough.processWithResponses(`${ESC}[c`);

    expect(result.text).toBe('');
    expect(result.responses).toEqual([generateDa1Response()]);
    expect(responses).toHaveLength(0);
  });
});
