// The Character Engine's shared formats (DEPTH-PLAN §4.4): each character with a mind keeps it as
// files of the chat's workspace under `minds/<who>/`, written only by its own agent (and by the
// user's edits, as directives), each body a blob (`shared/stores.ts`). A file write is the
// workspace's own `engine.ws.write {path, hash}` followed by `minds.v2.write`, the bookkeeping beside
// it: who wrote it, when in story time, in which mode, the beats whose points of view it draws on
// (`lived`, which recall and retcons follow) and what it is about. `minds.v2.lived` records the batch
// of beats an agent lived in one call, whether or not it kept anything of each, so what is still
// pending for it is the exposures it hasn't lived. `minds.v2.pov` is the chat's switch of player
// character (D-10): the player character has no agent, and a mind is never written for him by one
// while the player plays him. `minds.v2.interview` keeps an interview's question and answer apart
// from the mind: it is a probe, and only one the author or the GM marked neutral to the world has a
// write beside it that folds into the mind. `minds.v2.take` is a play's private take (A2): what the
// character noticed, made of the moment and how it landed, kept as its working memory of the scene
// until it remembers the scene, which takes them up. A write's plans that read a time reach the Cast
// life planner as plans of its own (`agentPlan`), through the minds pack's plans (`minds.plans`).
//
// Recall (§4.3, §4.4) is the character's own: its mind's files and the points of view it lived (its
// own act as its own, a message it received as the message's words, the surface itself where it
// sensed a beat whole, its own point of view where it was partial, exact quotes only where they
// reached it whole). `livedCorpus` builds that corpus, and `recallSearch` answers a
// cue the character writes in its own voice with a lexical search over it: bookkeeping, never a
// judgment of what matters, and never the archive at large. Pure.

import type { DepthWriteMode } from "./depth-views";
import type { EntityId, PlaceId } from "./ids";
import { hashParts } from "./hash";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "./json";
import type { PackEvent } from "./ledger";
import { PLAN_KINDS, PLAN_PRIORITY, sharedPlanId, sharesPlan, type MindPlan, type PlanKind } from "./minds";
import type { Beat, StoryRead } from "./story";
import { blobHash, isBlobHash, isWorkspacePath } from "./stores";

/** The workspace folder every mind lives under. */
export const MINDS_DIR = "minds/";

/** A mind's single files, by kind, as named under its folder (a stored name: never changes once shipped). */
export const MIND_FILE_NAMES = {
  /** Who they are at root: traits, values, history, voice. Seeded from the card, an imported entry or the history; never rewritten by the agent. */
  core: "core.md",
  /** Their story of themselves: who they are becoming, what they want and fear. Reflection rewrites it. */
  self: "self.md",
  /** Live state: mood, what's on their mind this minute, what they're doing and watching. */
  now: "now.md",
  /** What they keep in mind: the memories, beliefs, people and plans that matter now. Loaded whole on every call. */
  mind: "on-my-mind.md",
  /** What they hold true, how sure in their words, and why. */
  beliefs: "beliefs.md",
  /** What they mean to do: what, when, where, with whom; promises made and taken. */
  plans: "plans.md",
} as const;

export type MindSingleKind = keyof typeof MIND_FILE_NAMES;

/** One file per stretch they lived (a scene, a letter read, a night), in their own words. */
export const MEMORIES_DIR = "memories/";
/** One file per person they know: what they make of them, and what they think that person knows, wants and feels. */
export const PEOPLE_DIR = "people/";

/** A mind file's kind: one of the single files, a memory, or a person. */
export type MindFileKind = MindSingleKind | "memory" | "person";

/** The order a mind's single files are read in: core first, then the stable prefix of self and on my mind (§4.4, how it stays itself). */
export const MIND_READ_ORDER: readonly MindSingleKind[] = ["core", "self", "mind", "now", "beliefs", "plans"];

/**
 * How a write came about: `seed` (core seeded from the card, an imported entry or the history),
 * `user` (the user's own edit, a directive), or one of the agent's modes: `play` (A2), `remember`,
 * `catch-up`, `reflect`, `interview` (an answer the author or the GM marked neutral to the world).
 * The views' own words for them (`shared/depth-views.ts` `DepthWriteMode`), so one set of ids is stored.
 */
export type MindMode = DepthWriteMode;
export const MIND_MODES: readonly MindMode[] = ["seed", "user", "play", "remember", "catch-up", "reflect", "interview"];
/** The modes in which the character's own agent writes: never for the player character (D-10). */
export const AGENT_MODES: readonly MindMode[] = ["play", "remember", "catch-up", "reflect", "interview"];

/** Whether a mind file is pinned by the user's own edit (a directive): its agent may remark on it, never rewrite it. `now.md` is live state, which the next play moves on from, so an edit of it pins nothing. */
export function pinnedBy(meta: Pick<MindFileMeta, "mode"> | undefined, rel: string): boolean {
  return meta?.mode === "user" && rel !== MIND_FILE_NAMES.now;
}

/** Where a seeded core came from (D-17): the character's card, the world's own description of them (its entity and lore), an imported entry, or the author's reading of the history. */
export type CoreSource = "card" | "world" | "entry" | "history";
export const CORE_SOURCES: readonly CoreSource[] = ["card", "world", "entry", "history"];

