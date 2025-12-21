import type { WorkerSession } from '../types';
import { sendError } from '../helpers';
import { checkModeChanges, sendDirtyUpdate } from '../updates';
import { stripProblematicOscSequences } from '../osc-stripping';
import { containsOscStart } from '../handler-utils';

const LARGE_WRITE_THRESHOLD = 64 * 1024;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/**
 * Handle write to terminal
 */
export async function handleWrite(
  sessionId: string,
  data: ArrayBuffer,
  sessions: Map<string, WorkerSession>
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(`Session ${sessionId} not found`, sessionId);
    return;
  }

  try {
    const bytes = new Uint8Array(data);
    const hasOscStart = containsOscStart(bytes);

    if (!hasOscStart && !session.titleParser.isInOscSequence()) {
      if (bytes.length > LARGE_WRITE_THRESHOLD) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      session.terminal.write(bytes);
    } else {
      const text = textDecoder.decode(bytes);
      session.titleParser.processData(text);

      let outputBytes: Uint8Array | null = null;
      const strippedText = stripProblematicOscSequences(text);
      if (strippedText.length > 0) {
        outputBytes = strippedText === text ? bytes : textEncoder.encode(strippedText);
      }

      if (outputBytes && outputBytes.length > 0) {
        if (outputBytes.length > LARGE_WRITE_THRESHOLD) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        session.terminal.write(outputBytes);
      }
    }

    checkModeChanges(sessionId, session);

    const currentScrollbackLength = session.terminal.getScrollbackLength();
    if (currentScrollbackLength !== session.lastScrollbackLength) {
      session.scrollbackCache.clear();
      session.lastScrollbackLength = currentScrollbackLength;
    }

    sendDirtyUpdate(sessionId, session);
  } catch (error) {
    sendError(`Write failed: ${error}`, sessionId);
  }
}
