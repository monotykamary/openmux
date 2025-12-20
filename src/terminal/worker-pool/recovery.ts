/**
 * Worker recovery for the Worker Pool
 */

import type { WorkerOutbound } from '../emulator-interface';
import type { SessionState, QueuedMessage } from './types';

/**
 * Restart a worker that has encountered too many errors
 */
export async function restartWorker(
  workerIndex: number,
  workers: Worker[],
  workersReady: boolean[],
  workerErrorCounts: number[],
  workerRestartInProgress: boolean[],
  sessionToState: Map<string, SessionState>,
  onWorkerMessage: (workerIndex: number, msg: WorkerOutbound) => void
): Promise<void> {
  if (workerRestartInProgress[workerIndex]) {
    return;
  }

  workerRestartInProgress[workerIndex] = true;
  console.warn(`Restarting worker ${workerIndex} due to repeated errors`);

  const oldWorker = workers[workerIndex];

  // Find affected sessions
  const affectedSessions = Array.from(sessionToState.entries())
    .filter(([, state]) => state.workerIndex === workerIndex)
    .map(([id, state]) => ({ id, state }));

  // Terminate old worker
  oldWorker.terminate();
  workersReady[workerIndex] = false;
  workerErrorCounts[workerIndex] = 0;

  // Create new worker
  const newWorker = new Worker('./emulator-worker.ts', { type: 'module' });
  workers[workerIndex] = newWorker;

  newWorker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
    onWorkerMessage(workerIndex, event.data);
  };

  newWorker.onerror = (error) => {
    console.error(`Worker ${workerIndex} error:`, error);
  };

  // Wait for ready
  await new Promise<void>((resolve) => {
    const handler = (event: MessageEvent<WorkerOutbound>) => {
      if (event.data.type === 'ready') {
        workersReady[workerIndex] = true;
        newWorker.removeEventListener('message', handler);
        resolve();
      }
    };
    newWorker.addEventListener('message', handler);
  });

  workerRestartInProgress[workerIndex] = false;

  // Notify affected sessions - they need to be recreated
  // The PTY is still running, so new terminal session will resume output
  for (const { id } of affectedSessions) {
    // Remove session from tracking (will be recreated by TerminalContext)
    sessionToState.delete(id);
  }
}
