// State push (ARCHITECTURE §4): a snapshot on hello, resync and chat open; afterwards deltas
// against the last view sent, with a strictly increasing `rev` per (user, chat). Pushes are
// coalesced per chat. Every page of the user shares one rev: a page that asks for a snapshot gets
// the view the others hold, at their rev, so it never moves anyone's base, and a delta brings all of
// them up to date.

import type { ChatId, UserId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { DeltaOp } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import { giveWay } from "./give-way";
import type { HostPort } from "./host";

/** Set/delete operations turning `from` into `to`; arrays are replaced whole when they differ. A part that is the same object in both is unchanged. */
export function diff(from: JsonValue, to: JsonValue, path: (string | number)[] = [], out: DeltaOp[] = []): DeltaOp[] {
  if (from === to) return out;
  if (isRecord(from) && isRecord(to) && !Array.isArray(from) && !Array.isArray(to)) {
    for (const key of Object.keys(from)) if (!(key in to)) out.push({ op: "del", path: [...path, key] });
    for (const [key, value] of Object.entries(to)) {
      const before = from[key];
      if (before === undefined) out.push({ op: "set", path: [...path, key], value });
      else diff(before, value, [...path, key], out);
    }
    return out;
  }
  if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ op: "set", path, value: to });
  return out;
}

/**
 * `value` as JSON, as `JSON.parse(JSON.stringify(value))` makes it, except that a part that is the
 * same frozen object `before` held at the same place is `json`'s part there again (`json` being
 * `before` as JSON): the view parts kept between builds (`ViewMemo`, frozen whole) are neither copied
 * again nor compared, since `diff` stops at the same object. Undefined where JSON leaves the value out.
 */
function toJson(value: unknown, before: unknown, json: JsonValue | undefined): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return undefined;
  if (value === before && json !== undefined && Object.isFrozen(value)) return json;
  if (Array.isArray(value)) {
    const was = Array.isArray(before) ? before : null;
    const wasJson = Array.isArray(json) ? json : null;
    return value.map((v, i) => toJson(v, was?.[i], wasJson?.[i]) ?? null);
  }
  if ("toJSON" in value && typeof value.toJSON === "function") return JSON.parse(JSON.stringify(value)) as JsonValue;
  const was = isRecord(before) ? before : null;
  const wasJson = isRecord(json) && !Array.isArray(json) ? json : null;
  const out: Record<string, JsonValue> = {};
  for (const [key, v] of Object.entries(value)) {
    const j = toJson(v, was?.[key], wasJson?.[key]);
    if (j !== undefined) out[key] = j;
  }
  return out;
}

/** A view built for a push, and it as JSON (`toJson`). */
interface Built {
  view: StateView;
  json: JsonValue;
}

interface Channel {
  rev: number;
  /** The view last pushed, as JSON: the base of the next delta. */
  last: JsonValue | null;
  /** The view `last` was made from: the next one's parts that are the same frozen objects reuse `last`'s. */
  source: StateView | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  /** A push waits behind the one being built: every change until it starts is in it. */
  queued: boolean;
  /** Views being built for it now: a channel with one in flight is never let go, so an older view can't land after a newer one. */
  building: number;
}

/**
 * Chats whose last pushed view is kept (the base every page's deltas build on). A view is the size of
 * a chat's state view (hundreds of kB for a large world), so a chat pushed longer ago than the newest
 * `VIEWS_KEPT` is built afresh when next pushed: its pages get a snapshot, and deltas after it.
 */
export const VIEWS_KEPT = 32;

export class StatePush {
  private readonly channels = new Map<string, Channel>();
  /** Every rev is new across chats and evictions, so a delta never matches a view another channel sent. */
  private revs = 0;

  constructor(
    private readonly host: HostPort,
    private readonly build: (chatId: ChatId, userId: UserId) => Promise<StateView>,
  ) {}

  private channel(chatId: ChatId, userId: UserId): Channel {
    const key = `${userId}\u0000${chatId}`;
    let c = this.channels.get(key);
    if (!c) {
      c = { rev: 0, last: null, source: null, timer: null, running: null, queued: false, building: 0 };
      this.channels.set(key, c);
    }
    return c;
  }

