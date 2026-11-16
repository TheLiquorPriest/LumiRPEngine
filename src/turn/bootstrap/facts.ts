// The six things the bootstrap skill names as "done enough" (plan §12), as neutral counts and names, in
// the order the work is done: the lore index; the messages the history window leaves out, covered by the
// story record and summarized (§8.1 "Covered"); the cast and its castings; the parts of the story model;
// the horizon; and each principal's base and memories. Each is read from the area that keeps it, at the
// chat's head. Code says nothing of whether any of them holds: that is the skill's to define and the
// job's to judge, and the page shows the counts as they are. One that cannot be read is given as a code
// the skill words, never as the words of what failed, which go to the log alone.

import type { ChatPort, FilesPort, Log, Scope } from "rp-harness/contract";
import { type Character, castNow, type CastNow } from "../../cast";
import type { LoreIndex } from "../../lore";
import { clockRecorded, scenePlaceOf, type Store, type TreeView } from "../../store";
import { nameKey, namesOf, storyCoverage, storyHead, type StoryRecord } from "../../story";
import { windowStart } from "../../story/window";
import { turnSettings } from "../settings";
import { NO_SESSION } from "../turns";

/** Why a fact is not known, as a code: `unreadable`, its records could not be read (the log has what failed). */
export type NotKnownWhy = "unreadable";

/** A fact that could not be read, and why, as a code. */
export interface NotKnown {
  known: false;
  why: NotKnownWhy;
}

/** A fact read from its records: its counts and names. */
export type Fact<T> = ({ known: true } & T) | NotKnown;

/** 1. The lore index: the entries of the chat's lore, those a run has written lines for as they stand now, and those whose lines are of an earlier revision. */
export interface LoreIndexFact {
  entries: number;
  indexed: number;
  stale: number;
}

/** Messages from `from` to `to`, both kept, as the chat numbers them from 0. */
export interface Stretch {
  from: number;
  to: number;
}

/**
 * 2. The history the window leaves out: the chat's messages, how many the window leaves out of the prompt, how many of those the
 * story record covers, the covered stretches among them and how many of those have their summary; and of what is left out, the
 * stretch nearest the window that is not covered, and the one nearest it that has beats and no summary.
 */
export interface HistoryFact {
  messages: number;
  leftOut: number;
  covered: number;
  stretches: number;
  summarized: number;
  nearestUncovered: Stretch | null;
  nearestUnsummarized: Stretch | null;
}

/** 3. The cast: the characters the chat knows, how many have a casting in force, and the names of those that have none. */
export interface CastFact {
  listed: number;
  cast: number;
  uncast: string[];
}

/** 4. The story model, part by part: its items, open threads among the threads, and the principals that have an arc. */
export interface StoryModelFact {
  premise: number;
  chapters: number;
  scenes: number;
  beats: number;
  threads: number;
  openThreads: number;
  arcs: number;
  principals: number;
  principalsWithArc: number;
  player: number;
}

/** One part of the horizon's seed: whether it is recorded, and how many of its values stand established, assumed or proposed, and how many carry no standing. */
export interface HorizonPart {
  recorded: boolean;
  established: number;
  assumed: number;
  proposed: number;
  none: number;
}

/**
 * 5. The horizon: its entries, those that name a level of the world's tree now, and whether the chat keeps story time; and each part of
 * its seed (plan §12 l.1402: the time, the place, who is on stage, what they have) with the standing of the changes that set its values.
 */
export interface HorizonFact {
  entries: number;
  named: number;
  clock: boolean;
  time: HorizonPart;
  place: HorizonPart;
  onStage: HorizonPart;
  holdings: HorizonPart;
}

/**
 * One principal: the parts of its base that are written; its memories, those its own agent wrote, and of those the ones it wrote from
 * perceptions, apart from every other memory (the player's own, or carried by a migration).
 */
export interface PrincipalFact {
  id: string;
  name: string;
  base: string[];
  memories: number;
  own: number;
  ownFromPerceptions: number;
}

