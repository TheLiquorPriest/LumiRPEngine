// The story record as the pages read it (DEPTH2-PLAN §1; `shared/story-pages.ts`): the Harness tab's
// Cast and Record, and what Settings → Story → Budget shows of the open chat. Read along the chat's
// path at its head, as every page reads the chat; the player's pin is the one write, kept on the
// newest reply and on the reply before it, so a regenerate or a new swipe of the newest keeps it
// (`castOnReplies`). Every id a view names is given its name as the world names it now; story time
// in words in the world's calendar, at the player character's place, as the story tools write it.

import type { ChatId, UserId } from "../../shared/ids";
import type { Beat, Cast, CastStanding, Draft } from "../../shared/ledger";
import { CAST_STANDINGS } from "../../shared/ledger";
import type { BeatView, BudgetUseView, CastRowView, CastView, DraftView, ReachedItem, ReachedView, RecordReply, RecordView, StoryAnswer, StoryAsk, StoryAt, StoryNames, StoryTime } from "../../shared/story-pages";
import type { WorldDoc } from "../../shared/world";
import type { WorldState } from "../../engine/state";
import { calendarOf, formatClock, placeOffset } from "../../engine/calendar";
import { own } from "../../engine/pack-kit";
import { placeOfEntity } from "../../engine/scope";
import { treatmentsOn } from "../../engine/story/budget";
import { type FeedItem, feedOf, storyName } from "../../engine/story/feed";
import { castOn, type StoryPath, walkStory } from "../../engine/story/record";
import { toChain } from "../ledger-io";
import type { Runtime } from "../runtime";
import { mindFolder } from "./minds";
import { castOnReplies, storyRecords } from "./record";

/** A page's ask the story can't answer, in words the page shows. */
export class StoryPageRefused extends Error {
  constructor(
    readonly code: "bad_request" | "not_found" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "StoryPageRefused";
  }
}

/** What the pages reach of the backend. */
export type StoryPagesRuntime = Pick<Runtime, "ledger" | "runOf" | "host" | "settings">;

/** The newest beats of what reached someone that `reached` shows. */
const REACHED_SHOWN = 20;

/** The chat at its head: its world and state, its path's story with each reply that holds a part, and its newest reply. */
interface StoryHead {
  world: WorldDoc;
  state: WorldState;
  path: StoryPath;
  records: { messageId: string; swipeId: number }[];
  newest: StoryAt | null;
}

async function headOf(rt: StoryPagesRuntime, chatId: ChatId, userId: UserId): Promise<StoryHead> {
  const core = (await rt.runOf(chatId, userId)) ? await rt.ledger.core(chatId, userId) : null;
  if (!core) throw new StoryPageRefused("not_found", "This chat isn't attached to a world.");
  const observed = toChain(await rt.host.chats.messages(chatId, userId));
  const render = core.renderState(observed);
  if (!render) throw new StoryPageRefused("unavailable", "The chat's world isn't loaded yet. Try again in a moment.");
  const chain = core.chain(observed);
  const records = storyRecords(core, chain);
  const last = chain.findLast((m) => !m.isUser);
  return { world: render.world, state: render.state, path: walkStory(records), records: records.map((r) => ({ messageId: r.messageId, swipeId: r.swipeId })), newest: last ? { messageId: last.id, swipeId: last.swipeId } : null };
}

/** Names for what a view mentions: people by their story name ("player" the player's character), places by id. */
class Namer {
  readonly names: StoryNames = {};
  constructor(private readonly head: StoryHead) {}
  person(id: string): string {
    if (id !== "world" && !(id in this.names)) {
      const entity = id === "player" ? this.head.world.pov : id;
      this.names[id] = own(this.head.state.entities, entity)?.name ?? entity;
    }
    return id;
  }
  place(id: string | null): string | null {
    if (id !== null && !(id in this.names)) this.names[id] = own(this.head.world.places, id)?.name ?? id;
    return id;
  }
  time(at: number): StoryTime {
    const { world, state } = this.head;
    return { at, text: formatClock(calendarOf(world), at, placeOffset(world, at, placeOfEntity(state, world.pov))) };
  }
}

/** The folder of someone's mind, where they have one: a principal's or a supporting character's (their profile), the player's character's while the player keeps it on. */
function mindOf(head: StoryHead, entity: string, standing: CastStanding, playerMind: boolean): string | null {
  if (entity === "player") return playerMind ? mindFolder(head.world.pov) : null;
  return standing === "extra" ? null : mindFolder(entity);
}