/**
 * A plan a write states, so the Cast life planner can lay it (§4.4, Plans reach the world): `when` a
 * story minute, or the character's words when no time was read; `until` when it ends; its kind (an
 * errand, a meeting, a payment); and, for a payment or a loan, what it hands over in minor units.
 */
export interface MindPlanRef {
  what: string;
  when?: number | string;
  until?: number;
  kind?: PlanKind;
  where?: PlaceId;
  with?: EntityId[];
  cents?: number;
}

/** `minds.v2.write`: the bookkeeping beside one mind file write (§4.4 `MindWrite`). */
export interface MindWriteData {
  who: EntityId;
  /** The file's workspace path, under `minds/<who>/`. */
  path: string;
  /** The body the `engine.ws.write` before it gave the file. */
  hash: string;
  /** The story minute it was written in. */
  at: number;
  mode: MindMode;
  /** The beats whose points of view it draws on, by id: recall and retcons follow these. */
  lived: string[];
  /** The people, places, things and facts it is about, by id. */
  about: string[];
  plans?: MindPlanRef[];
  /** An amended beat's catch-up replaces what was written from the old beat, by its id (§4.2, Retcons propagate). */
  supersedes?: string;
  /** A seeded core's source (D-17). */
  source?: CoreSource;
  /** A core seeded from anything but the card or the world alone (an imported entry, the history): marked for the user's review. */
  review?: true;
}

/** `minds.v2.lived`: the beats one call of the character's agent lived, in story order, whatever it kept of each. */
export interface MindLivedData {
  who: EntityId;
  beats: string[];
  at: number;
  mode: MindMode;
}

/** Who asks an interview's question (§4.4, Interview). */
export type InterviewAsker = "author" | "gm" | "player";
export const INTERVIEW_ASKERS: readonly InterviewAsker[] = ["author", "gm", "player"];

/** `minds.v2.interview`: an interview's question and answer, as blobs, kept apart from the mind. */
export interface MindInterviewData {
  who: EntityId;
  at: number;
  by: InterviewAsker;
  question: string;
  answer: string;
  /** The author or the GM marked it neutral to the world: the answer folded into the mind, by a write beside it. */
  neutral: boolean;
}

/** `minds.v2.pov`: from here on in this chat, the player plays `who` (D-10). */
export interface MindPovData {
  who: EntityId;
}

/**
 * `minds.v2.take`: one play's private take (§4.4, Play): what the character noticed, what it made of
 * the moment and how it landed (`take`, a blob), the beats it lived in that play (`lived`: what had
 * just reached it) and, when it acted, the beat its act became (`beat`). It is the character's own,
 * never in a beat; the fold keeps it as its working memory of the scene until it remembers the scene.
 */
export interface MindTakeData {
  who: EntityId;
  at: number;
  lived: string[];
  beat?: string;
  take: string;
}

export const MIND_WRITE = "minds.v2.write";
export const MIND_LIVED = "minds.v2.lived";
export const MIND_INTERVIEW = "minds.v2.interview";
export const MIND_POV = "minds.v2.pov";
export const MIND_TAKE = "minds.v2.take";

/** The takes a mind holds unremembered that call for its remembering: once a character holds this many, the step after a reply remembers them, a talk still on or not (`afterDepthReply`). A count that calls a remember, never a cut: no take is let go unremembered. */
export const TAKES_KEPT = 400;

/** The interviews a character's probes keep, newest last; older ones still stand in the ledger. */
export const PROBES_KEPT = 50;

// ------------------------------------------------------------------ paths

/** A name an id may stand as in a path: what a workspace path allows, anything else a `-`. */
export function pathName(id: string): string {
  const name = id.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return name === "" || name === "." || name === ".." ? "_" : name;
}

/** The folder of `who`'s mind: `minds/<who>/`. */
export function mindDir(who: EntityId): string {
  return `${MINDS_DIR}${pathName(who)}/`;
}

/** A single file of `who`'s mind: `minds/<who>/beliefs.md`. */
export function mindPath(who: EntityId, kind: MindSingleKind): string {
  return `${mindDir(who)}${MIND_FILE_NAMES[kind]}`;
}

/** One of `who`'s memories: `minds/<who>/memories/<name>.md`. */
export function memoryPath(who: EntityId, name: string): string {
  return `${mindDir(who)}${MEMORIES_DIR}${pathName(name)}.md`;
}

/** `who`'s file on `other`: `minds/<who>/people/<other>.md`. */
export function personPath(who: EntityId, other: EntityId): string {
  return `${mindDir(who)}${PEOPLE_DIR}${pathName(other)}.md`;
}

