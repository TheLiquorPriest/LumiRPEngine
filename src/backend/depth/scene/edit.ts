// The player's edit of a depth reply, or of his own message the beats of what he did and said were
// made from (the bootstrap's, from history), is his directive (DEPTH-PLAN §1.3, §4.2 Edits are
// directives and Retcons propagate, §7 Every edit is a directive). The author reads the message as it
// was and as he made it, beside the beats made from it (his own message as what he now says he did
// or said), and decides what the edit means: cosmetic (a typo), which amends
// nothing; or the beats it amends, which the author writes anew to supersede them (with who
// perceived each, and the points of view the shared reach rule asks for, from the truth-blind render),
// and the beats it takes out with nothing in their place, struck. It all lands as one basis-anchored
// entry at the edited message (§4.9), with the author's reading of the edit (`author.edit`, which
// keeps the message as he made it, so his next edit of it reads that as the message was); a swipe of
// the message leaves it inert. Then everyone with an agent who had lived a beat the edit replaced
// catches up on what reached them: every file of their mind that drew on a replaced beat (from it
// alone or beside others) is out of their mind and recall (`readMind`) until the catch-up, which lives
// the amended beat, keeps it or rewrites it at the same path; one it gives no verdict on, asked twice,
// stays out.
//
// Its caller runs it outside the ledger's queue, for the player's own edit only (never a generation's
// save of its own reply). Edits of one message run one at a time, each reading the one before it.

