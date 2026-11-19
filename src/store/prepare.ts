// A chat's states made ready for the build that runs (plan §18.1 row 0.5: "snapshots every 25 turns keep a cold start short"). The
// store folds under the build's own fingerprint, so after an update, or an import under another build, no snapshot of a chat serves
// this one, and the first fold of each of its turns would run from the chat's start. Once RPE listens, each such chat is folded once
// along its path, the chat played most recently first, in stretches that let RPE's one thread go between them, each stretch's snapshot
// stored as soon as it is folded; the log says, for each chat, how long it took. RPE answers meanwhile: a read of a chat not yet ready
// waits for it (`ready`), and that chat is taken next. Readings that work over many turns at once let the thread go the same way
// (`inStretches`).

import type { JsonValue } from "../shared/json";
import type { ChatPreparing } from "../shared/preparing";
import { AwayAsked, FoldAway } from "./away";
import type { Store } from "./store";

/** How long a reading over many turns works before it lets the thread go (`inStretches`). */
export const STRETCH_MS = 50;

/**
 * Lets RPE's thread go: whatever waits to run runs before the work that awaits this goes on. By a timer and not `setImmediate`: an
 * immediate runs ahead of the disk's answers, so a request that reads the disk several times while stretches run would wait one whole
 * stretch for each read.
 */