/** 6. Each principal's base and memories. */
export interface PrincipalsFact {
  principals: PrincipalFact[];
}

/** The six, in the order the skill names them. */
export interface DoneEnough {
  lore: Fact<LoreIndexFact>;
  history: Fact<HistoryFact>;
  cast: Fact<CastFact>;
  story: Fact<StoryModelFact>;
  horizon: Fact<HorizonFact>;
  principals: Fact<PrincipalsFact>;
}

export interface DoneEnoughDeps {
  store: Store;
  loreIndex: LoreIndex;
  /** The agents' files: the chat's settings for the history window are read from its levels' config files. */
  files: FilesPort;
  /** The chat as Lumiverse holds it: the length of a chat the store has not met. */
  chat: Pick<ChatPort, "info">;
  log: Log;
}

async function loreFact(deps: DoneEnoughDeps, user: string, chat: string): Promise<LoreIndexFact> {
  const entries = await deps.loreIndex.entries({ user, chat });
  return { entries: entries.length, indexed: entries.filter((e) => e.indexed).length, stale: entries.filter((e) => e.stale).length };
}

/** The maximal runs of places below `count` where `at` holds. */
function runs(count: number, at: (place: number) => boolean): Stretch[] {
  const out: Stretch[] = [];
  for (let i = 0; i < count; i++) {
    if (!at(i)) continue;
    const last = out.at(-1);
    if (last !== undefined && last.to === i - 1) last.to = i;
    else out.push({ from: i, to: i });
  }
  return out;
}

async function historyFact(deps: DoneEnoughDeps, scope: Scope): Promise<HistoryFact> {
  const store = deps.store.user(scope.user);
  const { window } = await turnSettings(deps.files, scope, deps.log);
  // A chat the store has not met is covered nowhere: its length is Lumiverse's.
  if (store.chat(scope.chat) === null) {
    const { length } = await deps.chat.info(scope);
    const leftOut = windowStart(length, window, () => false);
    return { messages: length, leftOut, covered: 0, stretches: 0, summarized: 0, nearestUncovered: runs(leftOut, () => true).at(-1) ?? null, nearestUnsummarized: null };
  }
  const messages = store.path(scope.chat);
  const { covered, unsummarized } = storyCoverage({ store: deps.store, user: scope.user, chat: scope.chat, turn: null });
  const isCovered = (place: number): boolean => covered.has(messages[place]?.message ?? "");
  const isUnsummarized = (place: number): boolean => unsummarized.has(messages[place]?.message ?? "");
  const leftOut = windowStart(messages.length, window, isCovered);
  const stretches = runs(leftOut, isCovered);
  const summarized = stretches.filter((s) => {
    for (let place = s.from; place <= s.to; place++) if (isUnsummarized(place)) return false;
    return true;
  }).length;
  const coveredCount = stretches.reduce((n, s) => n + s.to - s.from + 1, 0);
  return {
    messages: messages.length,
    leftOut,
    covered: coveredCount,
    stretches: stretches.length,
    summarized,
    nearestUncovered: runs(leftOut, (place) => !isCovered(place)).at(-1) ?? null,
    nearestUnsummarized: runs(leftOut, isUnsummarized).at(-1) ?? null,
  };
}

function castFact(now: CastNow): CastFact {
  const uncast = now.cast.filter((c) => c.as === null).map((c) => c.character.name);
  return { listed: now.cast.length, cast: now.cast.length - uncast.length, uncast };
}

function storyFact(deps: DoneEnoughDeps, user: string, chat: string, principals: readonly Character[]): StoryModelFact {
  const store = deps.store.user(user);
  const record = store.chat(chat) === null ? null : storyHead(deps.store, user, chat);
  const of = (part: Parameters<StoryRecord["of"]>[0]) => record?.of(part) ?? [];
  const threads = of("thread");
  const arcs = of("arc");
  const arcFor = new Set(arcs.flatMap((a) => namesOf(a).map(nameKey)));
  return {
    premise: of("premise").length,
    chapters: of("chapter").length,
    scenes: of("scene").length,
    beats: of("beat").length,
    threads: threads.length,
    openThreads: threads.filter((t) => t.closedBy === null).length,
    arcs: arcs.length,
    principals: principals.length,
    principalsWithArc: principals.filter((p) => arcFor.has(nameKey(p.name))).length,
    player: of("player").length,
  };
}