import { AUTHOR_EDIT, authorData, editEvent, type EditData } from "../../../shared/author";
import { hasAgent, mindedAt, mindV2At, needsPov, ownActWithoutDeed, povOf, presentAt } from "../../../shared/character-engine";
import type { ChatId, EntityId, MessageId, UserId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import { passageOf, STORY_PASSAGE } from "../../../shared/passage";
import { beatEvent, beatId, strikeEvent, type Beat, type Exposure, type PlacedBeat, type StoryRef } from "../../../shared/story";
import { blobHash } from "../../../shared/stores";
import { layerEntryId } from "../../../engine/ledger/layer";
import { stagingBefore, type LiveEvent } from "../../../engine/ledger/story";
import { own } from "../../../engine/pack-kit";
import { fellBackLine, povRender, type PovStaging } from "../../character-agent";
import { catchUpNow, headBasis, knowsFor, land, portFor, povRefs } from "../../character-engine";
import type { BasisRead } from "../../ledger-io";
import { putText, type Blobs } from "../common";
import { readNotebook } from "../notebook";
import type { ModelPort } from "../port";
import { linkTruths } from "../truth-link";
import { beatTexts, twice, type AfterOptions, type AfterRt } from "./after";
import { authorEdit, type DraftBeat, type EditResult } from "./author";

/** What became of the player's edit. */
export interface EditOut {
  /** What became of it, in a line the player may read. */
  said: string;
  /** The author read it as cosmetic (true) or amending (false); null when it wasn't read: the message is off the chain, holds no beats, reads as it was, or the author's answer couldn't be read. */
  cosmetic: boolean | null;
  /** The beats written in place of others, and those struck, by id. */
  amended: string[];
  struck: string[];
  /** Who lived a replaced beat and caught up now. */
  caughtUp: EntityId[];
  /** What of the author's answer couldn't be kept, and the steps that failed, in words. */
  refused: string[];
  failed: string[];
}

/** What the author reads as the message was, when LumiRPEngine never kept its text (history written before depth). */
const UNKEPT = "(LumiRPEngine doesn't keep this reply as it was; the beats above are what it held.)";
const UNKEPT_OWN = "(LumiRPEngine doesn't keep his message as it was; the beats above are what was made from it.)";

/** Each message's edit under way, so the next waits for it and reads it. */
const editing = new Map<string, Promise<EditOut>>();

/**
 * The player edited message `messageId` (a reply, or his own) to `text`: the author reads the edit as
 * his directive, and what it amends lands at the message. Never throws: what failed is in the answer,
 * and logged.
 */
export function replyEdited(rt: AfterRt, chatId: ChatId, userId: UserId, messageId: MessageId, text: string, o: AfterOptions = {}): Promise<EditOut> {
  const key = `${chatId}\u0000${messageId}`;
  const next = (editing.get(key) ?? Promise.resolve()).then(() => edit(rt, chatId, userId, messageId, text, o));
  editing.set(key, next);
  void next.then(() => {
    if (editing.get(key) === next) editing.delete(key);
  });
  return next;
}

/** The reply's text as each passage streamed it, in order; "" when it has none (history written before depth). */
async function passagesText(rt: Pick<AfterRt, "blobs">, userId: UserId, events: readonly LiveEvent[], messageId: MessageId): Promise<string> {
  const parts: string[] = [];
  for (const e of events) {
    if (e.event.type !== STORY_PASSAGE || e.from.messageId !== messageId) continue;
    const p = passageOf("data" in e.event ? e.event.data : null);
    const t = p ? await rt.blobs.get(userId, p.text) : null;
    if (t && t.trim() !== "") parts.push(t.trim());
  }
  return parts.join("\n\n");
}

/**
 * The points of view an amended beat's perceivers get from the truth-blind render, as a scene's beat's
 * do (`SceneBook.povs`): everyone the shared reach rule says needs one, and each actor of a beat with no
 * deed but the player character (`pov`), as the one doing it, against the staging as it stood at the
 * beat it replaces, each told how it may name each person of the moment (`povRefs`); each gets one, the
 * plain fallback where the render, asked again, still wrote none or named someone who wasn't there,
 * which is said.
 */
async function povsOf(rt: AfterRt, userId: UserId, at: BasisRead, old: PlacedBeat, beat: Pick<Beat, "id" | "actors" | "about" | "addressed"> & { surface: string; deed?: string; quotes?: string }, exposure: Exposure[], blobs: Blobs, o: { pov: EntityId; model: ModelPort; texts: Readonly<Record<string, string>>; signal?: AbortSignal }): Promise<string[]> {
  const knows = knowsFor({ registry: rt.registry }, at, exposure.map((x) => x.who));
  const need = exposure.filter((x) => x.pov === undefined && (needsPov({ ...beat, exposure }, x.who, knows[x.who] ?? []) || ownActWithoutDeed(beat, x.who, o.pov))).map((x) => x.who);
  if (need.length === 0) return [];
  const staging: PovStaging[] = [];
  for (const s of stagingBefore(at.story, old.index, old.beat.scene).values()) {
    const occluded = s.occluded !== undefined ? await rt.blobs.get(userId, s.occluded) : null;
    staging.push({ who: s.who, where: (await rt.blobs.get(userId, s.where)) ?? "", doing: (await rt.blobs.get(userId, s.doing)) ?? "", ...(occluded ? { occluded } : {}) });
  }
  const refs = povRefs({ registry: rt.registry }, at, need, [...presentAt({ ...beat, exposure }), ...staging.map((s) => s.who)]);
  const out = await povRender(o.model, { beat: { id: beat.id, surface: beat.surface, ...(beat.deed ? { deed: beat.deed } : {}), ...(beat.quotes ? { quotes: beat.quotes } : {}), actors: beat.actors, exposure }, staging, who: need, refs, texts: o.texts, ...(o.signal ? { signal: o.signal } : {}) });
  for (const x of exposure) {
    const pov = out.povs[x.who];
    if (x.pov === undefined && need.includes(x.who) && pov !== undefined) x.pov = putText(blobs, pov);
  }
  return Object.entries(out.fellBack).map(([who, names]) => fellBackLine(who, `the amended beat ${beat.id}`, names));
}

async function edit(rt: AfterRt, chatId: ChatId, userId: UserId, messageId: MessageId, text: string, o: AfterOptions): Promise<EditOut> {
  const out: EditOut = { said: "", cosmetic: null, amended: [], struck: [], caughtUp: [], refused: [], failed: [] };
  // The message he edited is his own (what he did and said, which the bootstrap made beats from) or a reply.
  let his = false;
  const fail = (what: string, error: unknown): void => {
    const why = error instanceof Error ? error.message : String(error);
    out.failed.push(`${what}: ${why}`);
    rt.host.log("warn", `[LumiRPEngine] chat ${chatId}, the player's edit of ${his ? "his message" : "a reply"}: ${what} didn't go through: ${why}`, userId);
  };
  try {
    const basis = await rt.ledger.basisFor(chatId, userId, messageId);
    const at = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis, [STORY_PASSAGE, AUTHOR_EDIT]) : null;
    if (!basis || !at) return { ...out, said: "The edited message isn't on the chat's chain: nothing to amend." };
    // A reply a Continue carried on unread shows what its scene streamed and what each Continue added: that whole text, or the player's edit of it the author read since, whichever came last, is the reply as it was (`Rec.shown`).
    let shown: { rec: number; text: string } | undefined;
    await rt.ledger.with(chatId, userId, (core, observed) => {
      const m = core.chain(observed).find((x) => x.id === messageId);
      his = m?.isUser === true;
      const rec = m?.ledger?.swipes[String(m.swipeId)];
      if (rec?.unread === "continue" && rec.shown !== undefined) shown = { rec: rec.seq, text: rec.shown };
    });
    const placed = at.story.beats.filter((p) => p.from.messageId === messageId);
    if (placed.length === 0) return { ...out, said: his ? "Nothing was made from your message: nothing to amend." : "The edited reply holds no beats: nothing to amend." };
    const edits = at.events.flatMap((e) => {
      const d = authorData<EditData>(e.event, AUTHOR_EDIT);
      return d && d.message === messageId ? [d] : [];
    });
    const last = edits[edits.length - 1];
    const kept = shown ? await rt.blobs.get(userId, shown.text) : null;
    const before = kept ?? (last ? ((await rt.blobs.get(userId, last.text)) ?? "") : await passagesText(rt, userId, at.events, messageId));
    if (before.replace(/\s+/g, " ").trim() === text.replace(/\s+/g, " ").trim()) return { ...out, said: his ? "Your message reads as it did: nothing to amend." : "The reply reads as it did: nothing to amend." };

    const model = o.model ?? portFor(rt, userId);
    const signal = o.signal ? { signal: o.signal } : {};
    const texts = (await rt.settings.get(userId)).prompts.texts;
    const pov = povOf(at.world, at.state);
    const byRef = new Map(placed.map((p, i) => [`b${i + 1}`, p]));
    const beats = (await beatTexts(rt, userId, placed.map((p) => p.beat))).map((beat, i) => ({ ref: `b${i + 1}`, beat }));
    const notebook = await readNotebook(rt, userId, at.state);
    let read: EditResult;
    try {
      read = await twice(() => authorEdit({ world: at.world, state: at.state, texts, pov, model, ...signal, notebook, own: his, before: before === "" ? (his ? UNKEPT_OWN : UNKEPT) : before, after: text, beats }), o.signal);
    } catch (error) {
      fail("the author's reading", error);
      return { ...out, said: "The author's reading of the edit couldn't be read: nothing was amended." };
    }
    out.refused.push(...read.refused);

    // What the edit amends: each amendment written whole by the author, in the place of the first beat it replaces.
    const key = String(edits.length);
    const entry = layerEntryId("edit", chatId, basis.message, basis.swipe, key, blobHash(text));
    const blobs: Blobs = {};
    const events: PackEvent[] = [];
    const made: Beat[] = [];
    const replaced = new Set<string>();
    const minded = new Set(mindedAt(at.state));
    for (const [i, d] of read.amend.entries()) {
      const olds = d.replaces.flatMap((ref) => byRef.get(ref) ?? []);
      const first = olds[0];
      if (!first) continue;
      // Unique to this edit (its entry: the reply, the edits before it, its text), so an edit held behind a turn never shares an id with the next.
      const id = beatId(entry, String(i));
      const w = await written(rt, userId, at, first, d, { id, pov, minded, entry, blobs, model, texts, ...signal, supersedes: olds.map((p) => p.beat.id) });
      events.push(beatEvent(w.beat));
      made.push(w.beat);
      out.refused.push(...w.refused);
      out.amended.push(id);
      for (const p of olds) replaced.add(p.beat.id);
    }
    out.struck = [...new Set(read.strike.flatMap((ref) => byRef.get(ref)?.beat.id ?? []))].filter((id) => !replaced.has(id));
    if (out.struck.length > 0) events.push(strikeEvent({ beats: out.struck, ...(read.why !== "" ? { why: putText(blobs, read.why) } : {}) }));
    out.cosmetic = out.amended.length === 0 && out.struck.length === 0;
    events.push(editEvent({ message: messageId, text: putText(blobs, text), cosmetic: out.cosmetic, why: read.why, amended: out.amended, struck: out.struck }));
    for (const r of out.refused) rt.host.log("info", `[LumiRPEngine] chat ${chatId}, the player's edit of a reply: ${r}`, userId);
    // Held behind a turn in flight, it lands or is refused only as that turn's windows close (a swipe of this reply leaves the edited swipe behind, and refuses it): what follows reads it as landed, so it waits for that (the final correctness review, finding 3).
    try {
      await land(rt, chatId, userId, basis, out.cosmetic ? AUTHOR_EDIT : "story.beat", { events, blobs, ...(read.reasoning ? { reasoning: read.reasoning } : {}) }, entry, "author", { wait: true });
    } catch (error) {
      fail("keeping the amendment", error);
      return { ...out, said: "The author's reading of the edit couldn't be kept: nothing was amended." };
    }
    // His next edit reads this one's text as the reply was, unless a Continue carries the reply on first: only once it has landed, so a refused edit is read again.
    const was = shown;
    if (was) await rt.ledger.with(chatId, userId, (core, observed) => core.editRead(messageId, was.rec, was.text, blobHash(text), observed));
    if (out.cosmetic) return { ...out, said: `The author read your edit as cosmetic: no beat changed.${read.why !== "" ? ` (${read.why})` : ""}` };

    // Whoever lived a beat it replaced lives what reached them now, the amendment included, and rewrites every file of its mind that drew on a replaced beat at its own path.
    const gone = new Set([...replaced, ...out.struck]);
    const old = placed.filter((p) => gone.has(p.beat.id)).map((p) => p.beat);
    const lived = mindedAt(at.state).filter((who) => hasAgent(at.world, at.state, who) && [...gone].some((b) => hasOwn(mindV2At(at.state, who).lived, b)));
    const caught = await Promise.all(
      lived.map(async (who) => {
        try {
          const r = await catchUpNow(rt, chatId, userId, who, { model, ...signal, gone: old });
          return r.lived > 0 || r.rewritten > 0 ? [who] : [];
        } catch (error) {
          fail(`${own(at.state.entities, who)?.name ?? who}'s catch-up`, error);
          return [];
        }
      }),
    );
    out.caughtUp = caught.flat();
    // The GM links what the amendment made canon and what the catch-ups wrote (§4.4), where they landed (the chat's head): the facts its beats establish, and the beliefs written.
    const head = await headBasis(rt, chatId, userId);
    if (head) {
      try {
        const r = await linkTruths(rt, chatId, userId, head, { who: out.caughtUp, beats: made, key: ["edit", entry], model, ...signal });
        out.refused.push(...r.refused.map((line) => `the GM's truth-link: ${line}`));
      } catch (error) {
        fail("the GM's truth-link", error);
      }
    }
    return { ...out, said: `The author amended ${out.amended.length} beat${out.amended.length === 1 ? "" : "s"} and struck ${out.struck.length} from your edit${read.why !== "" ? `: ${read.why}` : "."}` };
  } catch (error) {
    fail("reading the edit", error);
    return { ...out, said: "The edit couldn't be read: nothing was amended." };
  }
}

