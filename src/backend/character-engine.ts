// The Character Engine at run time (DEPTH-PLAN §4.4, §7): what GM → Minds reads and asks (every
// character with a mind, one mind whole, the player's edit of a mind file, an interview, the
// switch of player character), and the jobs that run a character's agent between turns (catch up
// now, reflect now) and seed cores from cards (D-17). Everything a job writes lands as a
// basis-anchored layer entry (§4.9) through the ledger, anchored at the message it read (the head
// by default), with its blobs put first; a fold never calls a model. Every view is the player's to
// read: nothing here is gated (§1.4).

import {
  AGENT_MODES,
  MIND_INTERVIEW,
  MIND_LIVED,
  MIND_POV,
  MIND_WRITE,
  MINDS_DIR,
  drewOn,
  exposedBeats,
  hasAgent,
  mindDir,
  mindFileOf,
  mindFileWrite,
  mindMetaAt,
  mindV2At,
  mindWriteEvent,
  mindInterviewOf,
  takesOf,
  mindedAt,
  pendingFor,
  storyOrder,
  pinnedBy,
  povOf,
  reachOf,
  livedCorpus,
  recallSearch,
  writtenFromGone,
  type RecallHit,
  type ExposedBeat,
  type Reach,
  type MindMode,
} from "../shared/character-engine";
import { mindFileOrder, type DepthBeatRef, type DepthEffort, type DepthInterview, type DepthMindFile, type DepthMindRow, type DepthMindTake, type DepthMindView, type DepthMindWrite, type DepthMindsView, type DepthPov, type DepthProbe } from "../shared/depth-views";
import type { ChatId, EntityId, MessageId, UserId } from "../shared/ids";
import { hasOwn } from "../shared/json";
import type { Basis, FoldLayerEntry, LandResult, LayerDraft } from "../shared/layer";
import { sceneOf, STORY_SCENE } from "../shared/scene";
import type { UserSettings } from "../shared/settings";
import type { PlacedBeat, StoryRead } from "../shared/story";
import { blobHash } from "../shared/stores";
import { parseMoneyInput } from "../shared/money";
import { calendarOf, clockOfStamp, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import type { ChainMessage } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { basisAt, layerEntryId, liveLayer } from "../engine/ledger/layer";
import type { LiveEvent } from "../engine/ledger/story";
import { playerKnows } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindIs } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { WorldDoc } from "../shared/world";
import type { InterviewAsker } from "../shared/character-engine";
import { catchUp, formCore, interview, reflect, type LivedPov, type MindFiles, type MindInput, type MindRewrite, type PovRefs, type StageOut } from "./character-agent";
import type { ModelPort } from "./depth/port";
import { DRAFT_TYPES, draftsOn, heldFrom } from "./depth/offscreen/drafts";
import { placeNamed } from "./depth/common";
import { depthPort } from "./depth-model-host";
import type { HostPort } from "./host";
import { chatNumbers } from "./depth/chat-numbers";

/** What the Character Engine needs of the runtime (`Runtime` is one). */
export interface EngineRt {
  readonly host: Pick<HostPort, "models" | "log" | "storage" | "chats" | "characters">;
  readonly registry: Registry;
  readonly blobs: { get(userId: UserId, hash: string): Promise<string | null>; put(userId: UserId, text: string, holder?: string): Promise<string> };
  readonly settings: { get(userId: UserId): Promise<UserSettings> };
  readonly ledger: {
    basisFor(chatId: ChatId, userId: UserId, messageId?: MessageId): Promise<Basis | null>;
    /** The fold at `basis` with its story, and the live events of `types` through it; `without`, layer entries read as superseded (an Undo past the head reads the file as it was before the edit). */
    foldAtBasis(chatId: ChatId, userId: UserId, basis: Basis, types?: readonly string[], without?: ReadonlySet<string>): Promise<{ state: WorldState; world: WorldDoc; story: StoryRead; events?: readonly LiveEvent[] } | null>;
    /** With `wait`, a result a turn in flight holds answers only once its window closes, landed or refused. */
    landLayer(chatId: ChatId, userId: UserId, draft: LayerDraft, o?: { wait?: boolean }): Promise<LandResult>;
    /** Every live event of these types on the active chain, in fold order, with where it was read from and, for a layer entry, its reasoning blob. */
    readEvents(chatId: ChatId, userId: UserId, types: readonly string[]): Promise<LiveEvent[]>;
    /** Runs `op` on the chat's queue, with its core and the chain as observed (`headBasis`). */
    with(chatId: ChatId, userId: UserId, op: (core: LedgerCore, observed: ChainMessage[]) => void | Promise<void>): Promise<void>;
  };
}

/** A Character Engine request the chat can't take as it stands, in words the user reads. */
export class MindRefused extends Error {
  constructor(
    readonly code: "empty_chat" | "moved" | "no_one" | "player_character" | "bad_path" | "refused",
    message: string,
  ) {
    super(message);
    this.name = "MindRefused";
  }
}

/** A fold at a basis with its story: what a Character Engine job reads (`LedgerService.foldAtBasis`, with the basis it read), and the live events of the types it asked for. */
export interface AtBasis {
  basis: Basis;
  state: WorldState;
  world: WorldDoc;
  story: StoryRead;
  events?: readonly LiveEvent[];
}

