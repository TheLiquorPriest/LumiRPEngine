// The story record today's build kept in its ledger (STANDALONE-PLAN §15.2, §8.1): the beats, the
// beats struck, each person's casting and the drafts, in the record of the swipe whose turn wrote them
// (`RecStory`, `shared/ledger.ts:565-575`), read by today's own reader (`recStoryOf`). Carried into
// RPE's story record and cast through their own writers, each tied to the imported turn whose record
// held it, so that a migrated chat's story so far and story brief begin where today's build left them
// and a swipe takes its writes with it:
//
//   a beat     story part `beat`, item `b:<today's beat id>`: { text: what, who: [names], place, kind, surface, quotes, message }
//   a strike   the same item, on the turn that struck it: { drop: true, why }
//   a draft    story part `future`, item `fu:<today's draft id>`: { text: what, tier, due: when, who: [names], place, notes, state, close, drop }
//   a casting  the cast's casting of the person's character: { as: standing, why }; a casting the player
//              pinned, as the chat shows it now, is pinned in the cast
//
// A beat lies at its turn's reply, or one recorded afterwards from the chat's past at the first
// message it was read from. A person is named as the world state names its entity at the turn, the
// player as the world's point of view, and "world" as nobody; a place as the world names it.

import type { Database } from "bun:sqlite";
import { castingItemId, type CastWrite, pinCasting, writeCast } from "../cast";
import type { WorldState } from "../engine/state";
import { recStoryOf } from "../engine/story/record";
import type { JsonObject } from "../shared/json";
import type { Beat, CastStanding, Draft, Rec } from "../shared/ledger";
import type { Store, TurnRow, UserStore } from "../store";
import { type StoryWrite, writeStory } from "../story";
import { importedTurns } from "./history";
import { MIGRATION_WRITER } from "./minds";
import type { People } from "./people";

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
  /** The same, chat by chat. */
  byChat: ({ chat: string } & StoryCounts)[];
}

/** How many entries a record's story part holds as stored, damaged ones among them. */
function stored(rec: Rec): number {
  const raw = rec.story as unknown;
  if (typeof raw !== "object" || raw === null) return 0;
  const part = raw as Record<string, unknown>;
  return ["beats", "struck", "cast", "drafts"].reduce((n, key) => n + (Array.isArray(part[key]) ? (part[key] as unknown[]).length : 0), 0);
}

/** Names as a turn's world state gives them: a person's by its entity (none for "world"), the player's by the world's point of view, a place's by the world. */
interface Names {
  person(id: string): string | null;
  place(id: string): string;
}

function namesAt(store: Store, s: UserStore, turn: TurnRow): Names {
  let world: WorldState | null = null;
  try {
    world = s.stateAt(turn.id).state.world;
  } catch {
    world = null;
  }
  const doc = world === null ? undefined : store.env.worlds(world.revision);
  const entity = (id: string): string => world?.entities[id]?.name ?? id;
  return {
    person: (id) => (id === "world" ? null : id === "player" ? (doc === undefined ? "player" : entity(doc.pov)) : entity(id)),
    place: (id) => doc?.places[id]?.name ?? id,
  };
}

function beatValue(beat: Beat, names: Names): JsonObject {
  const who = [...new Set([beat.by, ...(beat.to ?? [])].map(names.person).filter((n): n is string => n !== null))];
  return {
    text: beat.what,
    ...(who.length > 0 ? { who } : {}),
    ...(beat.where !== null ? { place: names.place(beat.where) } : {}),
    kind: beat.kind,
    ...(beat.surface !== "" && beat.surface !== beat.what ? { surface: beat.surface } : {}),
    ...(beat.quotes !== undefined && beat.quotes.length > 0 ? { quotes: beat.quotes } : {}),
    ...(beat.past !== undefined ? { message: beat.past.from } : {}),
  };
}

function futureValue(draft: Draft, names: Names): JsonObject {
  const who = draft.who.map(names.person).filter((n): n is string => n !== null);
  const places = (draft.where ?? []).map(names.place);
  return {
    text: draft.what,
    tier: draft.tier,
    due: draft.when,
    ...(who.length > 0 ? { who } : {}),
    ...(places.length > 0 ? { place: places.join(", ") } : {}),
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    state: draft.state,
    close: draft.state === "settled",
    drop: draft.state === "dropped",
  };
}

/** Carries the story record of the chats `chats` names, turn by turn. Inside the caller's write. */
export function carryStory(input: { db: Database; store: Store; s: UserStore; chats: readonly string[]; people: People; now: number }): StoryCarried {
  const { db, store, s, people } = input;
  const out: StoryCarried = { beats: 0, struck: 0, futures: 0, castings: 0, pinned: 0, leftOut: 0, byChat: [] };
  for (const chat of input.chats) {
    const turns = importedTurns(db, s, chat);
    const counts = { chat, beats: 0, struck: 0, futures: 0, castings: 0 };
    for (const { turn, record } of turns) {
      const part = recStoryOf(record);
      const kept = part.beats.length + part.struck.length + part.cast.length + part.drafts.length;
      out.leftOut += stored(record) - kept;
      if (kept === 0) continue;
      const names = namesAt(store, s, turn);
      const story: StoryWrite[] = [
        ...part.beats.map((b): StoryWrite => ({ part: "beat", item: beatItem(b.id), value: beatValue(b, names) })),
        ...part.struck.map((x): StoryWrite => ({ part: "beat", item: beatItem(x.beat), value: { drop: true, why: x.why } })),
        ...part.drafts.map((d): StoryWrite => ({ part: "future", item: futureItem(d.id), value: futureValue(d, names) })),
      ];
      const cast = part.cast.map((c): CastWrite => {
        const character = people.of(turn, c.entity).id;
        return { character, part: "casting", item: castingItemId(character), value: { as: c.standing, ...(c.why !== undefined ? { why: c.why } : {}) } };
      });
      if (story.length > 0) writeStory(db, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, job: null, now: input.now }, story);
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
    // The player's pins, as the chat shows them now: the latest casting of each person along its path.
    const records = new Map(turns.map((t) => [t.turn.id, t] as const));
    const latest = new Map<string, { turn: TurnRow; pinned: boolean; standing: CastStanding }>();
    for (const entry of s.path(chat)) {
      const at = entry.turn === null ? undefined : records.get(entry.turn);
      if (at !== undefined) for (const c of recStoryOf(at.record).cast) latest.set(c.entity, { turn: at.turn, pinned: c.pinned === true, standing: c.standing });
    }
    for (const [entity, c] of latest) {
      if (!c.pinned) continue;
      pinCasting(db, s.id, people.of(c.turn, entity).id, c.standing);
      out.pinned++;
    }
  }
  return out;
}