/** Everyone the story names: the player's character first, then the cast and anyone a beat on the path names, in the order the story first names them. */
async function castView(rt: StoryPagesRuntime, head: StoryHead, userId: UserId): Promise<CastView> {
  const { path, world } = head;
  const playerMind = (await rt.settings.get(userId)).story.minds.playerMind;
  const namer = new Namer(head);
  const order: string[] = ["player"];
  const add = (who: string | undefined) => {
    if (who === undefined || who === "world") return;
    const id = storyName(who, world.pov);
    if (!order.includes(id)) order.push(id);
  };
  for (const c of path.cast) add(c.entity);
  for (const { beat } of path.beats) {
    add(beat.by);
    for (const to of beat.to ?? []) add(to);
    for (const e of beat.exposure) {
      add(e.who);
      add(e.from);
    }
  }
  const index = new Map(path.beats.map((b, i) => [b.beat.id, i]));
  const cast: CastRowView[] = order.map((entity) => {
    const held: Cast | null = castOn(path, entity);
    const standing: CastStanding = held?.standing ?? (entity === "player" ? "principal" : "extra");
    const digestedTo = held?.digestedTo;
    const at = digestedTo === undefined ? undefined : index.get(digestedTo);
    const beat = at === undefined ? undefined : path.beats[at]?.beat;
    // A mind takes in what reached it: a principal's, and the player's character's while it has one.
    const takesIn = entity === "player" ? playerMind : standing === "principal";
    const waiting = takesIn ? feedOf(path, entity, world.pov, beat ? beat.id : null, Number.MAX_SAFE_INTEGER).items.length : 0;
    namer.person(entity);
    return { entity, standing, why: held?.why ?? null, pinned: held?.pinned === true, mind: mindOf(head, entity, standing, playerMind), digested: beat ? { beat: beat.id, time: namer.time(beat.at) } : null, waiting };
  });
  return { cast, names: namer.names };
}

/** The player's pin on `entity`: at `standing`, or lifted (null), kept on the newest reply and the one before it (`castOnReplies`); the cast after it. */
async function pin(rt: StoryPagesRuntime, at: { chatId: ChatId; userId: UserId }, head: StoryHead, entity: string, standing: CastStanding | null): Promise<CastView> {
  if (entity === "player") throw new StoryPageRefused("bad_request", "Your character isn't cast: their place in the story is yours.");
  if (standing !== null && !CAST_STANDINGS.includes(standing)) throw new StoryPageRefused("bad_request", "Pin someone as an extra, a supporting character or a principal.");
  if (standing === null && castOn(head.path, entity)?.pinned !== true) throw new StoryPageRefused("conflict", "There's no pin on them to lift.");
  // Each reply's entry is made from the casting on the path through that reply, with its own reason and mark of what the mind took in.
  const entry = (held: Cast | null): Cast | null => {
    if (standing === null) {
      if (held?.pinned !== true) return null;
      const { pinned: _lifted, ...rest } = held;
      return rest;
    }
    // The author's reason stands only for the standing it gave.
    const why = held && held.standing === standing && held.why !== undefined ? { why: held.why } : {};
    return { entity, standing, pinned: true, ...why, ...(held?.digestedTo !== undefined ? { digestedTo: held.digestedTo } : {}) };
  };
  const written = await castOnReplies(rt, at, entity, entry);
  if ("refused" in written) throw new StoryPageRefused("conflict", written.refused === "no_basis" ? "The chat has no reply yet to keep the pin on. Send a message first." : "The chat moved on while the pin was set. Try again.");
  return castView(rt, await headOf(rt, at.chatId, at.userId), at.userId);
}

/** One feed item as the page shows it. */
function reachedItem(item: FeedItem, namer: Namer, digested: boolean): ReachedItem {
  const head = { beat: item.beat, time: namer.time(item.at), where: namer.place(item.where), digested };
  switch (item.reach) {
    case "whole":
      return { ...head, reach: "whole", by: namer.person(item.by), surface: item.surface, ...(item.quotes ? { quotes: item.quotes } : {}) };
    case "own":
      return { ...head, reach: "own", kind: item.kind, what: item.what, ...(item.quotes ? { quotes: item.quotes } : {}) };
    default:
      return { ...head, reach: item.reach, got: item.got, ...(item.from !== undefined ? { from: namer.person(item.from) } : {}) };
  }
}

/** The newest beats that reached `entity`, oldest first, each marked taken in or not. */
function reached(head: StoryHead, entity: string): ReachedView {
  const { path, world } = head;
  const namer = new Namer(head);
  const who = storyName(entity, world.pov);
  namer.person(who);
  const all = feedOf(path, who, world.pov, null, Number.MAX_SAFE_INTEGER).items;
  const index = new Map(path.beats.map((b, i) => [b.beat.id, i]));
  const digestedTo = castOn(path, who)?.digestedTo;
  const upTo = digestedTo === undefined ? -1 : (index.get(digestedTo) ?? -1);
  const shown = all.slice(-REACHED_SHOWN);
  return { entity: who, items: shown.map((item) => reachedItem(item, namer, (index.get(item.beat) ?? Number.MAX_SAFE_INTEGER) <= upTo)), more: all.length - shown.length, names: namer.names };
}

