/**
 * Cooperative scheduling helpers for deferring work off the current call stack.
 */

type Task = () => void;

/**
 * Defer work to the next macrotask using setTimeout(0).
 */
export const deferMacrotask = (task: Task): void => {
  setTimeout(task, 0);
};

/**
 * Defer work to the next tick, preferring setImmediate when available.
 */
export const deferNextTick = (task: Task): void => {
  if (typeof setImmediate !== 'undefined') {
    setImmediate(task);
    return;
  }
  setTimeout(task, 0);
};