  /** The channel just pushed `built` at a new rev: it becomes the newest, and the views of the chats pushed longest ago go past `VIEWS_KEPT`. */
  private pushed(chatId: ChatId, userId: UserId, c: Channel, built: Built): void {
    c.rev = ++this.revs;
    c.last = built.json;
    c.source = built.view;
    const key = `${userId}\u0000${chatId}`;
    this.channels.delete(key);
    this.channels.set(key, c);
    for (const [other, o] of this.channels) {
      if (this.channels.size <= VIEWS_KEPT) break;
      if (other !== key && o.timer === null && !o.queued && o.building === 0) this.channels.delete(other);
    }
  }

  /** How many chats' views are kept (tests). */
  kept(): number {
    return this.channels.size;
  }

  /**
   * Lets go of the views kept for the chats `inUse` doesn't name (the memory budget, DESIGN §9.6),
   * but not one with a push scheduled or under way: such a chat's next push is a snapshot. How many went.
   */
  trim(inUse: (chatId: ChatId) => boolean): number {
    let gone = 0;
    for (const [key, c] of this.channels) {
      if (inUse(key.slice(key.indexOf("\u0000") + 1)) || c.timer !== null || c.queued || c.building > 0) continue;
      this.channels.delete(key);
      gone++;
    }
    return gone;
  }

  /**
   * A full snapshot for one page (hello, resync, chat open), at once: the last view pushed, at its
   * rev, which every other page's deltas build on too; a delta follows with what changed since. A chat
   * that has pushed nothing yet builds its view first, after the messages already waiting (`giveWay`).
   */
  async snapshot(chatId: ChatId, userId: UserId, frontendSessionId?: string): Promise<void> {
    const c = this.channel(chatId, userId);
    if (c.last === null) {
      const built = await this.built(c, chatId, userId);
      // Another snapshot or push set the base while this one was built: that one stands, and a delta follows.
      if (c.last === null) this.pushed(chatId, userId, c, built);
      else this.changed(chatId, userId);
    } else this.changed(chatId, userId);
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.state.snapshot", chatId, rev: c.rev, view: c.last as unknown as StateView }, userId, frontendSessionId);
  }

  /** The chat's view now, built after the messages already waiting (`giveWay`), with its JSON made against the view last pushed (`toJson`); its channel stays while it is built. */
  private async built(c: Channel, chatId: ChatId, userId: UserId): Promise<Built> {
    c.building++;
    try {
      await giveWay();
      const view = await this.build(chatId, userId);
      return { view, json: toJson(view, c.source, c.last ?? undefined) ?? null };
    } finally {
      c.building--;
    }
  }

  /** Schedules a delta push for the chat (coalesced). */
  changed(chatId: ChatId, userId: UserId): void {
    const c = this.channel(chatId, userId);
    if (c.timer) return;
    c.timer = setTimeout(() => {
      c.timer = null;
      this.run(c, chatId, userId);
    }, 40);
  }

  /** Builds after the push being built, once however many changes arrive meanwhile (a turn's steps each tell of one). */
  private run(c: Channel, chatId: ChatId, userId: UserId): void {
    if (c.queued) return;
    c.queued = true;
    const prior = c.running ?? Promise.resolve();
    c.running = prior
      .then(() => {
        c.queued = false;
        return this.flush(chatId, userId);
      })
      .catch((error: unknown) => this.host.log("error", `[LumiRPEngine] push ${chatId}: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Sends every scheduled push now and waits for them (tests; shutdown). */
  async settle(): Promise<void> {
    for (const [key, c] of this.channels) {
      if (c.timer) {
        clearTimeout(c.timer);
        c.timer = null;
        const [userId = "", chatId = ""] = key.split("\u0000");
        this.run(c, chatId, userId);
      }
      await c.running;
    }
  }

  private async flush(chatId: ChatId, userId: UserId): Promise<void> {
    const c = this.channel(chatId, userId);
    if (c.last === null) {
      await this.snapshot(chatId, userId);
      return;
    }
    const next = await this.built(c, chatId, userId);
    const ops = diff(c.last, next.json);
    if (ops.length === 0) {
      // The same view: the base stays, held as this build made it, so the next build reuses its parts.
      c.last = next.json;
      c.source = next.view;
      return;
    }
    const base = c.rev;
    this.pushed(chatId, userId, c, next);
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.state.delta", chatId, base, rev: c.rev, ops }, userId);
  }
}
