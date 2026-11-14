// RPE's side of the relay (STANDALONE-PLAN §4.3, §18.1 row 0.6): live updates for a Lumiverse page that
// cannot reach RPE directly. A page asks the extension to follow a chat; the extension tells RPE's live
// route; RPE follows the chat in its live hub for that page, and sends what comes on its relay socket,
// a socket into Lumiverse kept for nothing else, for the extension to hand to the page.
//
// Why a socket of its own, and why coalesced: Lumiverse lets a socket's sender get only 16 frames ahead
// of its handler before it stops reading, closes the socket when it is not back down to 4 within 10
// seconds, and closes it at once past 64 frames or 8 MiB (`ws/receive-queue.ts:21-25`, `:81-95`,
// `:142-145`); a frame over 1 MiB, or 4 MiB for an extension's message, is dropped unseen
// (`ws/handler.ts:262-281`). A busy turn makes hundreds of updates a second, which would close any
// socket that sent each as a frame of its own: on the event socket that would cut RPE off from the
// user's chats. So the relay sends at most one frame per page every `flushMs`, each carrying every
// batch the hub gave for that page since, in order; a list too long for one frame goes in parts, one
// part per flush. When a page has `holdChars` waiting, the relay tells the hub it is full, and the hub
// holds the chat's events, puts newer state pushes in place of older ones and, past its own cap,
// drops the oldest and says which (`src/app/live.ts`, `LiveReader`); the relay takes them again when
// the page's queue has drained.

import type { Clock } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { readToRpe, type LiveAsk, type LiveFrame, type MissingPermission, type Registration } from "./pipe-wire";
import type { LumiverseSocket } from "./socket";

export interface RelaySettings {
  /** How often queued batches go out: at most one frame per page each time. */
  flushMs: number;
  /** The longest a frame's data may be, in characters; a longer list goes in parts. */
  frameChars: number;
  /** How long a page's follow lasts unless the page asks again. */
  leaseMs: number;
  /** How much a page may have waiting, in characters, before the hub is asked to hold its chats' events. */
  holdChars: number;
  /** How long after the extension refused RPE's registration, or RPE could not send it, RPE registers again. */
  retryMs: number;
}

/** Fixed defaults: four frames a second per page; frames far under Lumiverse's 1 MiB; a follow the page renews every 20 s outlives two missed renewals; a second's worth of frames waiting; a refused registration tried again twice a minute. */
export const RELAY_DEFAULTS: RelaySettings = { flushMs: 250, frameChars: 256 * 1024, leaseMs: 60_000, holdChars: 1024 * 1024, retryMs: 30_000 };

/** A chat followed in RPE's live hub for a page. */
export interface LiveFollowing {
  /** The page has room again: what the hub held comes now. */
  ready(): void;
  stop(): void;
}

export interface RelayDeps {
  /** The relay socket: a `LumiverseSocket` opened with a frontend session of its own. */
  socket: LumiverseSocket;
  /** Lumiverse's id for the extension, which frames are addressed to. */
  extension(): Promise<string>;
  /** What RPE tells the extension of itself, each time the socket opens; null while it cannot say (its server not listening yet). */
  registration(): Registration | null;
  /** RPE's live hub: a chat's batches as their JSON text, in order, from now; `take` answers false when the page is full. */
  follow(chat: string, take: (text: string) => boolean): LiveFollowing;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  /** Whether the extension holds RPE's registration, each time that is known: null when it took it; else why not, in words a user is shown. */
  held(why: string | null): void;
  /** What the extension says it is missing, each time it says so: RPE's UI shows it. */
  permissions(missing: MissingPermission[]): void;
  settings?: Partial<RelaySettings>;
}

interface Page {
  chats: Map<string, LiveFollowing>;
  /** Chats whose following was told the page is full. */
  held: Set<string>;
  /** Batches not framed yet, as their JSON text, and their length in all. */
  queue: string[];
  queued: number;
  /** Frames made and not sent yet: the parts of one list. */
  outbox: Omit<LiveFrame, "page">[];
  seq: number;
  until: number;
}

export class Relay {
  private readonly settings: RelaySettings;
  private readonly pages = new Map<string, Page>();
  private timer: unknown = null;
  /** The next registration, armed while the extension does not hold RPE's. */
  private retry: unknown = null;
  private extensionId: string | null = null;
  private offs: (() => void)[] = [];

  constructor(private readonly deps: RelayDeps) {
    this.settings = { ...RELAY_DEFAULTS, ...deps.settings };
  }

