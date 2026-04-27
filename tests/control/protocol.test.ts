import { describe, expect, test } from 'bun:test';
import { encodeFrame, FrameReader, type ControlHeader } from '../../src/control/protocol';

function encodeRawFrame(headerBytes: Buffer, declaredHeaderLength = headerBytes.length): Buffer {
  const frameLength = 4 + headerBytes.length;
  const buffer = Buffer.alloc(4 + frameLength);
  buffer.writeUInt32BE(frameLength, 0);
  buffer.writeUInt32BE(declaredHeaderLength, 4);
  headerBytes.copy(buffer, 8);
  return buffer;
}

function readFrames(chunks: Buffer[]): Array<{ header: ControlHeader; payloads: Buffer[] }> {
  const reader = new FrameReader();
  const frames: Array<{ header: ControlHeader; payloads: Buffer[] }> = [];
  for (const chunk of chunks) {
    reader.feed(chunk, (header, payloads) => {
      frames.push({ header, payloads });
    });
  }
  return frames;
}

describe('control protocol', () => {
  test('round trips header + payloads', () => {
    const header: ControlHeader = {
      type: 'request',
      requestId: 7,
      method: 'ping',
      payloadLengths: [4, 1],
    };
    const payloads = [Buffer.from('abcd'), Buffer.from('e')];
    const frame = encodeFrame(header, payloads);
    const frames = readFrames([frame]);

    expect(frames).toHaveLength(1);
    expect(frames[0].header).toEqual(header);
    expect(frames[0].payloads.map((payload) => payload.toString('utf8'))).toEqual(['abcd', 'e']);
  });

  test('handles multiple frames in one chunk', () => {
    const frameA = encodeFrame({ type: 'event', payloadLengths: [1] }, [Buffer.from('a')]);
    const frameB = encodeFrame({ type: 'event', payloadLengths: [1] }, [Buffer.from('b')]);
    const frames = readFrames([Buffer.concat([frameA, frameB])]);

    expect(frames).toHaveLength(2);
    expect(frames[0].payloads[0].toString('utf8')).toBe('a');
    expect(frames[1].payloads[0].toString('utf8')).toBe('b');
  });

  test('buffers partial frames until complete', () => {
    const frame = encodeFrame({ type: 'event', payloadLengths: [3] }, [Buffer.from('abc')]);
    const midpoint = Math.floor(frame.length / 2);
    const frames = readFrames([frame.subarray(0, midpoint), frame.subarray(midpoint)]);

    expect(frames).toHaveLength(1);
    expect(frames[0].payloads[0].toString('utf8')).toBe('abc');
  });

  test('treats remaining bytes as one payload when lengths are missing', () => {
    const header: ControlHeader = { type: 'event' };
    const payloads = [Buffer.from('one'), Buffer.from('two')];
    const frame = encodeFrame(header, payloads);
    const frames = readFrames([frame]);

    expect(frames).toHaveLength(1);
    expect(frames[0].payloads).toHaveLength(1);
    expect(frames[0].payloads[0].toString('utf8')).toBe('onetwo');
  });

  test('skips malformed JSON frames without throwing', () => {
    const reader = new FrameReader();
    const frames: Array<{ header: ControlHeader; payloads: Buffer[] }> = [];
    const malformed = encodeRawFrame(Buffer.from('{bad json', 'utf8'));
    const valid = encodeFrame({ type: 'event' });

    expect(() => {
      reader.feed(Buffer.concat([malformed, valid]), (header, payloads) => {
        frames.push({ header, payloads });
      });
    }).not.toThrow();

    expect(frames).toHaveLength(1);
    expect(frames[0].header).toEqual({ type: 'event' });
  });

  test('skips frames with invalid header or payload lengths', () => {
    const badHeaderLength = encodeRawFrame(Buffer.from('{}', 'utf8'), 50);
    const badPayloadLength = encodeFrame({ type: 'event', payloadLengths: [10] }, [
      Buffer.from('abc'),
    ]);
    const valid = encodeFrame({ type: 'event', payloadLengths: [1] }, [Buffer.from('z')]);
    const frames = readFrames([Buffer.concat([badHeaderLength, badPayloadLength, valid])]);

    expect(frames).toHaveLength(1);
    expect(frames[0].payloads[0].toString('utf8')).toBe('z');
  });
});
