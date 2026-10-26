// The engine's own memory budget (DESIGN §9.6). The host gives an extension no sign of memory
// pressure, and one whole read of a long chat (every message with all its reasoning) raises this
// process's RSS by hundreds of megabytes at once; the allocator keeps those pages after the garbage is
// collected, so the RSS seldom falls back. Past the limit, the engine lets go of what it builds again
// for the chats not in use (`Runtime.trimIdle`) and collects the garbage, so what the next read takes
// is reused rather than added. It looks after every whole read of a chat, and every minute.

/** The RSS past which the chats not in use are let go: above what one whole read of the longest chats takes (about 550 MB), well below what the host's machine has. */
export const MEMORY_LIMIT_BYTES = 768 * 1024 * 1024;

/** How often the RSS is looked at besides after each whole read. */
export const MEMORY_CHECK_MS = 60_000;

/** The RSS seldom falls after a trim, so the next waits until it has grown this much past the last. */
export const MEMORY_REGROWTH_BYTES = 64 * 1024 * 1024;

export interface MemoryProbe {
  /** The process's resident set size, in bytes. */
  rss(): number;
  /** Collects the garbage once the current work is done (a collection inside it keeps what its stack still holds). */
  collect(): void;
}

export interface TrimReport {
  messages: number;
  ledgers: number;
  views: number;
}

const MB = 1024 * 1024;

export class MemoryBudget {
  /** The RSS at the last trim, while it stays past the limit. */
  private trimmedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly probe: MemoryProbe,
    private readonly trim: () => TrimReport,
    private readonly log: (line: string) => void,
    readonly limit = MEMORY_LIMIT_BYTES,
  ) {}

  /** Looks at the RSS: past the limit, and grown since the last trim, lets go of the chats not in use and collects. Whether it did. */
  check(): boolean {
    const rss = this.probe.rss();
    if (rss <= this.limit) {
      this.trimmedAt = null;
      return false;
    }
    if (this.trimmedAt !== null && rss < this.trimmedAt + MEMORY_REGROWTH_BYTES) return false;
    this.trimmedAt = rss;
    const gone = this.trim();
    this.probe.collect();
    this.log(`memory: RSS ${Math.round(rss / MB)} MB is past the ${Math.round(this.limit / MB)} MB budget; let go of the copies of ${gone.messages} chats' messages, ${gone.ledgers} open ledgers and ${gone.views} views of chats not in use`);
    return true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), MEMORY_CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
  }
}

/** What the budget reads and trims (`Runtime`). */
export interface Trimmable {
  trimIdle(): TrimReport;
  onChatRead(listener: () => void): void;
}

/**
 * The budget as the backend runs it: looked at every minute, and after each whole read of a chat,
 * whose rows (a couple of hundred megabytes on a long chat) are collected then, so the next read
 * takes the pages they held rather than new ones. Measured (`scripts/perf/chat-reads.ts`, two
 * 870-message chats opened one after the other): the heap after a read stays near 50 MB instead of
 * 130–330 MB, and the second read peaks 120–160 MB lower.
 */
export function watchMemory(runtime: Trimmable, probe: MemoryProbe, log: (line: string) => void, limit = MEMORY_LIMIT_BYTES): MemoryBudget {
  const budget = new MemoryBudget(probe, () => runtime.trimIdle(), log, limit);
  runtime.onChatRead(() => {
    if (!budget.check()) probe.collect();
  });
  budget.start();
  return budget;
}