/** A path under a mind's folder, read: its owner's folder name, its path under the folder, its kind and, for a memory or a person, its name. Null for any other path. */
export function mindFileOf(path: string): { dir: string; rel: string; kind: MindFileKind; name?: string } | null {
  if (!path.startsWith(MINDS_DIR) || !isWorkspacePath(path)) return null;
  const rest = path.slice(MINDS_DIR.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const dir = rest.slice(0, slash);
  const rel = rest.slice(slash + 1);
  for (const [kind, name] of Object.entries(MIND_FILE_NAMES)) if (rel === name) return { dir, rel, kind: kind as MindSingleKind };
  const nested = (prefix: string, kind: "memory" | "person") => {
    if (!rel.startsWith(prefix) || !rel.endsWith(".md")) return null;
    const name = rel.slice(prefix.length, -3);
    return name !== "" && !name.includes("/") ? { dir, rel, kind, name } : null;
  };
  return nested(MEMORIES_DIR, "memory") ?? nested(PEOPLE_DIR, "person");
}

/**
 * A memory's name, unique in its mind and the same however often the same call is run: the story
 * minute it was written at, padded so a mind's memories list in story order, and its place among
 * the memories already there at that minute.
 */
export function memoryName(at: number, taken: ReadonlySet<string>): string {
  const stamp = String(Math.max(0, Math.trunc(at))).padStart(9, "0");
  for (let n = 1; ; n++) {
    const name = `${stamp}-${n}`;
    if (!taken.has(name)) return name;
  }
}

// ------------------------------------------------------------------ events

const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const minute = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A plan as an event holds it; null when it doesn't read. */
function planOf(raw: unknown): MindPlanRef | null {
  if (!isRecord(raw) || !str(raw.what)) return null;
  if (raw.when !== undefined && !minute(raw.when) && !str(raw.when)) return null;
  if (raw.until !== undefined && !minute(raw.until)) return null;
  if (raw.kind !== undefined && !(typeof raw.kind === "string" && (PLAN_KINDS as readonly string[]).includes(raw.kind))) return null;
  if (raw.where !== undefined && !str(raw.where)) return null;
  if (raw.with !== undefined && !strs(raw.with)) return null;
  if (raw.cents !== undefined && !(minute(raw.cents) && Number.isInteger(raw.cents) && raw.cents > 0)) return null;
  return {
    what: raw.what,
    ...(raw.when !== undefined ? { when: raw.when } : {}),
    ...(raw.until !== undefined ? { until: raw.until } : {}),
    ...(raw.kind !== undefined ? { kind: raw.kind as PlanKind } : {}),
    ...(raw.where !== undefined ? { where: raw.where } : {}),
    ...(raw.with !== undefined ? { with: [...raw.with] } : {}),
    ...(raw.cents !== undefined ? { cents: raw.cents } : {}),
  };
}

/** A `minds.v2.write`'s data as it reads, or why it doesn't: its file under its own mind's folder, a body, a minute, a mode, and lists of ids. */
export function mindWriteOf(data: JsonObject): MindWriteData | string {
  const { who, path, hash, at, mode, lived, about } = data;
  if (!str(who)) return "a mind write names whose mind it is";
  if (!str(path) || !path.startsWith(mindDir(who)) || mindFileOf(path) === null) return "a mind write's file is one of the mind's own files, under its folder";
  if (!isBlobHash(hash)) return "a mind write's body is a blob's hash";
  if (!minute(at)) return "a mind write says the story minute it was written in";
  if (!str(mode) || !(MIND_MODES as readonly string[]).includes(mode)) return `a mind write's mode is one of ${MIND_MODES.join(", ")}`;
  if (!strs(lived) || !strs(about)) return "a mind write's lived beats and what it is about are lists of ids";
  const plans: MindPlanRef[] = [];
  if (data.plans !== undefined) {
    if (!Array.isArray(data.plans)) return "a mind write's plans are a list";
    for (const raw of data.plans) {
      const plan = planOf(raw);
      if (!plan) return "a plan says what, and when and until, its kind, where, with whom and what it hands over only as a time or words, a minute, a plan kind, a place id, person ids and a whole positive amount";
      plans.push(plan);
    }
  }
  if (data.supersedes !== undefined && !str(data.supersedes)) return "what a mind write supersedes is a beat's id";
  if (data.source !== undefined && !(CORE_SOURCES as readonly unknown[]).includes(data.source)) return `a seeded core's source is one of ${CORE_SOURCES.join(", ")}`;
  if (data.review !== undefined && data.review !== true) return "review is true or absent";
  return {
    who,
    path,
    hash,
    at,
    mode: mode as MindMode,
    lived: [...lived],
    about: [...about],
    ...(data.plans !== undefined ? { plans } : {}),
    ...(data.supersedes !== undefined ? { supersedes: data.supersedes as string } : {}),
    ...(data.source !== undefined ? { source: data.source as CoreSource } : {}),
    ...(data.review === true ? { review: true as const } : {}),
  };
}

/** A `minds.v2.write` event, when `e` is a well-formed one. */
export function mindWriteEvent(e: { type: string; data?: unknown }): MindWriteData | null {
  if (e.type !== MIND_WRITE || !isRecord(e.data)) return null;
  const d = mindWriteOf(e.data as JsonObject);
  return typeof d === "string" ? null : d;
}

/** A `minds.v2.lived`'s data as it reads, or why it doesn't. */
export function mindLivedOf(data: JsonObject): MindLivedData | string {
  const { who, beats, at, mode } = data;
  if (!str(who)) return "a lived batch names whose it is";
  if (!strs(beats) || beats.length === 0) return "a lived batch lists the beats it lived, by id";
  if (!minute(at)) return "a lived batch says the story minute it was lived at";
  if (!str(mode) || !(AGENT_MODES as readonly string[]).includes(mode)) return `a lived batch's mode is one of ${AGENT_MODES.join(", ")}`;
  return { who, beats: [...beats], at, mode: mode as MindMode };
}

/** A `minds.v2.interview`'s data as it reads, or why it doesn't. */
export function mindInterviewOf(data: JsonObject): MindInterviewData | string {
  const { who, at, by, question, answer, neutral } = data;
  if (!str(who)) return "an interview names whom it asked";
  if (!minute(at)) return "an interview says the story minute it was asked at";
  if (!str(by) || !(INTERVIEW_ASKERS as readonly string[]).includes(by)) return `an interview is asked by one of ${INTERVIEW_ASKERS.join(", ")}`;
  if (!isBlobHash(question) || !isBlobHash(answer)) return "an interview's question and answer are blobs' hashes";
  if (typeof neutral !== "boolean") return "an interview says whether it was marked neutral to the world";
  return { who, at, by: by as InterviewAsker, question, answer, neutral };
}

/** A `minds.v2.take`'s data as it reads, or why it doesn't. */
export function mindTakeOf(data: JsonObject): MindTakeData | string {
  const { who, at, lived, beat, take } = data;
  if (!str(who)) return "a take names whose it is";
  if (!minute(at)) return "a take says the story minute it was had at";
  if (!strs(lived)) return "a take lists the beats it lived, by id";
  if (beat !== undefined && !str(beat)) return "the beat a take's act became is a beat's id";
  if (!isBlobHash(take)) return "a take's text is a blob's hash";
  return { who, at, lived: [...lived], ...(beat !== undefined ? { beat } : {}), take };
}

/** The events of one mind file write, in the order they fold (the file, then its bookkeeping), and the body's blob, which must be put before they land. */
export function mindFileWrite(meta: Omit<MindWriteData, "hash">, text: string): { events: PackEvent[]; blobs: Record<string, string> } {
  const hash = blobHash(text);
  const data: JsonObject = {
    who: meta.who,
    path: meta.path,
    hash,
    at: meta.at,
    mode: meta.mode,
    lived: [...meta.lived],
    about: [...meta.about],
    ...(meta.plans !== undefined ? { plans: meta.plans.map((p) => ({ ...p, ...(p.with ? { with: [...p.with] } : {}) }) as unknown as JsonObject) } : {}),
    ...(meta.supersedes !== undefined ? { supersedes: meta.supersedes } : {}),
    ...(meta.source !== undefined ? { source: meta.source } : {}),
    ...(meta.review ? { review: true } : {}),
  };
  return { events: [{ type: "engine.ws.write", data: { path: meta.path, hash } }, { type: MIND_WRITE, data }], blobs: { [hash]: text } };
}

/** A `minds.v2.lived` event. */
export function mindLivedEvent(data: MindLivedData): PackEvent {
  return { type: MIND_LIVED, data: { who: data.who, beats: [...data.beats], at: data.at, mode: data.mode } };
}

/** A `minds.v2.pov` event. */
export function mindPovEvent(who: EntityId): PackEvent {
  return { type: MIND_POV, data: { who } };
}

/** A `minds.v2.take` event and its blob: the take's text. */
export function mindTakeEvent(d: { who: EntityId; at: number; lived: readonly string[]; beat?: string; take: string }): { event: PackEvent; blobs: Record<string, string> } {
  const take = blobHash(d.take);
  return { event: { type: MIND_TAKE, data: { who: d.who, at: d.at, lived: [...d.lived], ...(d.beat !== undefined ? { beat: d.beat } : {}), take } }, blobs: { [take]: d.take } };
}

/** The blobs a Character Engine event names, for the blob sweep (`backend/agents/sweep.ts`): a write's body, an interview's question and answer, a take's text. Lenient: anything else names nothing. */
export function mindBlobs(type: unknown, data: unknown): string[] {
  if (!isRecord(data)) return [];
  if (type === MIND_WRITE) return isBlobHash(data.hash) ? [data.hash] : [];
  if (type === MIND_INTERVIEW) return [data.question, data.answer].filter(isBlobHash);
  if (type === MIND_TAKE) return isBlobHash(data.take) ? [data.take] : [];
  return [];
}

/** A `minds.v2.interview` event and its two blobs. */
export function mindInterviewEvent(d: { who: EntityId; at: number; by: InterviewAsker; question: string; answer: string; neutral: boolean }): { event: PackEvent; blobs: Record<string, string> } {
  const question = blobHash(d.question);
  const answer = blobHash(d.answer);
  return { event: { type: MIND_INTERVIEW, data: { who: d.who, at: d.at, by: d.by, question, answer, neutral: d.neutral } }, blobs: { [question]: d.question, [answer]: d.answer } };
}

// ------------------------------------------------------------------ plans that reach the world

/** How long a plan with a start and no end runs, as the memory step's plans do. */
const PLAN_MINUTES = 60;

/**
 * A plan a character's agent wrote (§4.4, Plans reach the world) as one the Cast life planner lays
 * and settles (`MindPlan`, source "agent"), or null when it can't be laid: no time was read, it is
 * wholly past at `at`, or a payment or a loan names no amount or no one. One with others in it but a
 * payment or a loan is theirs too (`sharesPlan`), under the id its people and start give it, so the
 * same plan written by everyone in it is one plan; its words stay its writer's (`by`). The same plan
 * restated keeps its id, so a rewrite of plans.md that states it again adds nothing. Pure.
 */
export function agentPlan(who: EntityId, at: number, ref: MindPlanRef): MindPlan | null {
  if (typeof ref.when !== "number" || !Number.isFinite(ref.when)) return null;
  const from = ref.when;
  const to = ref.until !== undefined && ref.until >= from ? ref.until : from + PLAN_MINUTES;
  if (to < at) return null;
  const kind: PlanKind = ref.kind ?? "other";
  const withIds = [...new Set((ref.with ?? []).filter((id) => id !== who))];
  const money = kind === "pay" || kind === "lend";
  if (money && (ref.cents === undefined || withIds.length === 0)) return null;
  const shared = sharesPlan({ kind, with: withIds });
  const id = shared ? sharedPlanId([who, ...withIds], from) : `p_${hashParts("minds.plan.agent", who, String(from), ref.what).slice(0, 10)}`;
  return {
    id,
    what: ref.what,
    kind,
    when: { from, to },
    where: ref.where ?? null,
    with: withIds,
    priority: PLAN_PRIORITY.normal,
    status: "open",
    made: at,
    source: "agent",
    closed: null,
    reason: null,
    ...(money && ref.cents !== undefined ? { cents: ref.cents } : {}),
    ...(shared ? { shared: true as const, by: who } : {}),
  };
}

// ------------------------------------------------------------------ the fold's slice

/** One mind file's latest bookkeeping, and how many times it has been written. */
export interface MindFileMeta {
  hash: string;
  at: number;
  mode: MindMode;
  lived: string[];
  about: string[];
  rev: number;
  plans?: MindPlanRef[];
  supersedes?: string;
  source?: CoreSource;
  review?: true;
}

/** A take the character hasn't remembered yet: its working memory of the scene (`minds.v2.take`). */
export interface MindTake {
  at: number;
  lived: string[];
  beat?: string;
  /** The take's text, a blob. */
  hash: string;
}

/** One character's mind as the fold keeps its bookkeeping: its files by path under its folder, the beats it has lived, the beats retcons superseded, and its takes not yet remembered, oldest first. */
export interface MindV2 {
  files: Record<string, MindFileMeta>;
  lived: Record<string, true>;
  superseded: Record<string, true>;
  writes: number;
  last: number | null;
  takes?: MindTake[];
}

/** An interview kept apart from the mind. */
export interface MindProbe {
  at: number;
  by: InterviewAsker;
  question: string;
  answer: string;
  neutral: boolean;
}

/** The minds pack's `v2` part (its slice's key `v2`): the chat's player character after a switch, each mind's bookkeeping, and the interviews kept apart. */
export interface MindsV2Slice {
  pov?: EntityId;
  minds: Record<EntityId, MindV2>;
  probes: Record<EntityId, MindProbe[]>;
}

/** The key the Character Engine's part has in the minds pack's slice. */
export const MINDS_V2_KEY = "v2";

const EMPTY_V2: MindsV2Slice = { minds: {}, probes: {} };
const EMPTY_MIND: MindV2 = { files: {}, lived: {}, superseded: {}, writes: 0, last: null };

/** The Character Engine's part of a state (read only); a chat that never wrote one reads empty. */
export function mindsV2Of(state: { packs: Readonly<Record<string, unknown>> }): MindsV2Slice {
  const slice = state.packs.minds;
  if (!isRecord(slice)) return EMPTY_V2;
  const v2 = slice[MINDS_V2_KEY];
  if (!isRecord(v2)) return EMPTY_V2;
  return {
    ...(typeof v2.pov === "string" ? { pov: v2.pov } : {}),
    minds: isRecord(v2.minds) ? (v2.minds as Record<EntityId, MindV2>) : {},
    probes: isRecord(v2.probes) ? (v2.probes as Record<EntityId, MindProbe[]>) : {},
  };
}

/** One character's mind bookkeeping (read only); empty for one with none. */
export function mindV2At(state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): MindV2 {
  const minds = mindsV2Of(state).minds;
  return hasOwn(minds, who) ? (minds[who] ?? EMPTY_MIND) : EMPTY_MIND;
}

/** `who`'s takes not yet remembered, oldest first: its working memory of the scene (read only). */
export function takesOf(state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): readonly MindTake[] {
  return mindV2At(state, who).takes ?? [];
}

/** The characters holding takes not yet remembered at a state. */
export function takersAt(state: { packs: Readonly<Record<string, unknown>> }): EntityId[] {
  return Object.entries(mindsV2Of(state).minds)
    .filter(([, m]) => (m.takes?.length ?? 0) > 0)
    .map(([who]) => who)
    .sort();
}

/** `who`'s mind files at a state, by path under its folder ("beliefs.md", "memories/000012345-1.md"), each its body's blob. */
export function mindFilesAt(state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, meta] of Object.entries(mindV2At(state, who).files)) if (isBlobHash(meta.hash)) out[rel] = meta.hash;
  return out;
}