/**
 * The basis a job started at the chat's head records (DEPTH-PLAN §4.9): its last message, or, while a
 * generation writes a reply (a new message, or a new swipe of the last), the last one before it. That
 * reply has no key that lasts until it is kept (its blank's text gives way to its record's seq), so
 * what was anchored at it would be refused then; anchored before it, it is held through the turn and
 * lands as the reply is kept, checked against it. Null for a chat with no messages.
 */
export async function headBasis(rt: { readonly ledger: Pick<EngineRt["ledger"], "with"> }, chatId: ChatId, userId: UserId): Promise<Basis | null> {
  let out: Basis | null = null;
  await rt.ledger.with(chatId, userId, (core, observed) => {
    out = headBasisOf(core, observed);
  });
  return out;
}

/** `headBasis` read on the chat's queue, from its core and the chain as observed. */
function headBasisOf(core: LedgerCore, observed: readonly ChainMessage[]): Basis | null {
  const writing = new Set(Object.values(core.journal.pending).flatMap((p) => (p.messageId ? [p.messageId] : [])));
  const chain = core.chain(observed);
  let last = chain.length - 1;
  while (last >= 0 && writing.has(chain[last]?.id ?? "")) last--;
  return basisAt(chain, core.journal.tombstones, last);
}

/** The fold at the chat's head (`headBasis`, or at `basis`), with its story and the live events of `types`: what every Character Engine job reads, remembering after a reply included (`depth/scene/remember.ts`). On the ledger's queue: never awaited inside an operation on it. */
export async function foldAt(rt: Pick<EngineRt, "ledger">, chatId: ChatId, userId: UserId, basis?: Basis, types?: readonly string[]): Promise<AtBasis> {
  const b = basis ?? (await headBasis(rt, chatId, userId));
  if (!b) throw new MindRefused("empty_chat", "This chat has no messages yet.");
  const at = await rt.ledger.foldAtBasis(chatId, userId, b, types);
  if (!at) throw new MindRefused("moved", "The chat moved on while this was read; try again.");
  return { basis: b, ...at };
}

const nameOf = (world: WorldDoc, state: Readonly<WorldState>, id: EntityId): string => (hasOwn(state.entities, id) ? state.entities[id]?.name : undefined) ?? (hasOwn(world.entities, id) ? world.entities[id]?.name : undefined) ?? id;

/** The people of the chat now: every person entity not gone, by name. */
function peopleOf(rt: Pick<EngineRt, "registry">, world: WorldDoc, state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => {
      const e = state.entities[id];
      return e !== undefined && kindIs(rt.registry, world, e.kind, "person") && !isGone(state, id);
    })
    .sort((a, b) => nameOf(world, state, a).localeCompare(nameOf(world, state, b)));
}

function personOf(rt: EngineRt, world: WorldDoc, state: Readonly<WorldState>, who: EntityId): void {
  if (!peopleOf(rt, world, state).includes(who)) throw new MindRefused("no_one", `No one in this chat has the id ${who}.`);
}

/**
 * Whom each of `perceivers` knows by name at a state (has met, and can see): the reach rule's
 * `knows` (`needsPov`), and the narrator's. Anyone else is told as they appear.
 */
export function knowsFor(rt: Pick<EngineRt, "registry">, at: Pick<AtBasis, "state" | "world">, perceivers: readonly EntityId[]): Record<EntityId, EntityId[]> {
  const people = peopleOf(rt, at.world, at.state);
  return Object.fromEntries(perceivers.map((p) => [p, people.filter((id) => id !== p && playerKnows(rt.registry, at.world, at.state, p, id))]));
}

/**
 * How each of `perceivers` may name the people of a beat's moment (`present`, the ids `presentAt`
 * gives and whoever the render's staging places), for the point-of-view render (`PovRefs`): each one
 * it knows by name (`knowsFor`) by that name, anyone else by no name, only as they appear (their
 * names, `strangers`, never reach the render); the names it knows of people who weren't there, which
 * its point of view may not use; and the names of the world, its places and its things. An id the
 * state holds as something other than a person (a thing the beat concerns) is no one; one it doesn't
 * hold yet (someone the history has just met) is a person no one knows, with no name to keep from it.
 */
export function povRefs(rt: Pick<EngineRt, "registry">, at: Pick<AtBasis, "state" | "world">, perceivers: readonly EntityId[], present: readonly EntityId[]): Record<EntityId, PovRefs> {
  const people = peopleOf(rt, at.world, at.state);
  const here = [...new Set(present)].filter((id) => people.includes(id) || !hasOwn(at.state.entities, id));
  const knows = knowsFor(rt, at, perceivers);
  const things = Object.keys(at.state.entities).filter((id) => !kindIs(rt.registry, at.world, at.state.entities[id]?.kind ?? "", "person"));
  const world = [...new Set([at.world.name, ...Object.values(at.world.places).map((p) => p.name), ...things.map((id) => nameOf(at.world, at.state, id))])].filter((n) => n.trim() !== "");
  return Object.fromEntries(
    perceivers.map((p): [EntityId, PovRefs] => {
      const known = knows[p] ?? [];
      const others = here.filter((id) => id !== p);
      const named = Object.fromEntries(others.map((id) => [id, known.includes(id) ? nameOf(at.world, at.state, id) : null]));
      const strangers = others.filter((id) => !known.includes(id) && hasOwn(at.state.entities, id)).map((id) => nameOf(at.world, at.state, id));
      return [p, { self: nameOf(at.world, at.state, p), present: named, absent: known.filter((id) => !here.includes(id)).map((id) => nameOf(at.world, at.state, id)), strangers, world }];
    }),
  );
}

