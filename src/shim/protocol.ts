import { homedir } from 'os';
import { join } from 'path';
import { Buffer } from 'buffer';

/** Directory where shim socket files are stored */
export const SHIM_SOCKET_DIR =
  process.env.OPENMUX_SHIM_SOCKET_DIR ?? join(homedir(), '.config', 'openmux', 'sockets');

/** Path to the main shim Unix socket */
export const SHIM_SOCKET_PATH =
  process.env.OPENMUX_SHIM_SOCKET_PATH ?? join(SHIM_SOCKET_DIR, 'openmux.sock');

/** Frame header for shim protocol messages */
export type ShimHeader = {
  /** Message type (request, response, event) */
  type: string;
  /** Unique request identifier for correlation */
  requestId?: number;
  /** RPC method name for requests */
  method?: string;
  /** Method parameters */
  params?: Record<string, unknown>;
  /** Success indicator for responses */
  ok?: boolean;
  /** Response result data */
  result?: unknown;
  /** Error message if request failed */
  error?: string;
  /** Lengths of binary payloads following the header */
  payloadLengths?: number[];
  /** Additional header fields */
  [key: string]: unknown;
};

/**
 * Encodes a frame with header and optional binary payloads for shim protocol transmission.
 * Frame format: [4 bytes: total frame length][4 bytes: header length][header JSON][payloads...]
 * @param header - Protocol header with metadata
 * @param payloads - Optional binary payloads to include
 * @returns Encoded buffer ready for socket transmission
 */
export function encodeFrame(header: ShimHeader, payloads: ArrayBuffer[] = []): Buffer {
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

/**
 * Incremental frame reader for shim protocol messages.
 * Buffers incoming data and extracts complete frames for processing.
 */
export class FrameReader {
  private buffer = Buffer.alloc(0);

  /**
   * Feed incoming socket data to the frame reader.
   * Parses complete frames and invokes the callback for each one.
   * @param chunk - Raw socket data buffer
   * @param onFrame - Callback invoked when a complete frame is received
   */
  feed(chunk: Buffer, onFrame: (header: ShimHeader, payloads: Buffer[]) => void): void {
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
      let header: ShimHeader;
      try {
        const parsed = JSON.parse(headerJson) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        header = parsed as ShimHeader;
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