/**
 * One amendment, whole: in the place of `first`, the beat it replaces first (its minute, order, scene
 * and place), decided by the author; its exposure the author's, each actor perceiving their own act,
 * and a reach to anyone with an agent pending (no one lived it yet); the points of view it needs. With
 * what couldn't be kept, in words.
 */
async function written(rt: AfterRt, userId: UserId, at: BasisRead, first: PlacedBeat, d: DraftBeat, o: { id: string; pov: EntityId; minded: ReadonlySet<EntityId>; entry: string; blobs: Blobs; model: ModelPort; texts: Readonly<Record<string, string>>; signal?: AbortSignal; supersedes: string[] }): Promise<{ beat: Beat; refused: string[] }> {
  const old = first.beat;
  const exposure: Exposure[] = [];
  const add = (x: { who: EntityId; channel: Exposure["channel"]; reach: Exposure["reach"] }): void => {
    if (exposure.some((e) => e.who === x.who)) return;
    exposure.push({ who: x.who, channel: x.channel, reach: x.reach, ...(x.who !== o.pov && o.minded.has(x.who) ? { pending: true as const } : {}) });
  };
  for (const x of d.exposure) add(x);
  for (const a of d.actors) if (hasOwn(at.state.entities, a)) add({ who: a, channel: "sight", reach: "whole" });
  const about: StoryRef[] = d.about.length > 0 ? d.about : [...new Set([...d.actors, ...(d.addressed ?? [])])].map((entity) => ({ entity }));
  // Its deed, where someone acts in it: each actor lives it as their own act (LIVE3 L3a-4).
  const deed = d.deed !== undefined && d.actors.length > 0 ? d.deed : undefined;
  const refused = await povsOf(rt, userId, at, first, { id: o.id, actors: d.actors, about, ...(d.addressed ? { addressed: d.addressed } : {}), surface: d.surface, ...(deed !== undefined ? { deed } : {}), ...(d.quotes ? { quotes: d.quotes } : {}) }, exposure, o.blobs, { pov: o.pov, model: o.model, texts: o.texts, ...(o.signal ? { signal: o.signal } : {}) });
  const beat: Beat = {
    id: o.id,
    at: old.at,
    ...(old.approx ? { approx: true as const } : {}),
    order: old.order,
    ...(old.scene !== undefined ? { scene: old.scene } : {}),
    place: old.place,
    actors: d.actors,
    act: d.act,
    about,
    what: putText(o.blobs, d.what),
    ...(deed !== undefined ? { deed: putText(o.blobs, deed) } : {}),
    surface: putText(o.blobs, d.surface),
    ...(d.quotes ? { quotes: putText(o.blobs, d.quotes) } : {}),
    ...(d.addressed && d.addressed.length > 0 ? { addressed: d.addressed } : {}),
    exposure,
    by: { turn: "turn" in old.by ? old.by.turn : o.entry, decided: "author" },
    supersedes: o.supersedes,
  };
  return { beat, refused };
}
