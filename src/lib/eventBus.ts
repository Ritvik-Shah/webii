export interface EventBus<T> {
  emit: (msg: T) => void;
  subscribe: (fn: (msg: T) => void) => () => void;
}

/** Plain pub/sub outside React state, so high-frequency messages (pointer deltas
 * arriving dozens of times a second) never force a re-render on their own. */
export function createEventBus<T>(): EventBus<T> {
  const listeners = new Set<(msg: T) => void>();
  return {
    emit(msg) {
      for (const listener of listeners) listener(msg);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