/** `who`'s mind files' bookkeeping at a state, by path under its folder. */
export function mindMetaAt(state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): Readonly<Record<string, MindFileMeta>> {
  return mindV2At(state, who).files;
}

/** The characters with a mind at a state: anyone with a file. */
export function mindedAt(state: { packs: Readonly<Record<string, unknown>> }): EntityId[] {
  return Object.entries(mindsV2Of(state).minds)
    .filter(([, m]) => Object.keys(m.files).length > 0)
    .map(([who]) => who)
    .sort();
}

/** The chat's player character at a state (D-10): the one the player last switched to, else the world's. */
export function povOf(world: { pov: EntityId }, state: { packs: Readonly<Record<string, unknown>> }): EntityId {
  return mindsV2Of(state).pov ?? world.pov;
}

/** `world` as the chat plays it at `state` (D-10): the player character the player last switched to as its point of view; the world itself while he plays the world's own. */
export function withPov<W extends { pov: EntityId }>(world: W, state: { packs: Readonly<Record<string, unknown>> }): W {
  const pov = povOf(world, state);
  return pov === world.pov ? world : { ...world, pov };
}

/** Whether `who` may have its own agent at a state: everyone but the player character, whom the player drives (D-10). */
export function hasAgent(world: { pov: EntityId }, state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): boolean {
  return who !== povOf(world, state);
}

