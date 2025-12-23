import { isShimClient } from '../../shim/mode';
import * as ShimClient from '../../shim/client';

export async function registerPtyPane(
  sessionId: string | null | undefined,
  paneId: string,
  ptyId: string
): Promise<void> {
  if (!isShimClient()) return;
  if (!sessionId) return;
  await ShimClient.registerPaneMapping(sessionId, paneId, ptyId);
}

export async function getSessionPtyMapping(sessionId: string): Promise<Map<string, string> | undefined> {
  if (!isShimClient()) return undefined;
  return ShimClient.getSessionMapping(sessionId);
}

export function onShimDetached(callback: () => void): () => void {
  if (!isShimClient()) return () => {};
  return ShimClient.onShimDetached(callback);
}

export async function shutdownShim(): Promise<void> {
  if (!isShimClient()) return;
  await ShimClient.shutdownShim();
}

export async function waitForShimClient(): Promise<void> {
  if (!isShimClient()) return;
  await ShimClient.waitForShim();
}
