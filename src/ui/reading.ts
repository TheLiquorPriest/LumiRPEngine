// How a page reads a route and holds what came: one read that is asked again when what it depends on
// changes, and a list read a page at a time. An answer that comes after the page asked again, or left, is
// let go; what was read stays while the next read is out, so the page never empties while it reads.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { errorWords } from "./words";

export interface Reading<T> {
  /** What the last read answered; null before any did. */
  value: T | null;
  /** RPE's refusal of the last read, in its words; null when it answered. */
  problem: string | null;
  loading: boolean;
  /** Reads again now. */
  again(): void;
}

/** Reads what `ask` gives, again whenever `deps` change or `again()` is called; nothing is read while `ask` is null (the value is let go). */
export function useRead<T>(ask: (() => Promise<T>) | null, deps: readonly unknown[]): Reading<T> {
  const [shown, setShown] = useState<{ value: T | null; problem: string | null; loading: boolean }>({ value: null, problem: null, loading: ask !== null });
  const [nth, setNth] = useState(0);
  const latest = useRef(ask);
  latest.current = ask;
  useEffect(() => {
    const read = latest.current;
    if (read === null) {
      setShown({ value: null, problem: null, loading: false });
      return;
    }
    let alive = true;
    setShown((held) => ({ ...held, loading: true }));
    read().then(
      (value) => {
        if (alive) setShown({ value, problem: null, loading: false });
      },
      (error: unknown) => {
        if (alive) setShown((held) => ({ value: held.value, problem: errorWords(error), loading: false }));
      },
    );
    return () => {
      alive = false;
    };
  }, [...deps, nth, ask === null]);
  const again = useCallback(() => setNth((n) => n + 1), []);
  return { ...shown, again };
}

/** A page of a list that pages: its items, and where the next page begins (null: that was the last). */
export interface PageOf<T> {
  items: readonly T[];
  next: string | null;
}

export interface PagedReading<T> {
  items: readonly T[];
  more: boolean;
  loading: boolean;
  problem: string | null;
  /** Reads the next page, in behind what is held. */
  older(): void;
  /** Reads the list again from its start. */
  again(): void;
}

/** Reads a list a page at a time: the first page when `deps` change, the next ones on `older()`. */
export function usePaged<T>(ask: ((cursor: string | undefined) => Promise<PageOf<T>>) | null, deps: readonly unknown[]): PagedReading<T> {
  const [shown, setShown] = useState<{ items: readonly T[]; next: string | null; loading: boolean; problem: string | null }>({ items: [], next: null, loading: ask !== null, problem: null });
  const [nth, setNth] = useState(0);
  const latest = useRef(ask);
  latest.current = ask;
  const generation = useRef(0);
  useEffect(() => {
    const read = latest.current;
    const mine = ++generation.current;
    if (read === null) {
      setShown({ items: [], next: null, loading: false, problem: null });
      return;
    }
    setShown((held) => ({ ...held, loading: true }));
    read(undefined).then(
      (page) => {
        if (generation.current === mine) setShown({ items: page.items, next: page.next, loading: false, problem: null });
      },
      (error: unknown) => {
        if (generation.current === mine) setShown((held) => ({ ...held, loading: false, problem: errorWords(error) }));
      },
    );
    return () => {
      generation.current++;
    };
  }, [...deps, nth, ask === null]);
  const older = useCallback(() => {
    const read = latest.current;
    const mine = generation.current;
    if (read === null || shown.next === null || shown.loading) return;
    setShown((held) => ({ ...held, loading: true }));
    read(shown.next).then(
      (page) => {
        if (generation.current === mine) setShown((held) => ({ items: [...held.items, ...page.items], next: page.next, loading: false, problem: null }));
      },
      (error: unknown) => {
        if (generation.current === mine) setShown((held) => ({ ...held, loading: false, problem: errorWords(error) }));
      },
    );
  }, [shown.next, shown.loading]);
  const again = useCallback(() => setNth((n) => n + 1), []);
  return { items: shown.items, more: shown.next !== null, loading: shown.loading, problem: shown.problem, older, again };
}