/** A character's interviews kept apart from its mind, oldest first. */
export function probesOf(state: { packs: Readonly<Record<string, unknown>> }, who: EntityId): readonly MindProbe[] {
  const probes = mindsV2Of(state).probes;
  return hasOwn(probes, who) ? (probes[who] ?? []) : [];
}

// ------------------------------------------------------------------ what reached a character

/**
 * A beat as the Character Engine reads it (`shared/story.ts` `Beat`, A1a's): its id, minute, order
 * and place, who acted and what they did as they did it (only to tell someone its own act), what was
 * there to sense and the exact words (blobs), and who it reached and how. The truth of it (`what`) is
 * left out by its type, so nothing here can read it.
 */
export type ExposedBeat = Pick<Beat, "id" | "at" | "surface" | "exposure" | "actors"> & Partial<Pick<Beat, "order" | "place" | "quotes" | "deed">>;

/**
 * How a beat reaches someone, as they live it (§4.2): their own act, from the inside where their own
 * point of view was written (`inside`), else as they did it, the beat's deed (`deed`), else, a beat
 * with none, as its surface has it, what those there could sense of what they did (`act`); a message
 * they received (`message`): only its words and that it came, never where it was sent from; or what
 * they sensed (`sensed`): the surface where whole, their own point of view where one was written.
 */
