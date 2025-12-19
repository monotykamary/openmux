/**
 * Simple event emitter for PTY events
 */

export interface Disposable {
  dispose(): void;
}

type Listener<T> = (data: T) => void;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const i = this.listeners.indexOf(listener);
        if (i !== -1) {
          this.listeners.splice(i, 1);
        }
      },
    };
  };

  fire(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}
