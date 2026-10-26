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

/** Set/delete operations turning `from` into `to`; arrays are replaced whole when they differ. */
export function diff(from: JsonValue, to: JsonValue, path: (string | number)[] = [], out: DeltaOp[] = []): DeltaOp[] {
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

function asJson(view: StateView): JsonValue {
  return JSON.parse(JSON.stringify(view)) as JsonValue;
}

interface Channel {
  rev: number;
  last: JsonValue | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  /** A push waits behind the one being built: every change until it starts is in it. */
  queued: boolean;
}

export class StatePush {
  private readonly channels = new Map<string, Channel>();

  constructor(
    private readonly host: HostPort,
    private readonly build: (chatId: ChatId, userId: UserId) => Promise<StateView>,
  ) {}

  private channel(chatId: ChatId, userId: UserId): Channel {
    const key = `${userId}\u0000${chatId}`;
    let c = this.channels.get(key);
    if (!c) {
      c = { rev: 0, last: null, timer: null, running: null, queued: false };
      this.channels.set(key, c);
    }
    return c;
  }

  /**
   * A full snapshot for one page (hello, resync, chat open), at once: the last view pushed, at its
   * rev, which every other page's deltas build on too; a delta follows with what changed since. A chat
   * that has pushed nothing yet builds its view first, after the messages already waiting (`giveWay`).
   */
  async snapshot(chatId: ChatId, userId: UserId, frontendSessionId?: string): Promise<void> {
    const c = this.channel(chatId, userId);
    if (c.last === null) {
      await giveWay();
      const view = asJson(await this.build(chatId, userId));
      // Another snapshot or push set the base while this one was built: that one stands, and a delta follows.
      if (c.last === null) {
        c.rev++;
        c.last = view;
      } else this.changed(chatId, userId);
    } else this.changed(chatId, userId);
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.state.snapshot", chatId, rev: c.rev, view: c.last as unknown as StateView }, userId, frontendSessionId);
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
    await giveWay();
    const next = asJson(await this.build(chatId, userId));
    const ops = diff(c.last, next);
    if (ops.length === 0) return;
    const base = c.rev;
    c.rev++;
    c.last = next;
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.state.delta", chatId, base, rev: c.rev, ops }, userId);
  }
}