export function letGo(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/**
 * `work` over each of `items` in order, letting the thread go every `STRETCH_MS` (`letGo`); `around` runs each stretch inside it (the
 * chat's lines a stretch is worded in, which hold only while synchronous work runs). An item whose fold is too long for RPE's thread
 * (`FoldAway`) has it folded on a thread, and the walk goes on from that item, the states before it held. What each item gave, in order.
 */
export async function inStretches<I, T>(items: readonly I[], work: (item: I) => T, around: (stretch: () => void) => void = (stretch) => stretch()): Promise<T[]> {
  const out: T[] = [];
  const asked = new AwayAsked();
  let at = 0;
  while (at < items.length) {
    const began = performance.now();
    const refused: { by: FoldAway | null } = { by: null };
    around(() => {
      try {
        for (; at < items.length && (at === 0 || performance.now() - began < STRETCH_MS); at++) out.push(work(items[at] as I));
      } catch (error) {
        if (!(error instanceof FoldAway) || !asked.again(error.job)) throw error;
        refused.by = error;
      }
    });
    const away = refused.by?.away() ?? null;
    if (away !== null) await away;
    else if (at < items.length) await letGo();
  }
  return out;
}

export interface PreparerDeps {
  store: Store;
  /** The user this RPE belongs to: the one whose chats are made ready. */
  user: () => string;
  /** Runs a write in RPE's write queue. */
  write: (write: () => void, label: string) => Promise<unknown>;
  log: {
    info(message: string, data: Record<string, JsonValue>): void;
    warn(message: string, data: Record<string, JsonValue>): void;
  };
}

/** The pass over the chats whose states this build cannot use yet, and the reads that wait for it. */
export class Preparer {
  private user = "";
  private queue: string[] = [];
  private current: string | null = null;
  private readonly waiting = new Map<string, PromiseWithResolvers<void>>();
  private stopped = false;
  private running: Promise<void> | null = null;
  /** Whether the pass was begun: its user known and the chats that want it listed. */
  private begun = false;
  /** How far the chat made ready now (`current`) is. */
  private progress: { done: number; of: number | null } = { done: 0, of: null };

  constructor(private readonly deps: PreparerDeps) {}

  /**
   * Starts the pass over every chat that wants a snapshot this build can use (`UserStore.unprepared`), and returns at once. RPE calls
   * it once it listens, and so does the first read that names a chat (`ready`, `preparing`): RPE answers requests from the moment it
   * listens, before every area was told it started, and a read let past a pass not yet begun folds its chat's whole path in one piece
   * on RPE's thread.
   */
  start(): void {
    if (this.begun || this.stopped) return;
    this.user = this.deps.user();
    if (this.user === "") return;
    this.begun = true;
    this.queue = this.deps.store.user(this.user).unprepared();
    if (this.queue.length === 0) return;
    this.deps.log.info("RPE makes ready the states of chats this build cannot use yet, one chat at a time; a read of one waits for it.", { chats: this.queue.length });
    this.running = this.run();
  }

  /** Resolves once `chat` is ready for this build: at once for one the pass does not hold; one still waiting is taken next. */
  async ready(user: string, chat: string): Promise<void> {
    this.start();
    if (user !== this.user || (this.current !== chat && !this.queue.includes(chat))) return;
    if (this.current !== chat) this.queue = [chat, ...this.queue.filter((c) => c !== chat)];
    let waits = this.waiting.get(chat);
    if (waits === undefined) {
      waits = Promise.withResolvers<void>();
      this.waiting.set(chat, waits);
    }
    await waits.promise;
  }

  /** How far the pass is with `chat`, from what it keeps as it goes: null where it does not hold it (ready already, or never wanting). */
  preparing(user: string, chat: string): ChatPreparing | null {
    this.start();
    if (user !== this.user) return null;
    if (this.current === chat) return { ahead: 0, ...this.progress };
    const at = this.queue.indexOf(chat);
    return at < 0 ? null : { ahead: at + (this.current === null ? 0 : 1), done: 0, of: null };
  }

  /** Ends the pass after the stretch that runs; every read that waits goes on. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.queue = [];
    for (const waits of this.waiting.values()) waits.resolve();
    this.waiting.clear();
    await this.running;
  }

  private async run(): Promise<void> {
    for (let chat = this.queue.shift(); chat !== undefined && !this.stopped; chat = this.queue.shift()) {
      this.current = chat;
      try {
        await this.prepare(chat);
      } catch (error) {
        this.deps.log.warn("A chat's states could not be made ready for this build: each of its reads folds what it needs as it goes.", { chat, error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.current = null;
        this.waiting.get(chat)?.resolve();
        this.waiting.delete(chat);
      }
    }
  }

  /** One chat, stretch after stretch, what each stretch held stored before the next; one line in the log once it is ready. */
  private async prepare(chat: string): Promise<void> {
    const s = this.deps.store.user(this.user);
    const began = performance.now();
    let stretches = 0;
    let changes = 0;
    let longest = 0;
    let after: string | null = null;
    let left = Number.POSITIVE_INFINITY;
    let refused = 0;
    this.progress = { done: 0, of: null };
    while (!this.stopped) {
      const at = performance.now();
      let step;
      try {
        step = s.prepareNext(chat, after, STRETCH_MS);
      } catch (error) {
        // A stretch that starts where no state is held and folds more changes than RPE's thread runs (a chat's heavy first turn) is
        // folded on a thread, and the stretch is asked for again, now from the state the thread held.
        const away = refused < 3 ? this.deps.store.awayFor(error) : null;
        if (away === null) throw error;
        refused++;
        await away;
        continue;
      }
      refused = 0;
      longest = Math.max(longest, performance.now() - at);
      if (step.at === null) break;
      // A stretch that ends where the one before it ended, with as many snapshots wanting, made none: its snapshot could not be stored.
      if (step.at === after && step.left >= left) throw new Error("a stretch's snapshot could not be stored");
      stretches++;
      changes += step.changes;
      if (step.left < left) await this.deps.write(() => s.storeHeld(), "snapshots of a chat made ready for this build");
      const of = this.progress.of ?? step.wanted;
      this.progress = { done: Math.max(0, of - step.left), of };
      if (step.left === 0) break;
      after = step.at;
      left = step.left;
      await letGo();
    }
    this.deps.log.info("A chat's states were made ready for this build.", { chat, stretches, changes, ms: Math.round(performance.now() - began), longestStretchMs: Math.round(longest) });
  }
}
