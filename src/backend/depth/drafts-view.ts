// GM → Depth → Drafts (DEPTH-PLAN §4.6, §7): every draft on this chat's chain, read per chat and chain
// as the fold reads it (`draftsOn`): open, settled or dropped there, what it read that has changed
// since (an open draft with any reads stale to the author), its episode with each part's treatment
// and the author's grade, its beats dated when they happen, the world changes it would make, whom it
// holds from when, the reply it was drafted at, its pins, and the author's verdicts with their
// reasoning. On an open draft: Settle now (the author reads it against its pins now and settles,
// drops or redrafts it), Drop (the player's own verdict) and Re-draft (dropped, and its episode
// drafted again at its treatments from where the story is now). The player's own presses run
// whatever the ceilings, which bind the author's own work (§6.5). Nothing is withheld (§1.4, D-9).

import { AUTHOR_DROP, dropEvent, STORY_SETTLE, type DraftData } from "../../shared/episodes";
import type { DepthAt, DepthDraft, DepthDraftsView } from "../../shared/depth-views";
import { durationText } from "../../shared/depth-views";
import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import type { Basis, LandResult } from "../../shared/layer";
import { isBlobHash } from "../../shared/stores";
import type { StoryRef } from "../../shared/story";
import type { WorldDoc } from "../../shared/world";
import { calendarOf, formatClock } from "../../engine/calendar";
import { layerEntryId } from "../../engine/ledger/layer";
import { NOTEBOOK_DIR } from "../../engine/notebook";
import type { LiveEvent } from "../../engine/ledger/story";
import { own } from "../../engine/pack-kit";
import type { WorldState } from "../../engine/state";
import { depthOptedIn } from "../bootstrap/service";
import { headBasis } from "../character-engine";
import type { BasisRead } from "../ledger-io";
import type { Runtime } from "../runtime";
import { DRAFT_TYPES, draftsOn, type DraftOn } from "./offscreen/drafts";
import { changedInputs, draftEpisode, landEntry, type OffscreenRt } from "./offscreen/episode";
import { offscreenJobs, type JobsRt } from "./offscreen/jobs";
import type { EpisodeAsk } from "./scene/author";
import { chainNumbers } from "./chat-numbers";

/** What the Drafts view reads of the runtime (`Runtime` is one): the world beyond view's, and the host whole, for whether the chat is on depth and how it numbers its messages. */
export type DraftsRt = JobsRt & Pick<Runtime, "host">;

/** The fold at the chat's head (`headBasis`: before a reply being written) with the live draft events. */
async function headRead(rt: Pick<JobsRt, "ledger">, chatId: ChatId, userId: UserId): Promise<{ basis: Basis; at: BasisRead } | null> {
  const basis = await headBasis(rt, chatId, userId);
  const at = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis, DRAFT_TYPES) : null;
  if (!basis || !at) return null;
  return { basis, at };
}

/** A person's, a place's or a thing's name as the views say it. */
function refName(world: WorldDoc, state: Readonly<WorldState>, ref: StoryRef): string {
  if ("entity" in ref) return own(state.entities, ref.entity)?.name ?? ref.entity;
  if ("place" in ref) return own(world.places, ref.place)?.name ?? ref.place;
  return "thing" in ref ? (own(state.entities, ref.thing)?.name ?? ref.thing) : ref.fact;
}

/** The thinking a layer entry kept beside an event: stored as a text, or inline. */
async function thinkingOf(rt: Pick<OffscreenRt, "blobs">, userId: UserId, e: LiveEvent | undefined): Promise<string> {
  const r = e?.reasoning;
  if (r === undefined) return "";
  return isBlobHash(r) ? ((await rt.blobs.get(userId, r)) ?? "") : r;
}