  /**
   * Registers with the extension each time the relay socket opens, and each time Lumiverse starts the
   * extension again (`SPINDLE_EXTENSION_LOADED`, sent to every socket), since a restarted worker
   * knows only what its storage holds; and hears what the extension says back. While the extension
   * refuses RPE's registration, or RPE cannot send it, RPE sends it again every `retryMs`: a grant
   * the extension was waiting for, or an extension installed only now, needs nothing more.
   */
  start(): void {
    this.offs.push(
      this.deps.socket.onOpen(() => void this.register()),
      this.deps.socket.onEvent((event, payload) => {
        if (!isRecord(payload) || payload.extensionId !== this.extensionId) return;
        if (event === "SPINDLE_EXTENSION_LOADED") {
          void this.register();
          return;
        }
        if (event !== "SPINDLE_FRONTEND_MSG") return;
        const said = readToRpe(payload.data);
        if (said === null) return;
        if (said.rpe === "registered") this.held(null);
        else if (said.rpe === "refused") this.held(`RPE's extension in Lumiverse refused RPE's registration: ${said.why}`);
        this.deps.permissions(said.missing);
      }),
    );
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    for (const page of [...this.pages.keys()]) this.drop(page);
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.retry !== null) this.deps.clock.clearTimeout(this.retry);
    this.retry = null;
  }

  private async register(): Promise<void> {
    try {
      this.extensionId ??= await this.deps.extension();
      const registration = this.deps.registration();
      if (registration === null) {
        this.held("RPE did not register with its extension in Lumiverse yet: its server is not listening.");
        return;
      }
      this.deps.socket.send({ type: "SPINDLE_BACKEND_MSG", extensionId: this.extensionId, payload: { rpe: "register", registration } });
      // What was queued while the socket was closed goes now.
      if ([...this.pages.values()].some((p) => p.queue.length > 0 || p.outbox.length > 0)) this.arm();
    } catch (error) {
      this.held(`RPE could not register with its extension in Lumiverse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Whether the extension holds RPE's registration now, said on; while it does not, RPE registers again in `retryMs`. */
  private held(why: string | null): void {
    // A word that comes after the relay stopped is no one's to hear.
    if (this.offs.length === 0) return;
    this.deps.held(why);
    if (why === null) {
      if (this.retry !== null) this.deps.clock.clearTimeout(this.retry);
      this.retry = null;
    } else if (this.retry === null) {
      this.retry = this.deps.clock.setTimeout(() => {
        this.retry = null;
        // A closed socket registers when it opens again.
        if (this.deps.socket.open) void this.register();
      }, this.settings.retryMs);
    }
  }

  /** What a page asked through the extension: follow a chat, stop following it, or it is gone. */
  ask(ask: LiveAsk): void {
    const now = this.deps.clock.now();
    this.sweep(now);
    if ("gone" in ask) {
      this.drop(ask.page);
      return;
    }
    let page = this.pages.get(ask.page);
    if (!ask.follow) {
      page?.chats.get(ask.chat)?.stop();
      page?.chats.delete(ask.chat);
      page?.held.delete(ask.chat);
      if (page !== undefined && page.chats.size === 0) this.drop(ask.page);
      return;
    }
    if (page === undefined) {
      page = { chats: new Map(), held: new Set(), queue: [], queued: 0, outbox: [], seq: 0, until: 0 };
      this.pages.set(ask.page, page);
    }
    page.until = now + this.settings.leaseMs;
    if (!page.chats.has(ask.chat)) {
      const target = page;
      const chat = ask.chat;
      page.chats.set(chat, this.deps.follow(chat, (text) => this.take(ask.page, target, chat, text)));
    }
  }

  /** The pages followed now, and the chats each follows. */
  following(): Map<string, string[]> {
    return new Map([...this.pages].map(([id, p]) => [id, [...p.chats.keys()]]));
  }

  private drop(id: string): void {
    const page = this.pages.get(id);
    if (page === undefined) return;
    for (const following of page.chats.values()) following.stop();
    this.pages.delete(id);
  }

  private sweep(now: number): void {
    for (const [id, page] of this.pages) if (page.until <= now) this.drop(id);
  }

  /** A batch for a page; false tells the hub the page is full. */
  private take(id: string, page: Page, chat: string, text: string): boolean {
    if (this.pages.get(id) !== page) return true;
    page.queue.push(text);
    page.queued += text.length;
    this.arm();
    if (page.queued < this.settings.holdChars) return true;
    page.held.add(chat);
    return false;
  }

  private arm(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.settings.flushMs);
  }

  /** Every batch queued for the page, as one list of frames: one, or the list's parts. */
  private frame(page: Page): void {
    const data = `[${page.queue.join(",")}]`;
    page.queue = [];
    page.queued = 0;
    const seq = ++page.seq;
    const parts = Math.max(1, Math.ceil(data.length / this.settings.frameChars));
    for (let index = 0; index < parts; index++) {
      page.outbox.push({ seq, data: data.slice(index * this.settings.frameChars, (index + 1) * this.settings.frameChars), ...(parts > 1 ? { part: { index, count: parts } } : {}) });
    }
    // The page has room again: what the hub held for it comes now, into the next frame.
    for (const chat of [...page.held]) {
      page.held.delete(chat);
      page.chats.get(chat)?.ready();
    }
  }

  /** One frame for each page that has something to send. */
  private flush(): void {
    this.sweep(this.deps.clock.now());
    const id = this.extensionId;
    const registration = this.deps.registration();
    // Kept while the socket is closed: the next open registers and sends it.
    if (id === null || registration === null || !this.deps.socket.open) return;
    let more = false;
    for (const [pageId, page] of this.pages) {
      if (page.outbox.length === 0 && page.queue.length > 0) this.frame(page);
      const next = page.outbox.shift();
      if (next === undefined) continue;
      this.deps.socket.send({ type: "SPINDLE_BACKEND_MSG", extensionId: id, payload: { rpe: "live", key: registration.key, page: pageId, ...next } });
      if (page.outbox.length > 0 || page.queue.length > 0) more = true;
    }
    if (more) this.arm();
  }
}
