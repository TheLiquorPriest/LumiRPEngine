// Overlays (plan §9.3, §9.5): a note by the Author, tied to a turn, that the chat's story has moved
// past part of a lore entry ("the entry says a thriving inn; the story burned its east wing"). The
// entry is not touched: your books are shared by every chat and branch that reads them. An overlay is
// a change of the story's area in the store's fold (`story.overlay`), written by the Author's
// `overlay` operation of `story_record` with the call's other writes, so a swipe or a delete takes a
// turn's overlays off the path with the turn, showing that swipe again brings them back, a branch sees
// those of the turns it shares, a job's take effect where the store places a job's (§10.9), and a
// dropped sub-agent or a continue that saved nothing takes them back with the engine's changes. A
// reading takes the overlays of the folded state at its point.
//
// What is here is the lore's own word on the write (whether the entry is one it knows) and the reading.

import type { Database } from "bun:sqlite";
import { hasOwn } from "../shared/json";
import { storySliceOf } from "../story/fold";
import { refuseJoined, type Store } from "../store";
import { giveWorldNumbers, loreRefOf, worldEntryId } from "./ids";
import { foldName } from "./keys";
import type { LoreWorlds } from "./sources";

/** The lore's word on an overlay's entry: null when it knows the entry in the chat; else the entry it does not know and any near it. The shape of the story's `LoreOverlay`. */
export type OverlayCheck = (db: Database, input: { user: string; chat: string; turn: string; entry: string }) => { unknown: string; near?: string[] } | null;

/**
 * The lore's word on an overlay's entry, for the story's `overlay` operation, asked inside the call's queued write before anything
 * of it is recorded. An entry is known when it is a book entry RPE has numbered for the user (it has been shown to an agent), or a
 * world entry RPE has numbered that is an entry of the chat's world where the turn stands. An id that names none is answered with the
 * world entries of the chat that its text names by title or key, by their numbers. A turn joined to another is refused first, with
 * the typed error naming the turn it joined (`refuseJoined`).
 */
export function overlayCheck(worlds: LoreWorlds): OverlayCheck {
  return (db: Database, input) => {
    refuseJoined(db, input.user, input.turn);
    const ref = loreRefOf(input.entry);
    const world = ref?.kind === "book" ? null : worlds.at(input.user, input.chat, input.turn);
    // A world entry is known when it is numbered and is an entry of the chat's own world.
    const numbered = ref?.kind === "world" ? db.query<{ world: string; key: string }, [string, number]>("SELECT world, key FROM lore_world_number WHERE user = ? AND n = ?").get(input.user, ref.n) : null;
    const known =
      ref?.kind === "book"
        ? db.query<{ n: number }, [string, number]>("SELECT n FROM lore_entry_number WHERE user = ? AND n = ?").get(input.user, ref.n) !== null
        : ref?.kind === "world" && world !== null && numbered !== null && numbered.world === world.world.id && hasOwn(world.world.lore, numbered.key);
    if (known) return null;
    const asked = foldName(input.entry);
    const matches =
      world === null
        ? []
        : Object.entries(world.world.lore).flatMap(([key, entry]) => {
            const names = [key, typeof entry.title === "string" ? entry.title : "", ...(Array.isArray(entry.keys) ? entry.keys : [])].filter((n): n is string => typeof n === "string" && n !== "");
            return asked !== "" && names.some((n) => foldName(n) === asked) ? [key] : [];
          });
    // The near entries are named as the map names them, so each is numbered here, in the caller's write.
    const numbers = world === null ? new Map<string, number>() : giveWorldNumbers(db, input.user, world.world.id, matches);
    const near = matches.flatMap((key) => {
      const n = numbers.get(key);
      return n === undefined ? [] : [worldEntryId(n)];
    });
    return { unknown: input.entry, ...(near.length > 0 ? { near } : {}) };
  };
}

/**
 * An overlay on a chat's path, as written: its entry, its note, the turn that wrote it (by its place on the path, counted from 1:
 * "turn 40") and who. `id` is its place among the overlays of the path.
 */
export interface OverlayRow {
  id: number;
  entry: string;
  note: string;
  /** The turn's id. */
  turn: string;
  /** The turn's place on the path, counted from 1. */
  number: number;
  /** The definition of the agent that wrote it. */
  by: string | null;
  agent: string | null;
}

/** A note on an entry, with the turn it was written on (its place on the path, counted from 1). */
export interface OverlayNote {
  note: string;
  turn: number;
}

/** The overlays of the folded state at `turn` of `chat` (null: the chat's head), in the path's order and in their places within a turn. */
export function overlayRows(store: Store, user: string, chat: string, turn: string | null): OverlayRow[] {
  const u = store.user(user);
  if (u.chat(chat) === null) return [];
  const folded = turn === null ? u.headState(chat) : u.stateAt(turn);
  return storySliceOf(folded.state).overlays.map((o, i) => ({ id: i + 1, entry: o.entry, note: o.note, turn: o.turn, number: o.n, by: o.by, agent: null }));
}

/**
 * `rows` by entry (on `entries` only, or on every entry for null): each entry's notes in the path's order, and in their places
 * within a turn, each with the turn it was written on.
 */
export function overlayNoted(rows: readonly OverlayRow[], entries: readonly string[] | null): Map<string, OverlayNote[]> {
  const out = new Map<string, OverlayNote[]>();
  if (entries?.length === 0) return out;
  const wanted = entries === null ? null : new Set(entries);
  for (const r of rows) if (wanted === null || wanted.has(r.entry)) out.set(r.entry, [...(out.get(r.entry) ?? []), { note: r.note, turn: r.number }]);
  return out;
}

/** `overlayNoted`, each entry's notes as words only. */
export function overlayNotes(rows: readonly OverlayRow[], entries: readonly string[] | null): Map<string, string[]> {
  return new Map([...overlayNoted(rows, entries)].map(([entry, notes]) => [entry, notes.map((n) => n.note)]));
}
