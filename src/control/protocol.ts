import { homedir } from 'os';
import { join } from 'path';
import { Buffer } from 'buffer';

export const CONTROL_PROTOCOL_VERSION = 1;

const defaultSocketDir = join(homedir(), '.config', 'openmux', 'sockets');

export const CONTROL_SOCKET_DIR = process.env.OPENMUX_CONTROL_SOCKET_DIR ?? defaultSocketDir;

export const CONTROL_SOCKET_PATH =
  process.env.OPENMUX_CONTROL_SOCKET_PATH ?? join(CONTROL_SOCKET_DIR, 'openmux-ui.sock');

export type ControlHeader = {
  type: string;
  requestId?: number;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
  payloadLengths?: number[];
  [key: string]: unknown;
};

export function encodeFrame(header: ControlHeader, payloads: ArrayBuffer[] = []): Buffer {
  const headerJson = JSON.stringify(header);
  const headerBuffer = Buffer.from(headerJson, 'utf8');
  const payloadBuffers = payloads.map((payload) => Buffer.from(payload));
  const payloadLength = payloadBuffers.reduce((sum, buf) => sum + buf.length, 0);
  const frameLength = 4 + headerBuffer.length + payloadLength;
  const buffer = Buffer.alloc(4 + frameLength);

  buffer.writeUInt32BE(frameLength, 0);
  buffer.writeUInt32BE(headerBuffer.length, 4);
  headerBuffer.copy(buffer, 8);

  let offset = 8 + headerBuffer.length;
  for (const payload of payloadBuffers) {
    payload.copy(buffer, offset);
    offset += payload.length;
  }

  return buffer;
}

export class FrameReader {
  private buffer = Buffer.alloc(0);

  feed(chunk: Buffer, onFrame: (header: ControlHeader, payloads: Buffer[]) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + frameLength) {
        return;
      }

      const frame = this.buffer.subarray(4, 4 + frameLength);
      this.buffer = this.buffer.subarray(4 + frameLength);

      if (frame.length < 4) {
        continue;
      }

      const headerLength = frame.readUInt32BE(0);
      const headerEnd = 4 + headerLength;
      // Bad complete frames should not crash the socket data handler.
      if (headerEnd > frame.length) {
        continue;
      }

      const headerJson = frame.subarray(4, headerEnd).toString('utf8');
      let header: ControlHeader;
      try {
        const parsed = JSON.parse(headerJson) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        header = parsed as ControlHeader;
      } catch {
        continue;
      }

      const payloads: Buffer[] = [];
      let offset = headerEnd;
      const payloadLengths = Array.isArray(header.payloadLengths) ? header.payloadLengths : [];

      if (payloadLengths.length > 0) {
        let validPayloads = true;
        for (const length of payloadLengths) {
          if (!Number.isInteger(length) || length < 0 || offset + length > frame.length) {
            validPayloads = false;
            break;
          }
          payloads.push(frame.subarray(offset, offset + length));
          offset += length;
        }
        if (!validPayloads) {
          continue;
        }
      } else if (offset < frame.length) {
        payloads.push(frame.subarray(offset));
      }

      onFrame(header, payloads);
    }
  }
}
