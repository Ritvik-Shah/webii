/** Every listener also receives which player the message came from. It's a
 * second argument rather than part of the message so a handler that doesn't
 * care about players -- a single-player game, a menu -- can keep ignoring it. */
export type BusListener<T> = (msg: T, player: number) => void;

export interface EventBus<T> {
  emit: (msg: T, player: number) => void;
  subscribe: (fn: BusListener<T>) => () => void;
}

/** Plain pub/sub outside React state, so high-frequency messages (pointer deltas
 * arriving dozens of times a second) never force a re-render on their own. */
export function createEventBus<T>(): EventBus<T> {
  const listeners = new Set<BusListener<T>>();
  return {
    emit(msg, player) {
      for (const listener of listeners) listener(msg, player);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