/** The texts of `hashes` from the user's blobs; one that is missing is left out. */
async function textsOf(blobs: Pick<EngineRt["blobs"], "get">, userId: UserId, hashes: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const hash of new Set(hashes)) {
    const text = await blobs.get(userId, hash);
    if (text !== null) out[hash] = text;
  }
  return out;
}

/**
 * `who`'s mind at a state as its agent reads it: each file's path under its folder and its text. A
 * file that drew on a beat no longer read on the chain (`writtenFromGone`, with the story's
 * `replaced` ids) stays in the workspace but is left out until a catch-up rewrites it (`drewOn`).
 */
export async function readMind(blobs: Pick<EngineRt["blobs"], "get">, userId: UserId, state: Readonly<WorldState>, who: EntityId, replaced?: ReadonlySet<string>): Promise<MindFiles> {
  const out: Record<string, string> = {};
  const mind = mindV2At(state, who);
  for (const [rel, meta] of Object.entries(mind.files)) {
    if (writtenFromGone(meta, mind, replaced)) continue;
    const text = await blobs.get(userId, meta.hash);
    if (text !== null) out[rel] = text;
  }
  return out;
}

/**
 * What of `who`'s mind a catch-up rewrites after an amendment or a strike (§4.2, Retcons propagate):
 * the files whose latest write drew on any of `gone` the fold no longer reads (`drewOn`; a beat whose
 * amendment hasn't landed yet stays lived), with their texts, and those beats as they had reached it
 * (`was`). Null when no such file has a text.
 */
export async function rewriteFor(blobs: Pick<EngineRt["blobs"], "get">, userId: UserId, at: { state: Readonly<WorldState>; story: Pick<StoryRead, "replaced"> }, who: EntityId, gone: readonly string[], was: readonly LivedPov[]): Promise<MindRewrite | null> {
  const mind = mindV2At(at.state, who);
  const replaced = new Set(at.story.replaced.map((r) => r.id));
  const ids = [...new Set(gone)].filter((b) => replaced.has(b) || hasOwn(mind.superseded, b));
  const files: Record<string, string> = {};
  for (const rel of drewOn(mind, new Set(ids))) {
    const text = await blobs.get(userId, mind.files[rel]?.hash ?? "");
    if (text !== null && text.trim() !== "") files[rel] = text;
  }
  return Object.keys(files).length > 0 ? { gone: ids, was: was.filter((p) => ids.includes(p.beat)), files } : null;
}

/**
 * What every mode is given of the chat: whom it may name (people it has met and can see), and how to
 * read a time, a place or an amount it writes. Pass the fold's `story` so a retcon's superseded
 * writes stay out. Queue-free: it reads only the fold it is given and the user's blobs, so a turn's
 * play may build it from its own working state.
 */
export async function mindInput(rt: Pick<EngineRt, "registry"> & { readonly blobs: Pick<EngineRt["blobs"], "get"> }, userId: UserId, at: Pick<AtBasis, "state" | "world"> & { story?: Pick<StoryRead, "replaced"> }, who: EntityId, settings: Pick<UserSettings, "prompts">): Promise<MindInput> {
  const { state, world } = at;
  const cal = calendarOf(world);
  const known: Record<EntityId, string> = {};
  for (const id of peopleOf(rt, world, state)) if (id !== who && playerKnows(rt.registry, world, state, who, id)) known[id] = nameOf(world, state, id);
  const replaced = at.story ? new Set(at.story.replaced.map((r) => r.id)) : undefined;
  return {
    who,
    name: nameOf(world, state, who),
    at: state.clock,
    mind: await readMind(rt.blobs, userId, state, who, replaced),
    meta: mindMetaAt(state, who),
    known,
    timeOf: (text) => clockOfStamp(cal, text),
    placeOf: (text) => placeNamed(world, text),
    moneyOf: (text) => parseMoneyInput(text, world.currency),
    texts: settings.prompts.texts,
  };
}

/** Puts a stage's blobs and its reasoning, then lands its events as one layer entry at `basis`; a refusal is the user's to read. Every Character Engine job lands through it. With `wait`, one a turn in flight holds answers once it has landed or been refused (`landLayers`). */
export async function land(rt: Pick<EngineRt, "blobs" | "ledger">, chatId: ChatId, userId: UserId, basis: Basis, kind: string, out: Pick<StageOut, "events" | "blobs" | "reasoning">, id: string, role: string, o: { wait?: boolean } = {}): Promise<LandResult> {
  for (const text of Object.values(out.blobs)) await rt.blobs.put(userId, text);
  const reasoning = out.reasoning ? await rt.blobs.put(userId, out.reasoning) : undefined;
  const r = await rt.ledger.landLayer(chatId, userId, { id, basis, kind, events: out.events, ...(reasoning !== undefined ? { reasoning } : {}), by: { role } }, o);
  if (r.status === "refused") throw new MindRefused("refused", `LumiRPEngine couldn't keep this: ${r.reason}`);
  return r;
}

/** The model port for a user's Character Engine calls: each role on the connection Settings → Depth gives it. */
export function portFor(rt: Pick<EngineRt, "host" | "settings">, userId: UserId): ModelPort {
  return depthPort(rt.host, (u) => rt.settings.get(u), userId);
}

