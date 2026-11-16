// The story record today's build kept in its ledger (STANDALONE-PLAN §15.2, §8.1): the beats, the
// beats struck, each person's casting and the drafts, in the record of the swipe whose turn wrote them
// (`RecStory`, `shared/ledger.ts:565-575`), read by today's own reader (`recStoryOf`). Carried into
// RPE's story record and cast through their own writers, each tied to the imported turn whose record
// held it, so that a migrated chat's story so far and story brief begin where today's build left them
// and a swipe takes its writes with it:
//
//   a beat     story part `beat`, item `b:<today's beat id>`: { text: what, who: [names], place, kind, surface, quotes, time, message, last }
//   a strike   the same item, on the turn that struck it: { drop: true, why }
//   a draft    story part `future`, item `fu:<today's draft id>`: { text: what, tier, due: when, who: [names], place, notes, state, close, drop }
//   a casting  the cast's casting of the person's character: { as: standing, why }; the player's pin of
//              each character a run made in the chat, as the chat shows it now, set or taken away
//
// Each write holds every field, null or empty where that version has none, as each of today's records
// holds its draft or casting whole.
//
// A beat lies at its turn's reply, or one recorded afterwards from the chat's past over the stretch of
// messages it was read from, from the first to the last. A person is named as the world state names its
// entity at the turn, the player as the world's point of view, and "world" as nobody; a place as the
// world in play names it, a place made in play among them.

import type { Database } from "bun:sqlite";
import { castingItemId, type CastWrite, pinCasting, writeCast } from "../cast";
import type { ReadContext } from "../engine/registry";
import type { WorldState } from "../engine/state";
import { recStoryOf } from "../engine/story/record";
import type { JsonObject } from "../shared/json";
import type { Beat, CastStanding, Draft, Rec } from "../shared/ledger";
import type { Store, TurnRow, UserStore } from "../store";
import { type StoryWrite, writeStory } from "../story";
import { type StoryClock, storyClock } from "../story/kit";
import { refreshStoryBases } from "../story/upgrade";
import { importedTurns, pathTurns, recordOf } from "./history";
import { MIGRATION_WRITER } from "./minds";
import type { People } from "./people";
import { type Apart, apartBy, type ChatFate } from "./report";
import { peopleOf } from "./tables";

/** The story record's items of today's beats and drafts, by today's ids: one item each, written again by every turn that changed it. */
export const beatItem = (beat: string): string => `b:${beat}`;
export const futureItem = (draft: string): string => `fu:${draft}`;

/** What a run carried of a story record. */
export interface StoryCounts {
  beats: number;
  struck: number;
  /** Drafts, written as proposed futures: each draft as each turn left it. */
  futures: number;
  castings: number;
}

export interface StoryCarried extends StoryCounts {
  /** Characters whose casting the player had pinned, pinned in the cast. */
  pinned: number;
  /** Entries today's reader leaves out as damaged: in the backup only, beside their turns in the import's records. */
  leftOut: number;
  /**
   * The rest of the entries the rehearsal counts in today's records (every record of every chat), by
   * why this run wrote them into no record: those of the records a branch copied from the chat it was
   * made from, written once, with the turns the two share (`shared`); those on records of the chats
   * it imported that no imported turn holds (`unheld`); those of the chats it did not import, by what
   * came of each (`apart`).
   */
  shared: number;
  unheld: number;
  apart: Apart[];
  /** What this run carried, chat by chat: of each chat's own turns. */
  byChat: ({ chat: string } & StoryCounts)[];
}

/** What the story records of the turns `turns` names held, as today's reader reads them (a chat's path: every swipe of every reply on it, the turns it shares with the chat it was branched from included). */
export function storyOn(turns: readonly { record: Rec }[]): StoryCounts {
  const out: StoryCounts = { beats: 0, struck: 0, futures: 0, castings: 0 };
  for (const { record } of turns) {
    const part = recStoryOf(record);
    out.beats += part.beats.length;
    out.struck += part.struck.length;
    out.futures += part.drafts.length;
    out.castings += part.cast.length;
  }
  return out;
}

/** How many entries a record's story part holds as stored, damaged ones among them. */
function stored(rec: Rec): number {
  const raw = rec.story as unknown;
  if (typeof raw !== "object" || raw === null) return 0;
  const part = raw as Record<string, unknown>;
  return ["beats", "struck", "cast", "drafts"].reduce((n, key) => n + (Array.isArray(part[key]) ? (part[key] as unknown[]).length : 0), 0);
}

/** Names as a turn's world gives them: a person's by its entity (none for "world"), the player's by the world's point of view, a place's as the world in play names it, places made in play among them. */
interface Names {
  person(id: string): string | null;
  place(id: string): string;
}

function namesAt(store: Store, s: UserStore, turn: TurnRow): Names {
  let world: WorldState | null = null;
  let played: ReadContext | null = null;
  try {
    world = s.stateAt(turn.id).state.world;
    const doc = store.env.worlds(world.revision);
    // The world as play has it (`registry.context`, as the cast's `worldAt` reads it): the chat's own draft and the places made in play over the revision.
    played = doc === undefined ? null : store.env.registry.context(doc, world);
  } catch {
    played = null;
  }
  const entity = (id: string): string => world?.entities[id]?.name ?? id;
  return {
    person: (id) => (id === "world" ? null : id === "player" ? (played === null ? "player" : entity(played.world.pov)) : entity(id)),
    place: (id) => played?.world.places[id]?.name ?? id,
  };
}