export type ReachAs = "inside" | "deed" | "act" | "message" | "sensed";

/** What of a beat reached someone: the beat's id and minute, where it happened (none for a message, sent or received: its place is never where both were), the channel, whether whole, how they live it, a message's senders, and the blobs of what reached them (its deed, the surface, their own point of view, or a message's words) and, only where whole, the exact words beside it. */
export interface Reach {
  beat: string;
  at: number;
  place?: PlaceId;
  channel: string;
  whole: boolean;
  as: ReachAs;
  /** A message's senders (its actors), for its recipient to name as it knows them. */
  from?: EntityId[];
  text: string;
  quotes?: string;
}

/** Whether a beat is a message from elsewhere: the most direct way it reached someone not among its actors was by message. Its place is where its story was told, never surely where it was sent from. */
function isMessage(beat: Pick<Beat, "actors" | "exposure">): boolean {
  return beat.exposure.some((x) => x.channel === "message" && !beat.actors.includes(x.who));
}

/**
 * What reached `who` of a beat, as it may live and recall it. Its own act (it is among the actors):
 * its own point of view from the inside where one was written, else the beat's deed, what it did and
 * said as it did it, lived whole with its words however far the rest of the beat reached it, else, a
 * beat with no deed, the surface as its own. A message it sent it lives as sending it, with no place:
 * the beat's place is where its story was told, never surely where it was sent from. A message it
 * received: the message's words where it reached them whole, else its own point of view of them;
 * never the surface, which is where it was sent or read. Anything else: its own point of view where
 * one was written (always for a reach in part; for a whole one when the beat involves someone it
 * doesn't know, `needsPov`), else the surface where the reach was whole. Quotes beside it only where
 * whole. Null when it didn't reach them, or nothing of it can be lived yet (a reach in part, or a
 * message without its words, with no point of view or deed to live).
 */
export function reachOf(beat: ExposedBeat, who: EntityId): Reach | null {
  const ex = beat.exposure.find((x) => x.who === who);
  if (!ex) return null;
  const acted = beat.actors.includes(who);
  if (ex.channel === "message" && !acted) {
    const whole = ex.reach === "whole";
    const text = whole && beat.quotes !== undefined ? beat.quotes : ex.pov;
    return text === undefined ? null : { beat: beat.id, at: beat.at, channel: ex.channel, whole, as: "message", from: [...beat.actors], text };
  }
  const deed = acted && ex.pov === undefined ? beat.deed : undefined;
  const whole = ex.reach === "whole" || deed !== undefined;
  if (ex.pov === undefined && !whole) return null;
  const as: ReachAs = !acted ? "sensed" : ex.pov !== undefined ? "inside" : deed !== undefined ? "deed" : "act";
  const place = beat.place !== undefined && !(acted && isMessage(beat)) ? { place: beat.place } : {};
  return { beat: beat.id, at: beat.at, ...place, channel: ex.channel, whole, as, text: ex.pov ?? deed ?? beat.surface, ...(whole && beat.quotes !== undefined ? { quotes: beat.quotes } : {}) };
}

/**
 * Whether `who` perceives a beat by hearing alone (LIVE3c L3c-4): hearing is its only way of
 * perceiving it (a phone line, through a wall), and it isn't its own act. However far it reached
 * them, they never live what there was to see of it, nor the deed: only its exact words and what
 * could be heard of it, their own point of view where the beat holds more than words (`needsPov`).
 */