function beatView(beat: Beat, namer: Namer): BeatView {
  return {
    id: beat.id,
    kind: beat.kind,
    time: namer.time(beat.at),
    where: namer.place(beat.where),
    by: namer.person(beat.by),
    what: beat.what,
    surface: beat.surface,
    quotes: beat.quotes ?? [],
    to: (beat.to ?? []).map((id) => namer.person(id)),
    exposure: beat.exposure.map((e) => ({ who: namer.person(e.who), reach: e.reach, got: e.got ?? null, from: e.from !== undefined ? namer.person(e.from) : null })),
    decidedBy: { agent: beat.decidedBy.agent, as: beat.decidedBy.as !== undefined ? namer.person(beat.decidedBy.as) : null },
    settles: beat.settles ?? null,
    struck: beat.struck ?? null,
    past: beat.past !== undefined,
  };
}

function draftView(draft: Draft, namer: Namer): DraftView {
  return { id: draft.id, what: draft.what, tier: draft.tier, who: draft.who.map((id) => namer.person(id)), where: (draft.where ?? []).map((id) => namer.place(id) ?? id), time: namer.time(draft.when), state: draft.state, notes: draft.notes ?? null, basis: { messageId: draft.basis.messageId, swipeId: draft.basis.swipeId } };
}

/** One reply's beats in the order written (the one asked for, else the newest that wrote any), every reply that wrote some, and the drafts on the path. */
function record(head: StoryHead, asked: StoryAt | undefined): RecordView {
  const { path, records } = head;
  const namer = new Namer(head);
  const byStep = records.map((_, step) => path.beats.filter((b) => b.step === step));
  const replies: RecordReply[] = records
    .map((r, step): RecordReply | null => {
      const beats = byStep[step] ?? [];
      const first = beats[0]?.beat;
      return beats.length === 0 ? null : { messageId: r.messageId, swipeId: r.swipeId, beats: beats.length, time: first ? namer.time(first.at) : null, latest: head.newest !== null && head.newest.messageId === r.messageId };
    })
    .filter((r): r is RecordReply => r !== null)
    .reverse();
  const at = asked ?? (replies[0] ? { messageId: replies[0].messageId, swipeId: replies[0].swipeId } : null);
  const step = at ? records.findIndex((r) => r.messageId === at.messageId && r.swipeId === at.swipeId) : -1;
  const beats = step < 0 ? [] : (byStep[step] ?? []).map((b) => beatView(b.beat, namer));
  const drafts = path.drafts.map((d) => draftView(d.draft, namer));
  return { at, beats, replies, drafts, names: namer.names };
}

/** The treatments the drafts on the path stand for within one stretch either side of now, by tier, as `draft_open` counts them (`budgetSpent`). */
async function budget(rt: StoryPagesRuntime, head: StoryHead, userId: UserId): Promise<BudgetUseView> {
  const { stretchMinutes } = (await rt.settings.get(userId)).story.budget;
  const now = head.state.clock;
  const near = treatmentsOn(head.path).filter((t) => Math.abs(t.at - now) < stretchMinutes);
  const count = (tier: 1 | 2 | 3) => near.filter((t) => t.tier === tier).length;
  return { now: new Namer(head).time(now), used: { t1: count(1), t2: count(2), t3: count(3) } };
}

/** `lre.story`: one page's read or the player's pin, on the chat at its head. */
export async function storyPage(rt: StoryPagesRuntime, at: { chatId: ChatId; userId: UserId }, ask: StoryAsk): Promise<StoryAnswer> {
  const head = await headOf(rt, at.chatId, at.userId);
  switch (ask.op) {
    case "cast":
      return { cast: await castView(rt, head, at.userId) };
    case "pin":
      if (typeof ask.entity !== "string" || ask.entity === "") throw new StoryPageRefused("bad_request", "Say whose standing to pin.");
      return { cast: await pin(rt, at, head, ask.entity, ask.standing ?? null) };
    case "reached":
      if (typeof ask.entity !== "string" || ask.entity === "") throw new StoryPageRefused("bad_request", "Say whose feed to read.");
      return { reached: reached(head, ask.entity) };
    case "record": {
      const asked = ask.at && typeof ask.at.messageId === "string" && Number.isInteger(ask.at.swipeId) ? { messageId: ask.at.messageId, swipeId: ask.at.swipeId } : undefined;
      return { record: record(head, asked) };
    }
    case "budget":
      return { budget: await budget(rt, head, at.userId) };
    default:
      throw new StoryPageRefused("bad_request", "Unknown story page request.");
  }
}
