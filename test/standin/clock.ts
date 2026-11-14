// A clock the tests run by hand (RPH's `Clock`): timers fire only when `advance` reaches them, in the
// order they are due, and every promise their callbacks start settles before the next one fires. So a
// twelve-minute silence or a minute of a busy turn runs in milliseconds, and in order.

import type { Clock } from "rp-harness/contract";

interface Timer {
  id: number;
  at: number;
  run(): void;
}

/** Lets every promise and immediate already started run to its next wait. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
}

export class FakeClock implements Clock {
  private time: number;
  private next = 1;
  private readonly timers = new Map<number, Timer>();

  constructor(start = Date.UTC(2026, 0, 5, 9, 0, 0)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { id, at: this.time + Math.max(0, ms), run });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.timers.delete(handle);
  }

  day(at?: number): string {
    return new Date(at ?? this.time).toISOString().slice(0, 10);
  }

  /** How many timers wait. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves time on by `ms`, firing each timer due on the way at its own moment. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      let due: Timer | null = null;
      for (const t of this.timers.values()) if (t.at <= target && (due === null || t.at < due.at || (t.at === due.at && t.id < due.id))) due = t;
      if (due === null) break;
      this.timers.delete(due.id);
      this.time = due.at;
      due.run();
      await settle();
    }
    this.time = target;
    await settle();
  }
}