/** One draft as the view shows it. */
async function draftOf(rt: Pick<OffscreenRt, "blobs" | "registry">, userId: UserId, at: BasisRead, order: ReadonlyMap<MessageId, number>, live: readonly LiveEvent[], d: DraftOn, press?: DepthDraft["press"]): Promise<DepthDraft> {
  const { world, state, story } = at;
  const cal = calendarOf(world);
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const text = async (hash: string | undefined): Promise<string> => (hash ? ((await rt.blobs.get(userId, hash)) ?? "") : "");
  const placeOf = (from: { messageId: MessageId }): DepthAt => ({ messageId: from.messageId, index: order.get(from.messageId) ?? 0 });
  const draft: DraftData = d.draft;
  const inputs = changedInputs(state, draft);
  const changed = [...inputs.minds.map((who) => `${name(who)}'s mind`), ...inputs.notebook.map((path) => `the author's notebook (${path.slice(NOTEBOOK_DIR.length)})`)];
  const ctx = rt.registry.context(world, state);
  const effects = draft.effects.map((e) => {
    try {
      return rt.registry.get(e.type)?.describe(e, ctx) ?? e.type;
    } catch {
      return e.type;
    }
  });
  const beats = [];
  for (const b of draft.beats) {
    const quotes = await text(b.quotes);
    beats.push({ at: formatClock(cal, b.at), what: await text(b.what), surface: await text(b.surface), ...(quotes !== "" ? { quotes } : {}), perceived: b.exposure.map((x) => `${name(x.who)}${x.reach === "partial" ? " (in part)" : ""}`) });
  }
  // The live events that carry its verdicts, for the thinking their entries kept.
  const drafted = live.find((e) => e.event.type === "story.draft" && "data" in e.event && e.event.data.id === draft.id);
  const settled = live.find((e) => e.event.type === STORY_SETTLE && "data" in e.event && e.event.data.draft === draft.id);
  const dropped = live.find((e) => e.event.type === AUTHOR_DROP && "data" in e.event && e.event.data.draft === draft.id);
  const [start, end] = draft.episode.span;
  return {
    id: draft.id,
    state: d.state,
    changed,
    summary: draft.summary,
    at: formatClock(cal, draft.at),
    span: `${formatClock(cal, start)}, for ${durationText(Math.max(0, end - start) * 60_000)}`,
    places: draft.episode.places.map((p) => own(world.places, p)?.name ?? p),
    people: draft.episode.people.map(name),
    why: draft.episode.why,
    parts: draft.episode.parts.map((p) => ({ subject: "who" in p.subject ? name(p.subject.who) : p.subject.event, treatment: p.treatment, rationale: p.rationale })),
    beats,
    effects,
    holds: draft.touches.map((t) => `${refName(world, state, t.ref)} from ${formatClock(cal, t.from)}`),
    basis: placeOf(d.from),
    reasoning: await thinkingOf(rt, userId, drafted),
    pins: d.settle ? d.settle.data.pins.count : story.beats.filter((p) => p.beat.at >= draft.at).length,
    ...(d.settle ? { settle: { ...placeOf(d.settle.from), why: d.settle.data.why, reasoning: await thinkingOf(rt, userId, settled), beats: d.settle.data.beats.length } } : {}),
    ...(d.drop ? { drop: { ...placeOf(d.drop.from), why: d.drop.data.why, reasoning: await thinkingOf(rt, userId, dropped) } } : {}),
    ...(press ? { press } : {}),
  };
}

/** The player's Settle now and Re-draft presses, by user, chat and draft: what each came to, kept while the host runs for the draft's page (the newest `PRESSES_KEPT`). */
const presses = new Map<string, NonNullable<DepthDraft["press"]>>();
const PRESSES_KEPT = 500;
const pressKey = (chatId: ChatId, userId: UserId, draft: string): string => `${userId}\u0000${chatId}\u0000${draft}`;

/** Keeps what a Settle now or Re-draft on draft `draft` came to, for its page in the Drafts view. */
export function notePress(chatId: ChatId, userId: UserId, draft: string, press: NonNullable<DepthDraft["press"]>): void {
  const key = pressKey(chatId, userId, draft);
  presses.delete(key);
  presses.set(key, { op: press.op, state: press.state, lines: [...press.lines] });
  for (const old of presses.keys()) {
    if (presses.size <= PRESSES_KEPT) break;
    presses.delete(old);
  }
}

/** GM → Depth → Drafts: every draft on the chat's chain, newest first. */
export async function draftsView(rt: DraftsRt, chatId: ChatId, userId: UserId): Promise<DepthDraftsView> {
  const head = await headRead(rt, chatId, userId);
  const on = await depthOptedIn(rt, chatId, userId);
  if (!head) return { on, drafts: [] };
  const live = head.at.events;
  const drafts: DepthDraft[] = [];
  // Each message by the number the chat shows it with (`chainNumbers`).
  const order = await chainNumbers(rt.host, chatId, userId, (await rt.ledger.chainBases(chatId, userId)).map((b) => b.message));
  for (const d of draftsOn(live)) drafts.push(await draftOf(rt, userId, head.at, order, live, d, presses.get(pressKey(chatId, userId, d.draft.id))));
  return { on: on || drafts.length > 0, drafts: drafts.reverse() };
}