/** A beat as the views name it: its truth's first line (nothing is hidden from the player) and the message it came from, by the number the chat shows it with (`numbers`, `chatNumbers`). */
function beatRef(placed: PlacedBeat | undefined, id: string, texts: Readonly<Record<string, string>>, numbers: ReadonlyMap<MessageId, number>): DepthBeatRef {
  if (!placed) return { id, label: id };
  const what = texts[placed.beat.what]?.trim().split("\n")[0] ?? "";
  const label = what === "" ? id : what.length > 120 ? `${what.slice(0, 117)}…` : what;
  const index = numbers.get(placed.from.messageId);
  return { id, label, messageId: placed.from.messageId, ...(index !== undefined ? { index } : {}) };
}

// ------------------------------------------------------------------ the views

/** GM → Minds (A1e's view): every character with a mind or a point of view waiting, the effort each played its latest scene at, and whose point of view the player drives (D-10). */
export async function mindsView(rt: EngineRt, chatId: ChatId, userId: UserId): Promise<DepthMindsView> {
  const basis = await rt.ledger.basisFor(chatId, userId);
  const at = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis) : null;
  if (!basis || !at) return { on: false, pov: null, characters: [] };
  const { state, world, story } = at;
  const cal = calendarOf(world);
  const pov = povOf(world, state);
  const { beats } = exposedBeats(story);
  const people = peopleOf(rt, world, state);
  // The effort each played its latest scene at: the last scene on the chain whose cast holds them.
  const efforts = new Map<EntityId, DepthEffort>();
  for (const e of await rt.ledger.readEvents(chatId, userId, [STORY_SCENE])) for (const c of sceneOf("data" in e.event ? e.event.data : null)?.cast ?? []) efforts.set(c.who, c.effort);
  const exposed = new Set(beats.flatMap((b) => b.exposure.map((x) => x.who)));
  const ids = [...new Set([...mindedAt(state), ...exposed])].filter((id) => id !== pov && people.includes(id));
  const characters: DepthMindRow[] = ids.map((id) => {
    const meta = mindMetaAt(state, id);
    const latest = Object.entries(meta).sort(([, a], [, b]) => b.at - a.at)[0];
    return {
      id,
      name: nameOf(world, state, id),
      files: Object.keys(meta).length,
      last: latest ? { path: latest[0], at: formatClock(cal, latest[1].at) } : null,
      pending: pendingFor(beats, mindV2At(state, id), id).length,
      effort: efforts.get(id) ?? null,
      review: meta["core.md"]?.review === true,
    };
  });
  return {
    on: characters.length > 0 || beats.length > 0,
    pov: people.includes(pov) ? { id: pov, name: nameOf(world, state, pov) } : null,
    characters: characters.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** GM → Minds → one character (A1e's view): its files, every write newest first, its takes not yet remembered (its working memory, in play order), the points of view it received or still waits on, the effort it played at, scene by scene, and every interview on the chain, newest first. Beliefs beside the truth are the GM's links (A1c). */
export async function mindView(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId): Promise<DepthMindView> {
  const at = await foldAt(rt, chatId, userId);
  const { state, world, story } = at;
  const cal = calendarOf(world);
  const meta = mindMetaAt(state, who);
  const mind = mindV2At(state, who);
  const reaching = story.beats.filter((p) => p.beat.exposure.some((x) => x.who === who));
  const byId = new Map(story.beats.map((p) => [p.beat.id, p]));
  const numbers = await chatNumbers(rt.host, chatId, userId);
  const writes = (await rt.ledger.readEvents(chatId, userId, [MIND_WRITE])).map((e) => ({ data: mindWriteEvent(e.event), reasoning: e.reasoning })).filter((w) => w.data?.who === who).map((w) => ({ ...w, reasoning: w.reasoning ?? w.data?.reasoning }));
  const takes = takesOf(state, who);
  const interviews = (await rt.ledger.readEvents(chatId, userId, [MIND_INTERVIEW])).flatMap((e) => {
    const d = "data" in e.event ? mindInterviewOf(e.event.data) : null;
    return d && typeof d !== "string" && d.who === who ? [d] : [];
  });
  // Each scene it was in, at the effort the author gave it there (a scene over several turns: a row each time its effort changed), with the author's reason.
  const efforts: DepthMindView["efforts"] = [];
  const sceneEffort = new Map<string, DepthEffort>();
  for (const e of await rt.ledger.readEvents(chatId, userId, [STORY_SCENE])) {
    const s = sceneOf("data" in e.event ? e.event.data : null);
    const c = s?.cast.find((x) => x.who === who);
    if (!s || !c || sceneEffort.get(s.scene) === c.effort) continue;
    sceneEffort.set(s.scene, c.effort);
    efforts.push({ scene: own(world.places, s.place)?.name ?? s.place, at: formatClock(cal, s.at), effort: c.effort, why: c.why });
  }
  const hashes = [
    ...Object.values(meta).map((m) => m.hash),
    ...reaching.flatMap((p) => [p.beat.surface, p.beat.what, ...(p.beat.deed !== undefined ? [p.beat.deed] : []), ...(p.beat.quotes !== undefined ? [p.beat.quotes] : []), ...p.beat.exposure.filter((x) => x.who === who && x.pov).map((x) => x.pov as string)]),
    ...writes.flatMap((w) => [w.data?.hash, w.reasoning].filter((h): h is string => typeof h === "string")),
    ...writes.flatMap((w) => (w.data?.lived ?? []).map((id) => byId.get(id)?.beat.what).filter((h): h is string => typeof h === "string")),
    ...takes.flatMap((t) => [t.hash, ...[...t.lived, ...(t.beat !== undefined ? [t.beat] : [])].map((id) => byId.get(id)?.beat.what).filter((h): h is string => typeof h === "string")]),
    ...interviews.flatMap((d) => [d.question, d.answer]),
  ];
  const texts = await textsOf(rt.blobs, userId, hashes);
  const { replaced } = exposedBeats(story);
  const files: DepthMindFile[] = Object.entries(meta)
    .map(([rel, m]) => ({ path: rel, text: texts[m.hash] ?? "", pinned: pinnedBy(m, rel), revisions: m.rev, at: formatClock(cal, m.at), ...(writtenFromGone(m, mind, replaced) ? { out: true as const, ...(m.mode === "reflect" ? { reflection: true as const } : {}) } : {}), ...(m.review ? { review: true as const } : {}) }))
    .sort((a, b) => mindFileOrder(a.path) - mindFileOrder(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const previous = new Map<string, string>();
  const written: DepthMindWrite[] = [];
  for (const [i, w] of writes.entries()) {
    const d = w.data;
    if (!d) continue;
    const rel = mindFileOf(d.path)?.rel ?? d.path;
    written.push({
      id: `${i}:${rel}`,
      path: rel,
      at: formatClock(cal, d.at),
      mode: d.mode,
      reasoning: w.reasoning ? (texts[w.reasoning] ?? "") : "",
      text: texts[d.hash] ?? "",
      before: previous.get(rel) ?? null,
      lived: d.lived.map((id) => beatRef(byId.get(id), id, texts, numbers)),
      ...(d.lived.length > 0 && d.lived.every((id) => hasOwn(mind.superseded, id) || !byId.has(id)) ? { superseded: true } : {}),
    });
    previous.set(rel, texts[d.hash] ?? "");
  }
  // What each reach gives the mind as it lives it (`reachOf`; its own act with a deed whole): nothing yet where only a point of view still to be written would.
  const povs: DepthPov[] = reaching.map((p) => {
    const reach = reachOf(p.beat, who);
    const whole = reach?.whole ?? p.beat.exposure.find((x) => x.who === who)?.reach === "whole";
    return { beat: beatRef(p, p.beat.id, texts, numbers), at: formatClock(cal, p.beat.at), reach: whole ? "whole" : "part", text: reach ? (texts[reach.text] ?? "") : "", pending: !hasOwn(mind.lived, p.beat.id) };
  });
  const working: DepthMindTake[] = takes.map((t) => ({ at: formatClock(cal, t.at), text: texts[t.hash] ?? "", beat: t.beat !== undefined ? beatRef(byId.get(t.beat), t.beat, texts, numbers) : null, lived: t.lived.map((id) => beatRef(byId.get(id), id, texts, numbers)) }));
  const probes: DepthProbe[] = interviews.map((d) => ({ at: formatClock(cal, d.at), by: d.by, question: texts[d.question] ?? "", answer: texts[d.answer] ?? "", neutral: d.neutral }));
  return { id: who, name: nameOf(world, state, who), files, writes: written.reverse(), takes: working, beliefs: [], povs: povs.reverse(), efforts: efforts.reverse(), interviews: probes.reverse() };
}

// ------------------------------------------------------------------ the player's hand

/** The chip whose Undo takes back the player's edit of a mind file (`mind_edit:<entry>`, its layer entry's id), as `lre.chip` reads it. */
export const MIND_EDIT_CHIP = "mind_edit";
/** The kind of the entry an Undo lands: it holds no event and supersedes the edit's. */
export const MIND_UNDO = "minds.v2.undo";

export function mindEditChip(entry: string): string {
  return `${MIND_EDIT_CHIP}:${entry}`;
}

/** The player's own edit of a mind file that stands on the chain: its entry, whose mind and which file, the message it folds after, and whether its Undo supersedes it in place (it was made at the chat's head, as every in-place Undo covers the latest reply, DESIGN §12; past it, `mindEditUndo` lands a restoring edit instead). */
export interface PlayerMindEdit {
  entry: FoldLayerEntry;
  who: EntityId;
  path: string;
  messageId: MessageId;
  undoable: boolean;
  /** Its Undo past the head has landed: the restoring edit (`mindRestoreId`) stands, so it has no Undo left. */
  restored: boolean;
}

/** The id of the GM edit an Undo past the head lands to restore the file as it was before `entry` (whose own id names its chat): one per edit, so a second press finds it there. */
function mindRestoreId(entry: string): string {
  return layerEntryId("mind_restore", entry);
}

/** Every edit of the player's of a mind file standing on the chain, in fold order: the live layer entries holding a `minds.v2.write` in his mode; one an Undo superseded is gone. Read on the chat's queue. */
export function playerMindEdits(core: LedgerCore, observed: readonly ChainMessage[]): PlayerMindEdit[] {
  const chain = core.chain(observed);
  const head = headBasisOf(core, observed);
  const live = liveLayer(chain, core.journal.tombstones, core.layerEntries());
  const out: PlayerMindEdit[] = [];
  const standing = new Set([...live.at.values()].flatMap((entries) => entries.map((e) => e.id)));
  for (const m of chain) {
    for (const entry of live.at.get(m.id) ?? []) {
      const write = entry.events.map((e) => mindWriteEvent(e)).find((w) => w?.mode === "user");
      if (write) out.push({ entry, who: write.who, path: write.path, messageId: m.id, undoable: head !== null && entry.basis.message === head.message && entry.basis.swipe === head.swipe, restored: standing.has(mindRestoreId(entry.id)) });
    }
  }
  return out;
}

/**
 * The player's own edit of a mind file (§4.4: a directive). It lands at the head, pins the file
 * (its agent may remark on it, never rewrite it; `now.md` aside, which is live state) and is shown
 * in Minds as the user's, and in GM → This chat's edits with its Undo (`mindEditChip`) once it has
 * landed; one made while a reply is written has none until then. Its id counts the Undos landed at
 * its basis, so the same edit made again after one is a new entry, not the one undone. `path` is
 * under the mind's folder ("beliefs.md") or whole.
 */
export async function mindEdit(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, path: string, text: string): Promise<{ undo: string | null; pending?: boolean }> {
  const r = await landMindEdit(rt, chatId, userId, who, path, text);
  return r.status === "held" ? { undo: null, pending: true } : { undo: r.status === "landed" ? mindEditChip(r.entry.id) : null };
}

/** The player's edit of a mind file landed at the head (`mindEdit`'s, and an Undo's past the head): what the ledger answered. */
async function landMindEdit(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, path: string, text: string, id?: string): Promise<LandResult> {
  const at = await foldAt(rt, chatId, userId);
  personOf(rt, at.world, at.state, who);
  const full = path.startsWith(MINDS_DIR) ? path : `${mindDir(who)}${path}`;
  const file = mindFileOf(full);
  if (!file || !full.startsWith(mindDir(who))) throw new MindRefused("bad_path", `${path} isn't one of ${nameOf(at.world, at.state, who)}'s mind files: core.md, self.md, now.md, on-my-mind.md, beliefs.md, plans.md, memories/<name>.md or people/<id>.md.`);
  let undos = 0;
  await rt.ledger.with(chatId, userId, (core) => {
    undos = core.layerEntries().filter((e) => e.kind === MIND_UNDO && e.basis.message === at.basis.message && e.basis.swipe === at.basis.swipe).length;
  });
  const w = mindFileWrite({ who, path: full, at: at.state.clock, mode: "user", lived: [], about: [] }, text);
  return land(rt, chatId, userId, at.basis, MIND_WRITE, w, id ?? layerEntryId("mind_edit", chatId, who, file.rel, blobHash(text), at.basis.message, at.basis.swipe, String(undos)), "user");
}

/**
 * Undo of the player's edit of a mind file (§7: every edit lands as a GM edit with Undo). While the
 * edit stands at the chat's head, an entry holding nothing that supersedes the edit's lands at the
 * edit's own basis, so wherever the edit folds it no longer does, and the file reads (and is pinned
 * or not) as it was before it; a second Undo finds it gone. Once the chat has moved on past it, a
 * new GM edit lands at the head instead, restoring the file's text as it was just before the edit
 * (the fold at its basis without it; empty for a file it made), which supersedes it as the file's
 * latest write and reaches the author as a directive as any edit of his does.
 */
export async function mindEditUndo(rt: EngineRt, chatId: ChatId, userId: UserId, entry: string): Promise<LandResult> {
  let edit: PlayerMindEdit | undefined;
  await rt.ledger.with(chatId, userId, (core, observed) => {
    edit = playerMindEdits(core, observed).find((e) => e.entry.id === entry);
  });
  if (!edit) throw new MindRefused("moved", "That edit no longer stands on this chat's chain.");
  if (!edit.undoable) {
    if (edit.restored) throw new MindRefused("moved", "That edit is already undone: the edit restoring the file as it was before it stands.");
    const before = await rt.ledger.foldAtBasis(chatId, userId, edit.entry.basis, [], new Set([entry]));
    const rel = mindFileOf(edit.path)?.rel ?? "";
    const files = before ? mindV2At(before.state, edit.who).files : undefined;
    const was = files && hasOwn(files, rel) ? files[rel]?.hash : undefined;
    const r = await landMindEdit(rt, chatId, userId, edit.who, edit.path, was ? ((await rt.blobs.get(userId, was)) ?? "") : "", mindRestoreId(entry));
    if (r.status === "refused") throw new MindRefused("refused", `LumiRPEngine couldn't undo it: ${r.reason}`);
    return r;
  }
  const r = await rt.ledger.landLayer(chatId, userId, { id: layerEntryId(MIND_UNDO, chatId, entry), basis: edit.entry.basis, kind: MIND_UNDO, events: [], supersedes: [entry], by: { role: "user" } });
  if (r.status === "refused") throw new MindRefused("refused", `LumiRPEngine couldn't undo it: ${r.reason}`);
  return r;
}

/**
 * Play as (D-10) isn't supported yet: the player plays one player character, and no request switches
 * him. A chat switched before keeps playing the one it plays now (`povOf`): its `minds.v2.pov` entries
 * still fold, and an imported history's switches still land (the bootstrap).
 */
export const PLAY_AS_OFF = "Play as isn't supported yet: you play one player character, the one this chat plays now.";

/**
 * An interview (§4.4): asked by the player from GM → Minds, or by the author from its poll; the
 * character answers in voice. The question and the answer are kept apart from its mind as a probe;
 * when marked neutral to the world (asked in its world's terms, revealing nothing it hasn't lived),
 * what answering changed in its story of itself folds into the mind.
 */
export async function interviewMind(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, question: string, neutral: boolean, model?: ModelPort, o: { by?: InterviewAsker; basis?: Basis; signal?: AbortSignal } = {}): Promise<DepthInterview> {
  const at = await foldAt(rt, chatId, userId, o.basis);
  personOf(rt, at.world, at.state, who);
  if (!hasAgent(at.world, at.state, who)) throw new MindRefused("player_character", `${nameOf(at.world, at.state, who)} is the player character: the player drives him, and he has no agent to interview.`);
  if (question.trim() === "") throw new MindRefused("bad_path", "An interview needs a question.");
  const settings = await rt.settings.get(userId);
  const r = await interview(model ?? portFor(rt, userId), { ...(await mindInput(rt, userId, at, who, settings)), question, by: o.by ?? "player", neutral, ...(o.signal ? { signal: o.signal } : {}) });
  await land(rt, chatId, userId, at.basis, MIND_INTERVIEW, r.out, layerEntryId("interview", chatId, who, blobHash(question), at.basis.message, at.basis.swipe, o.by === "author" || o.by === "gm" ? o.by : String(Date.now())), "character");
  return { answer: r.answer, folded: r.folded };
}

// ------------------------------------------------------------------ jobs between turns

/** What reached `who` of `beats` (those waiting to be lived, or a scene's), as its agent reads it (`reachOf`: its own acts as its own, a message as its words), in the order given; a reach whose text the blobs lack is left out. */
export async function livedPovs(blobs: Pick<EngineRt["blobs"], "get">, userId: UserId, world: WorldDoc, beats: readonly ExposedBeat[], who: EntityId): Promise<LivedPov[]> {
  const cal = calendarOf(world);
  const reaches = beats.map((b) => reachOf(b, who)).filter((r): r is Reach => r !== null);
  const texts = await textsOf(blobs, userId, reaches.flatMap((r) => [r.text, ...(r.whole && r.quotes ? [r.quotes] : [])]));
  return reaches
    .filter((r) => hasOwn(texts, r.text))
    .map((r) => ({
      beat: r.beat,
      at: r.at,
      when: formatClock(cal, r.at),
      ...(r.place !== undefined && hasOwn(world.places, r.place) ? { where: world.places[r.place]?.name ?? r.place } : {}),
      channel: r.channel,
      whole: r.whole,
      ...(r.as !== "sensed" ? { as: r.as } : {}),
      ...(r.from !== undefined ? { from: r.from } : {}),
      text: texts[r.text] ?? "",
      ...(r.whole && r.quotes && hasOwn(texts, r.quotes) ? { quotes: texts[r.quotes] } : {}),
    }));
}

/**
 * Catch up now (§4.4): `who`'s agent lives what reached it and it hasn't lived, in story order, a
 * batch per call (Settings → Depth's `catchUpBatch`: a bound on a call's size, never a choice of what to live), each landing as its own entry at `basis` (the head by default),
 * so a stop between batches loses nothing and a rerun of a landed batch at the same basis lands
 * nothing twice; at another basis (the reply it landed at was swiped, taking it away) it lands there
 * afresh. `lived` and `rewritten` count what this call landed: an entry held for the turn in flight,
 * or one already there, counts nothing.
 * No catch-up reads past an open draft (DEPTH-PLAN §4.6): from the story minute an open draft holds
 * `who` (its people, those it would have told by then), what reached them waits until the draft
 * settles or is dropped (`held`: the drafts that held it back).
 * `gone`: beats an amendment or a strike just replaced (§4.2, Retcons propagate). Every file of its
 * mind whose latest write drew on one of them (`rewriteFor`) rides the call that lives the last of
 * what waits (alone, when nothing does), once per call: its answer rewrites each at its own path or
 * keeps it as it was (the same text, no longer drawing on the replaced beat), and a file it gives no
 * verdict on, asked again, stays out of its mind and its recall (`out` in Minds). `rewritten`: the
 * files rewritten or kept.
 */
export async function catchUpNow(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, o: { basis?: Basis; model?: ModelPort; signal?: AbortSignal; gone?: readonly ExposedBeat[] } = {}): Promise<{ lived: number; rewritten: number; entries: LandResult[]; held: string[] }> {
  const entries: LandResult[] = [];
  let lived = 0;
  let rewritten = 0;
  const held = new Set<string>();
  const done = () => ({ lived, rewritten, entries, held: [...held] });
  let gone = o.gone && o.gone.length > 0 ? storyOrder(o.gone) : null;
  const settings = await rt.settings.get(userId);
  const model = o.model ?? portFor(rt, userId);
  // Someone with no mind yet (the story reached them from afar, and the poll asked) gets one first, as a scene would form it (`formCore`): their card, else what the world knows of them.
  const first = await foldAt(rt, chatId, userId, o.basis, DRAFT_TYPES);
  if (Object.keys(mindMetaAt(first.state, who)).length === 0 && hasAgent(first.world, first.state, who)) {
    const linked = own(first.world.entities, who)?.characterId;
    const fields = (own(first.state.entities, who) ?? own(first.world.entities, who))?.fields ?? {};
    const formed = await formCore({ who, name: nameOf(first.world, first.state, who), player: nameOf(first.world, first.state, povOf(first.world, first.state)), at: first.state.clock, fields, ...(typeof linked === "string" && linked !== "" ? { characterId: linked } : {}), host: rt.host, chatId, userId, texts: settings.prompts.texts });
    if (formed) entries.push(await land(rt, chatId, userId, first.basis, MIND_WRITE, formed, layerEntryId("mind-form", chatId, who, first.basis.message, first.basis.swipe), "character"));
  }
  for (;;) {
    const at = await foldAt(rt, chatId, userId, o.basis, DRAFT_TYPES);
    personOf(rt, at.world, at.state, who);
    if (!hasAgent(at.world, at.state, who)) throw new MindRefused("player_character", `${nameOf(at.world, at.state, who)} is the player character: the player drives him, and he has no agent to catch up.`);
    if (o.signal?.aborted) return done();
    const all = pendingFor(exposedBeats(at.story).beats, mindV2At(at.state, who), who);
    const holding = heldFrom(draftsOn(at.events ?? []), who);
    const waiting = holding ? all.filter((b) => b.at < holding.from) : all;
    if (holding && waiting.length < all.length) for (const d of holding.drafts) held.add(d.id);
    const pending = waiting.slice(0, Math.max(1, settings.depth.catchUpBatch));
    const batch = await livedPovs(rt.blobs, userId, at.world, pending, who);
    const rewrite = gone && waiting.length === pending.length ? await rewriteFor(rt.blobs, userId, at, who, gone.map((b) => b.id), await livedPovs(rt.blobs, userId, at.world, gone, who)) : null;
    if (batch.length === 0 && !rewrite) return done();
    if (rewrite) gone = null;
    const out = await catchUp(model, { ...(await mindInput(rt, userId, at, who, settings)), lived: batch, ...(rewrite ? { rewrite } : {}), ...(o.signal ? { signal: o.signal } : {}) });
    // An answer that doesn't read gives nothing to land: its beats stay pending, and the user reads why.
    // One that read but left every file it was handed without a verdict, asked twice, has nothing to land.
    if (out.events.length === 0 && out.inert !== undefined) return done();
    if (out.events.length === 0) throw new MindRefused("refused", `${nameOf(at.world, at.state, who)}'s agent gave no answer LumiRPEngine could read, so nothing was kept; ${batch.length > 0 ? "what reached them still waits" : "what they wrote from what went otherwise stays out of their mind"}.`);
    const r = await land(rt, chatId, userId, at.basis, MIND_WRITE, out, layerEntryId("catch-up", chatId, who, at.basis.message, at.basis.swipe, batch[0]?.beat ?? "", batch.at(-1)?.beat ?? "", String(batch.length), ...(rewrite ? ["rewrite", ...rewrite.gone] : [])), "character");
    entries.push(r);
    if (r.status === "landed" && r.existing !== true) {
      lived += batch.length;
      if (rewrite) {
        const paths = new Set(Object.keys(rewrite.files).map((rel) => `${mindDir(who)}${rel}`));
        rewritten += out.events.filter((e) => paths.has(mindWriteEvent(e)?.path ?? "")).length;
      }
    }
    // A held entry lands once the turn in flight is done: what follows waits for the next call. One
    // already there under this id lived this batch before; if the fold still finds it pending (a
    // rebased view dropped it), calling again would only land it again, so this call ends.
    if (r.status === "held" || (r.status === "landed" && r.existing)) return done();
    if (batch.length === 0) return done();
  }
}

/** Reflect now (§4.4): `who`'s agent takes stock of what it lived since it last did, landing at `basis` (the head by default); once per basis. */
export async function reflectNow(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, o: { basis?: Basis; model?: ModelPort; signal?: AbortSignal } = {}): Promise<LandResult | null> {
  const at = await foldAt(rt, chatId, userId, o.basis);
  personOf(rt, at.world, at.state, who);
  if (!hasAgent(at.world, at.state, who)) throw new MindRefused("player_character", `${nameOf(at.world, at.state, who)} is the player character: the player drives him, and he has no agent to reflect.`);
  const settings = await rt.settings.get(userId);
  const out = await reflect(o.model ?? portFor(rt, userId), { ...(await mindInput(rt, userId, at, who, settings)), ...(o.signal ? { signal: o.signal } : {}) });
  if (out.events.length === 0) return null;
  return land(rt, chatId, userId, at.basis, MIND_WRITE, out, layerEntryId("reflect", chatId, who, at.basis.message, at.basis.swipe), "character");
}

/**
 * A character's recall (§4.3, §4.4): a cue it writes in its own voice ("what did he say on the
 * pier?"), answered by a lexical search over its own mind and the beats it lived, as they reached
 * it (exact words only where they reached it whole), at `basis` (the head by default). Never the
 * archive at large, another mind, the truth of a beat, or a beat it hasn't lived yet.
 */
export async function recallFor(rt: EngineRt, chatId: ChatId, userId: UserId, who: EntityId, cue: string, o: { basis?: Basis; limit?: number } = {}): Promise<RecallHit[]> {
  const at = await foldAt(rt, chatId, userId, o.basis);
  personOf(rt, at.world, at.state, who);
  const mind = mindV2At(at.state, who);
  const { beats, replaced } = exposedBeats(at.story);
  const lived = beats.filter((b) => hasOwn(mind.lived, b.id));
  const reaches = lived.map((b) => reachOf(b, who)).filter((r): r is Reach => r !== null);
  const texts = await textsOf(rt.blobs, userId, [...Object.values(mind.files).map((m) => m.hash), ...reaches.flatMap((r) => [r.text, ...(r.whole && r.quotes ? [r.quotes] : [])])]);
  return recallSearch(livedCorpus({ who, mind, beats: lived, texts, replaced }), cue, o.limit);
}

/** Whether a mode is one of the character's own agent's (the player character has none). */
export function agentMode(mode: MindMode): boolean {
  return (AGENT_MODES as readonly string[]).includes(mode);
}

/** The Character Engine's layer kinds, for readers that list what landed. */
export const MIND_KINDS: readonly string[] = [MIND_WRITE, MIND_LIVED, MIND_INTERVIEW, MIND_POV];
