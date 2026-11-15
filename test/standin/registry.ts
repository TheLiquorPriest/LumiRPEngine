// The generations going on, and the one limit Lumiverse puts on how long one may stay silent (`services/generation/active-generation-registry.ts`),
// with the wait for inference that the limit does not count (`services/inference-scheduler/`). Paths are Lumiverse's `src/`. Every timer runs on the clock
// the host gives (`host.clock`), so a test that moves a clock moves the ten minutes with it.

import type { HostClock } from "./host";

/** `GENERATION_IDLE_TIMEOUT_MS` (`active-generation-registry.ts:140`): a generation that streamed no text for longer than this is aborted. */
export const GENERATION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** `GENERATION_IDLE_SWEEP_INTERVAL_MS` (`:141`): how often the registry looks. */
export const GENERATION_IDLE_SWEEP_INTERVAL_MS = 60_000;
/**
 * Lumiverse's sweep is one interval of the server's, started with the server (`:155-158`), so where it falls in a generation's life is anyone's guess; the stand-in
 * starts its own when a generation is registered while none is, and its first look comes half a minute later, so a look never falls on the very moment a line arrives.
 */
export const FIRST_SWEEP_MS = 30_000;
/** How long a new generation of a chat waits for the one it stopped to tear down (`services/generate.service.ts:1617-1626`). */
export const TEARDOWN_WAIT_MS = 2_000;

/** What the registry holds of one generation (`ActiveGenerationEntry`, `:9-20`). */
export interface ActiveGeneration {
  readonly id: string;
  readonly user: string;
  readonly chat: string;
  /** What stops it: the user's Stop, a newer generation of the chat, the sweep. */
  readonly stop: AbortController;
  readonly startedAt: number;
  /** The last time a chunk with reply or thinking text came, else when it began (`services/generate.service.ts:1640-1650`). */
  lastTokenAt: number;
  /** Waiting for the scheduler to admit its provider call: not counted as silence, though a stop still applies (`:84-89`, `:145`). */
  waitingForInference: boolean;
  /** Resolves when its setup and its teardown are both done (`services/generate.service.ts:1637-1638`), which a newer generation of the chat waits for. */
  readonly completion: Promise<void>;
}

export class GenerationRegistry {
  private readonly byId = new Map<string, ActiveGeneration>();
  private readonly byChat = new Map<string, string>();
  private sweeper: { clock: HostClock; handle: unknown } | null = null;

  constructor(private readonly clock: () => HostClock) {}

  get(id: string): ActiveGeneration | undefined {
    return this.byId.get(id);
  }

  /** The generation holding the chat (`getActiveChatGeneration`, `:129-134`): one per user's chat. */
  chatGeneration(user: string, chat: string): string | undefined {
    return this.byChat.get(`${user}:${chat}`);
  }

  get count(): number {
    return this.byId.size;
  }

  /** `registerActiveGeneration` (`:33-38`), and the chat's mapping (`setActiveChatGeneration`, `:44-50`). */
  register(entry: ActiveGeneration): void {
    this.byId.set(entry.id, entry);
    this.byChat.set(`${entry.user}:${entry.chat}`, entry.id);
    if (this.sweeper === null) this.schedule(FIRST_SWEEP_MS);
  }

  /** `removeActiveGeneration` (`:40-42`). */
  remove(id: string): void {
    this.byId.delete(id);
    if (this.byId.size === 0 && this.sweeper !== null) {
      this.sweeper.clock.clearTimeout(this.sweeper.handle);
      this.sweeper = null;
    }
  }

  /** `clearActiveChatGeneration` (`:52-65`): the chat's mapping, only while it still names this generation. */
  clearChat(user: string, chat: string, expected: string): void {
    if (this.byChat.get(`${user}:${chat}`) === expected) this.byChat.delete(`${user}:${chat}`);
  }