/** A press the view refuses, in words the player reads. */
export class DraftRefused extends Error {}

/** The open draft `id` at the chat's head, or a refusal saying why it can't be acted on. */
async function openAtHead(rt: DraftsRt, chatId: ChatId, userId: UserId, id: string): Promise<{ basis: Basis; at: BasisRead; draft: DraftData }> {
  const head = await headRead(rt, chatId, userId);
  if (!head) throw new DraftRefused("This chat has no messages yet.");
  const found = draftsOn(head.at.events).find((d) => d.draft.id === id);
  if (!found) throw new DraftRefused("That draft isn't on this chat's chain any more.");
  if (found.state !== "open") throw new DraftRefused(`That draft is already ${found.state} here.`);
  return { basis: head.basis, at: head.at, draft: found.draft };
}

/** Drop: the player's own verdict that open draft `id` won't happen, landed at the chat's head beside the author's records. */
export async function dropDraft(rt: DraftsRt, chatId: ChatId, userId: UserId, id: string, why = "You dropped it from GM → Depth → Drafts."): Promise<LandResult> {
  const { basis } = await openAtHead(rt, chatId, userId, id);
  const r = await landEntry(rt, chatId, userId, { id: layerEntryId(AUTHOR_DROP, chatId, id, basis.message, basis.swipe), basis, kind: AUTHOR_DROP, events: [dropEvent({ draft: id, why })], by: { role: "player" } }, {});
  if (r.status === "refused") throw new DraftRefused(`LumiRPEngine couldn't keep the drop: ${r.reason}`);
  return r;
}

/**
 * Settle now: the author reads open draft `id` against its pins at the chat's head, as the poll's
 * settlement does, and settles it, drops it or redrafts it for later. What became of it, in words.
 */
export async function settleNow(rt: DraftsRt, chatId: ChatId, userId: UserId, id: string): Promise<string[]> {
  const { basis } = await openAtHead(rt, chatId, userId, id);
  const budget = (await rt.settings.get(userId)).depth.budget;
  const out = await offscreenJobs(rt, chatId, userId, basis, { episodes: [], settle: [{ draft: id, why: "The player asked to settle it now (GM → Depth → Drafts)." }], drop: [], rebase: [] }, { budget });
  const said = [...out.said];
  if (out.settled.includes(id)) said.unshift("The author settled it: its beats are canon now, at its own time.");
  else if (out.dropped.includes(id)) said.unshift(out.drafted.length > 0 ? "The author redrafted it for later." : "The author dropped it.");
  return said;
}

/** A redraft's place among the episodes at its basis: from the draft's own id, so it never meets a poll's (which count from 0) and a second press lands the same draft. */
function redraftIndex(id: string): number {
  return 0x10000000 + Number.parseInt(id.slice(1, 8), 16);
}

/**
 * Re-draft: open draft `id` dropped at the chat's head, and its episode drafted again there at its
 * treatments (the player's ask, past the allowances), at the same story time, from the world as it
 * now stands. What became of it, in words.
 */
export async function redraft(rt: DraftsRt, chatId: ChatId, userId: UserId, id: string): Promise<string[]> {
  const { basis, at, draft } = await openAtHead(rt, chatId, userId, id);
  await dropDraft(rt, chatId, userId, id, "You asked for it to be redrafted (GM → Depth → Drafts).");
  const [start, end] = draft.episode.span;
  const episode: EpisodeAsk = {
    why: draft.episode.why,
    in: start - at.state.clock,
    minutes: Math.max(1, end - start),
    places: draft.episode.places,
    people: draft.episode.people,
    parts: draft.episode.parts.map((p) => ({ subject: p.subject, treatment: p.treatment, rationale: `${p.rationale} (redrafted at your ask)`.trim() })),
  };
  const r = await draftEpisode(rt, chatId, userId, basis, episode, { index: redraftIndex(id) });
  const said = [...r.said];
  if (r.landed?.status === "refused") said.unshift(`The redraft wasn't kept: ${r.landed.reason}`);
  else if (r.draft) said.unshift("The author redrafted it from where the story is now.");
  return said;
}
