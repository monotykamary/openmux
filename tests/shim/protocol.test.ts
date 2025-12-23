import { describe, expect, test } from 'vitest';
import { encodeFrame, FrameReader, type ShimHeader } from '../../src/shim/protocol';

function readFrames(chunks: Buffer[]): Array<{ header: ShimHeader; payloads: Buffer[] }> {
  const reader = new FrameReader();
  const frames: Array<{ header: ShimHeader; payloads: Buffer[] }> = [];
  for (const chunk of chunks) {
    reader.feed(chunk, (header, payloads) => {
      frames.push({ header, payloads });
    });
  }
  return frames;
}

describe('shim protocol', () => {
  test('round trips header + payloads', () => {
    const header: ShimHeader = {
      type: 'request',
      requestId: 1,
      method: 'ping',
      payloadLengths: [3, 2],
    };
    const payloads = [Buffer.from('abc'), Buffer.from('de')];
    const frame = encodeFrame(header, payloads);
    const frames = readFrames([frame]);

    expect(frames).toHaveLength(1);
    expect(frames[0].header).toEqual(header);
    expect(frames[0].payloads.map((payload) => payload.toString('utf8'))).toEqual(['abc', 'de']);
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
    const header: ShimHeader = { type: 'event' };
    const payloads = [Buffer.from('one'), Buffer.from('two')];
    const frame = encodeFrame(header, payloads);
    const frames = readFrames([frame]);

    expect(frames).toHaveLength(1);
    expect(frames[0].payloads).toHaveLength(1);
    expect(frames[0].payloads[0].toString('utf8')).toBe('onetwo');
  });
});