const NO_PART: HorizonPart = { recorded: false, established: 0, assumed: 0, proposed: 0, none: 0 };

/** A part of the seed from the marks of the refs that hold its values: each mark a value, counted by the standing of the change that set it. */
function partOf(view: TreeView, refs: readonly string[], recorded: boolean, only?: string): HorizonPart {
  const out = { ...NO_PART, recorded };
  for (const ref of refs) {
    const marks = view.state.marks[ref] ?? {};
    for (const [part, mark] of Object.entries(marks)) {
      if (only !== undefined && part !== only) continue;
      const standing = mark?.standing ?? null;
      if (standing === "established") out.established++;
      else if (standing === "assumed") out.assumed++;
      else if (standing === "proposed") out.proposed++;
      else out.none++;
    }
  }
  return out;
}

function horizonFact(deps: DoneEnoughDeps, user: string, chat: string): HorizonFact {
  const store = deps.store.user(user);
  if (store.chat(chat) === null) return { entries: 0, named: 0, clock: false, time: NO_PART, place: NO_PART, onStage: NO_PART, holdings: NO_PART };
  const view = store.view(chat);
  const entries = view.horizon();
  const clock = clockRecorded(view.state);
  // The place of the scene, the people in it, and the things each of them has, as the tree holds them now.
  const place = scenePlaceOf(view);
  const people = place === null ? [] : view.childrenOf(place).filter((ref) => ref.startsWith("entity:"));
  const things = people.flatMap((person) => view.childrenOf(person));
  return {
    entries: entries.length,
    named: entries.filter((e) => e.ref !== null).length,
    clock,
    time: partOf(view, ["world"], clock, "time"),
    place: partOf(view, place === null ? [] : [place], place !== null),
    onStage: partOf(view, people, people.length > 0),
    holdings: partOf(view, things, things.length > 0),
  };
}

function principalsFact(now: CastNow): PrincipalsFact {
  return {
    principals: now.principals.map((p) => {
      const own = p.memories.filter((m) => m.by === "own");
      return { id: p.character.id, name: p.character.name, base: [...p.base], memories: p.memories.length, own: own.length, ownFromPerceptions: own.filter((m) => m.fromPerceptions).length };
    }),
  };
}

/** The six facts for one chat, at its head. */
export async function doneEnough(deps: DoneEnoughDeps, user: string, chat: string): Promise<DoneEnough> {
  const scope: Scope = { user, chat, session: NO_SESSION };
  const known = async <T extends object>(name: string, read: () => T | Promise<T>): Promise<Fact<T>> => {
    try {
      return { known: true, ...(await read()) };
    } catch (error) {
      deps.log.warn("A fact of the bootstrap could not be read; it is given as not known.", { chat, fact: name, error: error instanceof Error ? error.message : String(error) });
      return { known: false, why: "unreadable" };
    }
  };
  const [lore, history] = await Promise.all([known("lore", () => loreFact(deps, user, chat)), known("history", () => historyFact(deps, scope))]);
  // The cast is read once: the cast, the story model's arcs and the principals all count from it.
  const now = ((): CastNow | Error => {
    try {
      return castNow(deps.store, user, chat);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();
  const fromCast = <T>(read: (cast: CastNow) => T): (() => T) => () => {
    if (now instanceof Error) throw now;
    return read(now);
  };
  return {
    lore,
    history,
    cast: await known("cast", fromCast(castFact)),
    story: await known("story", fromCast((c) => storyFact(deps, user, chat, c.principals.map((p) => p.character)))),
    horizon: await known("horizon", () => horizonFact(deps, user, chat)),
    principals: await known("principals", fromCast(principalsFact)),
  };
}
