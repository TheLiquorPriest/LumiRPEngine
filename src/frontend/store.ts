// A minimal observable value plus the Preact hook that reads it. The frontend keeps its own UI
// state here (drawer section, viewport, open sheets); world state lives only in the protocol
// client's `StateView`.

import { useEffect, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(listener: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const set = (next: T): void => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of [...listeners]) listener(value);
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Anything with `get` and `subscribe`: a Store, or the protocol client's sync state. */
export interface Readable<T> {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** Re-renders when the selected slice changes identity. */
export function useSelect<T, S>(source: Readable<T>, select: (value: T) => S): S {
  const [selected, setSelected] = useState(() => select(source.get()));
  useEffect(() => {
    setSelected(() => select(source.get()));
    return source.subscribe((value) => setSelected(() => select(value)));
    // The selector is read on every notification; re-subscribing per render would drop updates.
  }, [source]);
  return selected;
}
