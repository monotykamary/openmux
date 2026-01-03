/**
 * Host output helper for writing escape sequences to the parent terminal.
 *
 * This is used for features like focus tracking and desktop notifications
 * that should be handled by the host terminal instead of a PTY.
 */

export type HostSequenceWriter = (sequence: string) => void;

let hostSequenceWriter: HostSequenceWriter | null = null;

export function setHostSequenceWriter(writer: HostSequenceWriter | null): void {
  hostSequenceWriter = writer;
}

export function hasHostSequenceWriter(): boolean {
  return !!hostSequenceWriter;
}

export function writeHostSequence(sequence: string): boolean {
  if (!sequence) return false;
  if (hostSequenceWriter) {
    hostSequenceWriter(sequence);
    return true;
  }

  const stdout = process.stdout;
  if (!stdout || typeof stdout.write !== "function") return false;
  stdout.write(sequence);
  if (stdout.isTTY) {
    (stdout as any)._handle?.flush?.();
  }
  return true;
}