// Every field each time, empty where a version has none: both records merge a write over the last field by field, so a field left out would stand from an earlier version. A beat's message is left out where it names none, as its turn's reply then places it. Its time is today's story time for it, as the chat's story clock shows a time.
function beatValue(beat: Beat, names: Names, clock: StoryClock | null): JsonObject {
  return {
    text: beat.what,
    who: [...new Set([beat.by, ...(beat.to ?? [])].map(names.person).filter((n): n is string => n !== null))],
    place: beat.where === null ? null : names.place(beat.where),
    kind: beat.kind,
    surface: beat.surface !== "" && beat.surface !== beat.what ? beat.surface : null,
    quotes: beat.quotes ?? [],
    time: clock?.text(beat.at) ?? null,
    ...(beat.past !== undefined ? { message: beat.past.from, last: beat.past.to } : {}),
  };
}

function futureValue(draft: Draft, names: Names): JsonObject {
  const places = (draft.where ?? []).map(names.place);
  return {
    text: draft.what,
    tier: draft.tier,
    due: draft.when,
    who: draft.who.map(names.person).filter((n): n is string => n !== null),
    place: places.length > 0 ? places.join(", ") : null,
    notes: draft.notes ?? null,
    state: draft.state,
    close: draft.state === "settled",
    drop: draft.state === "dropped",
  };
}

/**
 * Carries the story record of the chats `chats` names, turn by turn, inside the caller's write. Every
 * entry the rehearsal counts is accounted for: `inside` is its count of a chat's (null where it counted
 * none), and `fate` says what came of a chat this run did not import.
 */
export function carryStory(input: { db: Database; store: Store; s: UserStore; chats: readonly string[]; people: People; now: number; inside: ReadonlyMap<string, number>; fate: (chat: string) => ChatFate }): StoryCarried {
  const { db, store, s, people } = input;
  const out: StoryCarried = { beats: 0, struck: 0, futures: 0, castings: 0, pinned: 0, leftOut: 0, shared: 0, unheld: 0, apart: [], byChat: [] };
  for (const chat of input.chats) {
    const turns = importedTurns(db, s, chat);
    const counts = { chat, beats: 0, struck: 0, futures: 0, castings: 0 };
    // A branch's copies of the records it shares are the source's, written with the source's turns; what no turn holds is all its rehearsal counted besides.
    const copies = pathTurns(db, s, chat).reduce((n, t) => n + (t.turn.chat === chat ? 0 : stored(t.record)), 0);
    out.shared += copies;
    out.unheld += (input.inside.get(chat) ?? 0) - copies - turns.reduce((n, t) => n + stored(t.record), 0);
    for (const { turn, record } of turns) {
      const part = recStoryOf(record);
      const kept = part.beats.length + part.struck.length + part.cast.length + part.drafts.length;
      out.leftOut += stored(record) - kept;
      if (kept === 0) continue;
      const names = namesAt(store, s, turn);
      let clock: StoryClock | null = null;
      try {
        if (part.beats.length > 0) clock = storyClock(store, s.id, chat, turn.id);
      } catch {
        // A state that can't be folded shows no time, as it names nobody by name (`namesAt`).
      }
      const story: StoryWrite[] = [
        ...part.beats.map((b): StoryWrite => ({ part: "beat", item: beatItem(b.id), value: beatValue(b, names, clock) })),
        ...part.struck.map((x): StoryWrite => ({ part: "beat", item: beatItem(x.beat), value: { drop: true, why: x.why } })),
        ...part.drafts.map((d): StoryWrite => ({ part: "future", item: futureItem(d.id), value: futureValue(d, names) })),
      ];
      const cast = part.cast.map((c): CastWrite => {
        const character = people.of(turn, c.entity).id;
        return { character, part: "casting", item: castingItemId(character), value: { as: c.standing, why: c.why ?? null } };
      });
      if (story.length > 0) writeStory(store, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, job: null, source: "import" }, story);
      if (cast.length > 0) writeCast(db, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, job: null, at: turn.storyTime, now: input.now }, cast);
      counts.beats += part.beats.length;
      counts.struck += part.struck.length;
      counts.futures += part.drafts.length;
      counts.castings += part.cast.length;
    }
    out.byChat.push(counts);
    out.beats += counts.beats;
    out.struck += counts.struck;
    out.futures += counts.futures;
    out.castings += counts.castings;
  }
  // The starting states the import set stand for every turn before theirs: they are given the story just written, and what the store held of them is let go.
  refreshStoryBases(db, s.id);
  store.dropCaches();
  const carried = new Set(input.chats);
  out.apart = apartBy([...input.inside].filter(([chat]) => !carried.has(chat)), input.fate);
  // The player's pins, as each chat shows them now: the latest casting on its path of each person whose character is the chat's, its standing where the player pinned it, none where they didn't or no casting of the person is on the path.
  for (const chat of input.chats) {
    const latest = new Map<string, { pinned: boolean; standing: CastStanding }>();
    for (const entry of s.path(chat)) {
      const record = entry.turn === null ? null : recordOf(db, s.id, entry.turn);
      if (record !== null) for (const c of recStoryOf(record).cast) latest.set(c.entity, { pinned: c.pinned === true, standing: c.standing });
    }
    for (const { entity, character } of peopleOf(db, s.id, chat)) {
      const c = latest.get(entity);
      pinCasting(db, s.id, character, c?.pinned === true ? c.standing : null);
      if (c?.pinned === true) out.pinned++;
    }
  }
  return out;
}
