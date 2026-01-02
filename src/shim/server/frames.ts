import type net from 'net';
import { encodeFrame, type ShimHeader } from '../protocol';

export function sendFrame(socket: net.Socket, header: ShimHeader, payloads: ArrayBuffer[] = []): void {
  if (socket.destroyed) return;
  socket.write(encodeFrame(header, payloads));
}

export function sendResponse(
  socket: net.Socket,
  requestId: number,
  result?: unknown,
  payloads: ArrayBuffer[] = []
): void {
  sendFrame(socket, {
    type: 'response',
    requestId,
    ok: true,
    result,
    payloadLengths: payloads.map((payload) => payload.byteLength),
  }, payloads);
}

export function sendError(socket: net.Socket, requestId: number, error: string): void {
  sendFrame(socket, {
    type: 'response',
    requestId,
    ok: false,
    error,
  });
}
