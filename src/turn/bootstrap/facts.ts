// The six things the bootstrap skill names as "done enough" (plan §12), as neutral facts with their
// numbers, in the order the work is done: the lore index; the messages the history window leaves out,
// covered by the story record and summarized (§8.1 "Covered"); the cast and its castings; the parts of
// the story model; the horizon; and each principal's base and memories. Each is read from the area
// that keeps it, at the chat's head, and reads true exactly when its records exist; one that cannot be
// read is "not known", with the words of what failed. Code decides nothing with them: whether the work
// is done enough is the job's to say, and the page shows them.

import type { ChatPort, FilesPort, Log, Scope } from "rp-harness/contract";
import { type Casting, type Character, chatLine } from "../../cast";
import type { LoreIndex } from "../../lore";
import { clockRecorded, type Store } from "../../store";
import { storyCoverage } from "../../story";
import { windowStart } from "../../story/window";
import { turnSettings } from "../settings";
import { NO_SESSION } from "../turns";
// The cast's and the story's own readers of their records at a reading: neither area's public face offers them yet.
import { castAt } from "../../cast/path";
import { baseOf, CastRecord, castingInForce, charactersOf } from "../../cast/record";
import { namesOf } from "../../story/kit";
import { storyAt } from "../../story/path";
import { nameKey, StoryRecord } from "../../story/record";

/** A fact that could not be read, and why, in the words of what failed. */
export interface NotKnown {
  known: false;
  why: string;
}

/** A fact read from its records: whether they exist, with its numbers. */
export type Fact<T> = ({ known: true; holds: boolean } & T) | NotKnown;

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

/** 5. The horizon: its entries, those that name a level of the world's tree now, and whether the chat keeps story time. */
export interface HorizonFact {
  entries: number;
  named: number;
  clock: boolean;
}

/** One principal: the parts of its base that are written, and its memories. */
export interface PrincipalFact {
  id: string;
  name: string;
  base: string[];
  memories: number;
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

type Held<T> = { holds: boolean } & T;

/** The cast at the chat's head: every character the chat knows, each with the casting in force there (null: none), and the principals among them. */
interface CastNow {
  record: CastRecord | null;
  cast: { character: Character; as: Casting | null }[];
  principals: Character[];
}

function castNow(deps: DoneEnoughDeps, user: string, chat: string): CastNow {
  const { db } = deps.store;
  const store = deps.store.user(user);
  // A chat the store has not met has no turns, so no rows of the cast: a casting in force there is the player's pin alone.
  const record = store.chat(chat) === null ? null : CastRecord.read(db, user, castAt(store, chat, null));
  const cast = charactersOf(db, user, chatLine(store, chat)).map((character) => ({ character, as: record === null ? character.pinned : (castingInForce(record, character)?.as ?? null) }));
  return { record, cast, principals: cast.filter((c) => c.as === "principal").map((c) => c.character) };
}

async function loreFact(deps: DoneEnoughDeps, user: string, chat: string): Promise<Held<LoreIndexFact>> {
  const entries = await deps.loreIndex.entries({ user, chat });
  const indexed = entries.filter((e) => e.indexed).length;
  return { holds: indexed === entries.length, entries: entries.length, indexed, stale: entries.filter((e) => e.stale).length };
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

async function historyFact(deps: DoneEnoughDeps, scope: Scope): Promise<Held<HistoryFact>> {
  const store = deps.store.user(scope.user);
  const { window } = await turnSettings(deps.files, scope, deps.log);
  // A chat the store has not met is covered nowhere: its length is Lumiverse's.
  if (store.chat(scope.chat) === null) {
    const { length } = await deps.chat.info(scope);
    const leftOut = windowStart(length, window, () => false);
    return { holds: leftOut === 0, messages: length, leftOut, covered: 0, stretches: 0, summarized: 0, nearestUncovered: runs(leftOut, () => true).at(-1) ?? null, nearestUnsummarized: null };
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
    holds: coveredCount === leftOut && summarized === stretches.length,
    messages: messages.length,
    leftOut,
    covered: coveredCount,
    stretches: stretches.length,
    summarized,
    nearestUncovered: runs(leftOut, (place) => !isCovered(place)).at(-1) ?? null,
    nearestUnsummarized: runs(leftOut, isUnsummarized).at(-1) ?? null,
  };
}

function castFact(now: CastNow): Held<CastFact> {
  const uncast = now.cast.filter((c) => c.as === null).map((c) => c.character.name);
  return { holds: now.cast.length > 0 && uncast.length === 0, listed: now.cast.length, cast: now.cast.length - uncast.length, uncast };
}

function storyFact(deps: DoneEnoughDeps, user: string, chat: string, principals: readonly Character[]): Held<StoryModelFact> {
  const store = deps.store.user(user);
  const record = store.chat(chat) === null ? null : StoryRecord.read(deps.store.db, user, storyAt(store, chat, null));
  const of = (part: Parameters<StoryRecord["of"]>[0]) => record?.of(part) ?? [];
  const threads = of("thread");
  const arcs = of("arc");
  const arcFor = new Set(arcs.flatMap((a) => namesOf(a).map(nameKey)));
  const fact: StoryModelFact = {
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
  const holds = fact.premise > 0 && fact.chapters + fact.scenes > 0 && fact.threads > 0 && fact.principalsWithArc === fact.principals && fact.player > 0;
  return { holds, ...fact };
}

function horizonFact(deps: DoneEnoughDeps, user: string, chat: string): Held<HorizonFact> {
  const store = deps.store.user(user);
  if (store.chat(chat) === null) return { holds: false, entries: 0, named: 0, clock: false };
  const entries = store.view(chat).horizon();
  return { holds: entries.length > 0, entries: entries.length, named: entries.filter((e) => e.ref !== null).length, clock: clockRecorded(store.headState(chat).state) };
}

function principalsFact(deps: DoneEnoughDeps, user: string, now: CastNow): Held<PrincipalsFact> {
  const principals = now.principals.map((c) => ({ id: c.id, name: c.name, base: [...baseOf(deps.store.db, user, c.id).keys()], memories: now.record?.of(c.id, "memory").length ?? 0 }));
  return { holds: principals.length > 0 && principals.every((p) => p.base.length > 0 && p.memories > 0), principals };
}

/** The six facts for one chat, at its head. */
export async function doneEnough(deps: DoneEnoughDeps, user: string, chat: string): Promise<DoneEnough> {
  const scope: Scope = { user, chat, session: NO_SESSION };
  const known = async <T extends object>(name: string, read: () => Held<T> | Promise<Held<T>>): Promise<Fact<T>> => {
    try {
      return { known: true, ...(await read()) };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      deps.log.warn("A fact of the bootstrap could not be read; it is given as not known.", { chat, fact: name, error: why });
      return { known: false, why };
    }
  };
  const [lore, history] = await Promise.all([known("lore", () => loreFact(deps, user, chat)), known("history", () => historyFact(deps, scope))]);
  // The cast is read once: the cast, the story model's arcs and the principals all count from it.
  const now = ((): CastNow | Error => {
    try {
      return castNow(deps, user, chat);
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
    story: await known("story", fromCast((c) => storyFact(deps, user, chat, c.principals))),
    horizon: await known("horizon", () => horizonFact(deps, user, chat)),
    principals: await known("principals", fromCast((c) => principalsFact(deps, user, c))),
  };
}