export function heardAlone(beat: { actors: readonly EntityId[]; exposure: readonly Pick<Beat["exposure"][number], "who" | "channel" | "also">[] }, who: EntityId): boolean {
  const ex = beat.exposure.find((x) => x.who === who);
  return ex !== undefined && ex.channel === "hearing" && (ex.also === undefined || ex.also.length === 0) && !beat.actors.includes(who);
}

/** Whether a beat is words alone: its exact words are all there was to sense of it (its surface is them). */
export function wordsAlone(beat: Pick<Beat, "surface"> & Partial<Pick<Beat, "quotes">>): boolean {
  return beat.quotes !== undefined && beat.surface === beat.quotes;
}

/** The channels by which someone is there to perceive a beat with their own senses. */
const SENSES: readonly string[] = ["sight", "hearing", "touch"];

/**
 * The people of a beat's moment (§4.2), as ids: its actors, those it was addressed to, the people it
 * concerns, and those it reached by a sense (a message's recipient, or someone told of it, was
 * elsewhere). Whether each id is a person is the reader's to check.
 */
export function presentAt(beat: Pick<Beat, "actors" | "about" | "exposure"> & Partial<Pick<Beat, "addressed">>): EntityId[] {
  const sensed = beat.exposure.filter((x) => SENSES.includes(x.channel)).map((x) => x.who);
  return [...new Set([...beat.actors, ...(beat.addressed ?? []), ...beat.about.flatMap((r) => ("entity" in r ? [r.entity] : [])), ...sensed])];
}

/**
 * Whether `who` gets a point of view of its own for a beat (§4.2), from the truth-blind render: a
 * reach in part, but for its own act with a deed, which it lives however far the rest reached it; a
 * message it received only where its words weren't kept (whole, they are what reaches it); a message
 * it sent never where it has its deed (the render reads only the surface, where it was read, so the
 * sender lives sending it); a reach by hearing alone of a beat with more than words, whole or not
 * (`heardAlone`, `wordsAlone`: never what there was to see, LIVE3c L3c-4); otherwise a whole reach
 * when the beat involves someone `who` doesn't know (`knows`, the people it knows by name:
 * `knowsFor`), so the render tells them as they appear and neither the surface nor the deed names a
 * stranger to it, its own act included. Bookkeeping over who knows whom; what reached it stays the render's.
 */
export function needsPov(beat: Pick<Beat, "actors" | "about" | "exposure" | "surface"> & Partial<Pick<Beat, "addressed" | "quotes" | "deed">>, who: EntityId, knows: readonly EntityId[]): boolean {
  const ex = beat.exposure.find((x) => x.who === who);
  if (!ex) return false;
  const acted = beat.actors.includes(who);
  const deed = acted && beat.deed !== undefined;
  if (ex.reach === "partial" && !deed) return true;
  if (ex.channel === "message" && !acted) return beat.quotes === undefined;
  if (heardAlone(beat, who) && !wordsAlone(beat)) return true;
  if (deed && isMessage(beat)) return false;
  const involved = [...beat.actors, ...(beat.addressed ?? []), ...beat.about.flatMap((r) => ("entity" in r ? [r.entity] : []))];
  return involved.some((id) => id !== who && !knows.includes(id));
}

/**
 * Whether `who` acts in a beat that holds no deed, other than the player character (`pc`), whose acts
 * are the player's (LIVE3 lane 1b: a live author beat often comes without one). A scene's, an
 * episode's, a settlement's and an amendment's writers (`SceneBook.povs`, `povsOf`) then ask the
 * truth-blind render for its point of view of its own act, as the one doing it, from the inside, so it
 * never lives the surface, written as anyone there could sense it, as its own act (`reachOf`'s
 * `inside`). A beat no such writer made (the historian's, real time's world beats) keeps `reachOf`'s surface.
 */
export function ownActWithoutDeed(beat: Pick<Beat, "actors"> & { deed?: string }, who: EntityId, pc: EntityId): boolean {
  return who !== pc && beat.actors.includes(who) && (beat.deed === undefined || beat.deed === "");
}

/**
 * The beats that reached `who` that it hasn't lived yet, in story order (§4.2 `pending`): what its
 * catch-up lives. Beats a retcon superseded are left out; a partial reach waits for its point of view,
 * its own act with a deed excepted.
 */
export function pendingFor(beats: readonly ExposedBeat[], mind: Pick<MindV2, "lived" | "superseded">, who: EntityId): ExposedBeat[] {
  return storyOrder(beats.filter((b) => !hasOwn(mind.lived, b.id) && !hasOwn(mind.superseded, b.id) && reachOf(b, who) !== null));
}

/** The beats of a chain's story as the Character Engine reads them (`StoryRead.beats`, live ones only), and the ids no longer read there (superseded or struck). */
export function exposedBeats(story: Pick<StoryRead, "beats" | "replaced">): { beats: ExposedBeat[]; replaced: Set<string> } {
  return { beats: story.beats.map((p) => p.beat), replaced: new Set(story.replaced.map((r) => r.id)) };
}

/** Beats in story order: by minute, then the author's order within it, then as given. */
export function storyOrder<T extends Pick<ExposedBeat, "at" | "order">>(beats: readonly T[]): T[] {
  return beats
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.at - y.b.at || (x.b.order ?? 0) - (y.b.order ?? 0) || x.i - y.i)
    .map((x) => x.b);
}