  /** `touchActiveGeneration` (`:76-82`). */
  touch(id: string): void {
    const entry = this.byId.get(id);
    if (entry !== undefined) entry.lastTokenAt = this.clock().now();
  }

  /** `setActiveGenerationWaitingForInference` (`:84-89`): the end of a wait starts the silence again from now. */
  waiting(id: string, waiting: boolean): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    if (entry.waitingForInference && !waiting) entry.lastTokenAt = this.clock().now();
    entry.waitingForInference = waiting;
  }

  /** `stopGeneration` (`:91-97`): the user's own generation by its id; whether there was one. */
  stopGeneration(user: string, id: string): boolean {
    const entry = this.byId.get(id);
    if (entry === undefined || entry.user !== user) return false;
    entry.stop.abort();
    return true;
  }

  /** `stopChatGenerations` (`:106-120`): the generation the chat holds. */
  stopChat(user: string, chat: string): boolean {
    const id = this.byChat.get(`${user}:${chat}`);
    const entry = id === undefined ? undefined : this.byId.get(id);
    entry?.stop.abort();
    return entry !== undefined;
  }

  /** `stopUserGenerations` (`:99-104`). */
  stopUser(user: string): void {
    for (const entry of this.byId.values()) if (entry.user === user) entry.stop.abort();
  }

  /** `sweepInactiveGenerations` (`:143-153`): every generation not waiting for inference, silent for more than ten minutes, aborted. */
  sweep(): void {
    const now = this.clock().now();
    for (const entry of this.byId.values()) {
      if (entry.waitingForInference) continue;
      if (now - entry.lastTokenAt <= GENERATION_IDLE_TIMEOUT_MS) continue;
      entry.stop.abort();
    }
  }

  private schedule(ms: number): void {
    const clock = this.clock();
    this.sweeper = {
      clock,
      handle: clock.setTimeout(() => {
        this.sweeper = null;
        this.sweep();
        if (this.byId.size > 0) this.schedule(GENERATION_IDLE_SWEEP_INTERVAL_MS);
      }, ms),
    };
  }
}

/**
 * Lumiverse's inference scheduler, as far as a generation meets it (`services/inference-scheduler/`): off unless the user turns it on (`config.ts:15-26`,
 * `enabled: false`), and then every call to a local endpoint (loopback, `localhost`, a private address, `origin.ts:51-70`) queues for a slot of one pool, its
 * concurrency the user's (`concurrency`, 1 to 8, default 1), first come first served, a stop ending the wait (`scheduler.ts:485-513`, `:542-569`). It has no
 * limit on the wait of its own (`maxWaitMs` 0), no priority between classes and no preemption of a background request: a stand-in generation is always
 * the interactive class.
 */
export class InferenceAdmission {
  /** Null: the scheduler is off, as its default; every call goes at once. */
  concurrency: number | null = null;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  /** The slot, once admitted, and the way to give it back; rejects with the signal's reason if it stops first. */
  async acquire(endpoint: string, signal: AbortSignal): Promise<() => void> {
    const limit = this.concurrency;
    if (limit === null || !isLocal(endpoint)) return () => undefined;
    if (this.active < limit) {
      this.active++;
      return this.releaser();
    }
    const slot = Promise.withResolvers<void>();
    const turn = (): void => {
      this.active++;
      slot.resolve();
    };
    this.queue.push(turn);
    const onAbort = (): void => {
      const at = this.queue.indexOf(turn);
      if (at >= 0) this.queue.splice(at, 1);
      slot.reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      await slot.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}

/** A local endpoint (`isLocalEndpointOrigin`, `inference-scheduler/origin.ts:51-70`), as far as the stand-in's addresses go. */
function isLocal(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return host === "localhost" || host === "host.docker.internal" || host === "gateway.docker.internal" || host === "::1" || [".localhost", ".local", ".lan", ".internal", ".home.arpa"].some((suffix) => host.endsWith(suffix)) || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