// ------------------------------------------------------------------ recall

/** One document a character may recall: a file of its own mind, or a point of view it lived. */
export interface RecallDoc {
  /** `file:<path under the mind's folder>` or `beat:<beat id>`. */
  id: string;
  kind: "file" | "lived";
  /** A file's path under the mind's folder. */
  path?: string;
  /** A lived beat's id, minute and place (where it happened; none for a message, sent or received). */
  beat?: string;
  at?: number;
  place?: PlaceId;
  /** Whether a lived beat reached it whole (its exact words come back only then). */
  whole?: boolean;
  /** How it lived the beat (`reachOf`): its own act, a message it received, or what it sensed. */
  as?: ReachAs;
  text: string;
}

/** A recall's hit: the document and its score (bookkeeping: how well its words meet the cue's). */
export interface RecallHit {
  doc: RecallDoc;
  score: number;
}

/**
 * Whether a mind file drew on a beat no longer read on the chain (a retcon's superseded beats, or
 * beats an amendment or a strike replaced, `StoryRead.replaced`): it stays in the workspace, readable
 * in Minds, but no longer drives the mind or answers its recall until the catch-up that lives the
 * change rewrites it at its path (`drewOn`), so a beat's old version never comes back to it.
 */
export function writtenFromGone(meta: Pick<MindFileMeta, "lived">, mind: Pick<MindV2, "superseded">, replaced?: ReadonlySet<string>): boolean {
  return meta.lived.some((b) => hasOwn(mind.superseded, b) || replaced?.has(b) === true);
}

/** The files of a mind whose latest write drew on any of `beats`, by path under its folder: what a catch-up after an amendment or a strike rewrites (§4.2, Retcons propagate). */
export function drewOn(mind: Pick<MindV2, "files">, beats: ReadonlySet<string>): string[] {
  return Object.entries(mind.files)
    .filter(([, meta]) => meta.lived.some((b) => beats.has(b)))
    .map(([rel]) => rel)
    .sort();
}

/**
 * The corpus `who` recalls from (§4.3, §4.4): its own mind's files, and the beats it lived, as they
 * reached it. A beat it never lived, a beat a retcon superseded or an amendment replaced, a file
 * that drew on such a beat and wasn't rewritten since, another mind, the truth of a beat and the words of a beat that
 * reached it only in part are never in it. `texts` gives each blob's text by hash; a blob it lacks
 * is left out.
 */
export function livedCorpus(input: { who: EntityId; mind: Pick<MindV2, "files" | "lived" | "superseded">; beats: readonly ExposedBeat[]; texts: Readonly<Record<string, string>>; replaced?: ReadonlySet<string> }): RecallDoc[] {
  const { who, mind, texts, replaced } = input;
  const out: RecallDoc[] = [];
  for (const [path, meta] of Object.entries(mind.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const text = hasOwn(texts, meta.hash) ? texts[meta.hash] : undefined;
    if (text !== undefined && text.trim() !== "" && !writtenFromGone(meta, mind, replaced)) out.push({ id: `file:${path}`, kind: "file", path, text });
  }
  for (const beat of storyOrder(input.beats)) {
    if (!hasOwn(mind.lived, beat.id) || hasOwn(mind.superseded, beat.id) || replaced?.has(beat.id) === true) continue;
    const reach = reachOf(beat, who);
    if (!reach) continue;
    const body = hasOwn(texts, reach.text) ? texts[reach.text] : undefined;
    if (body === undefined) continue;
    const quotes = reach.whole && reach.quotes !== undefined && hasOwn(texts, reach.quotes) ? texts[reach.quotes] : undefined;
    const text = quotes !== undefined && quotes.trim() !== "" ? `${body}\n${quotes}` : body;
    out.push({ id: `beat:${beat.id}`, kind: "lived", beat: beat.id, at: beat.at, ...(reach.place !== undefined ? { place: reach.place } : {}), whole: reach.whole, as: reach.as, text });
  }
  return out;
}

/** A text's words for the index: letters and digits, lowercased, each word of two or more. */
export function recallWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((w) => w.replace(/['’]s$/u, "")).filter((w) => w.length >= 2);
}

/** BM25's constants: how fast a word's repeats stop counting, and how much a long document is discounted. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * A recall cue answered over a character's corpus: the documents whose words meet the cue's, best
 * first (Okapi BM25), at most `limit`, each scoring above nothing. Lexical bookkeeping only: it
 * reads no meaning into the cue and never looks beyond the corpus it is given.
 */
export function recallSearch(docs: readonly RecallDoc[], cue: string, limit = 5): RecallHit[] {
  const terms = [...new Set(recallWords(cue))];
  if (terms.length === 0 || docs.length === 0 || limit <= 0) return [];
  const words = docs.map((d) => recallWords(d.text));
  const avg = words.reduce((n, w) => n + w.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const w of words) for (const t of new Set(w)) if (terms.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const hits: RecallHit[] = [];
  docs.forEach((doc, i) => {
    const w = words[i] ?? [];
    const tf = new Map<string, number>();
    for (const t of w) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t) ?? 0;
      if (f === 0) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * w.length) / avg));
    }
    if (score > 0) hits.push({ doc, score });
  });
  return hits.sort((a, b) => b.score - a.score || (a.doc.id < b.doc.id ? -1 : 1)).slice(0, limit);
}
