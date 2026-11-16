// Overlays (plan §9.3, §9.5): a note by the Author, tied to a turn, that the chat's story has moved
// past part of a lore entry ("the entry says a thriving inn; the story burned its east wing"). The
// entry is not touched: your books are shared by every chat and branch that reads them. A reading
// takes the overlays of the turns on its path, whichever chat wrote them, so a swipe or a delete takes
// a turn's overlays off the path with the turn, showing that swipe again brings them back, and a
// branch sees those of the turns it shares.
//
// The Author writes one through the `overlay` operation of the story's `story_record`, which runs the
// write below inside its own queued write, so a call's writes stand or fall together. It is the
// writer's and has its place among the turn's story rows, as a story row does: the story takes it back
// with a dropped sub-agent's rows and with what a continue that saved nothing recorded
// (`dropStoryStaged`, `takeBackStory`).

import type { Database } from "bun:sqlite";
import type { JsonObject } from "rp-harness/contract";
import { hasOwn } from "../shared/json";
import { giveWorldNumbers, loreRefOf, worldEntryId } from "./ids";
import { foldName } from "./keys";
import { refuseJoined } from "../store";
import type { LoreWorlds } from "./sources";

/** One overlay to write, as the story's operation hands it over. */
export interface OverlayInput {
  user: string;
  chat: string;
  turn: string;
  /** The entry's id, as the lore map shows it. */
  entry: string;
  note: string;
  /** The definition of the agent that wrote it. */
  by: string | null;
  /** The writing agent's handle in its run, and its job: a story row's own. */
  agent: string | null;
  job: string | null;
  /** Its place among the turn's story rows (`storyMark`). */
  ord: number;
}

/**
 * Writes an overlay inside the caller's write, on its database: what it wrote, as data; or, for an id
 * that names no entry RPE knows in the chat, that id and any of the chat's world entries the text
 * names by title or key. The shape of the story's `LoreOverlay`.
 */
export type OverlayWrite = (db: Database, input: OverlayInput) => { written: JsonObject } | { unknown: string; near?: string[] };

/**
 * The overlay write for the story's `overlay` operation. An entry is known when it is a book entry RPE
 * has numbered for the user (it has been shown to an agent), or a world entry RPE has numbered that is
 * an entry of the chat's world where the turn stands. An id that names none is answered with the world
 * entries of the chat that its text names by title or key, by their numbers. A turn joined to another
 * is refused first, with the typed error naming the turn it joined (`refuseJoined`).
 */
export function overlayWrite(worlds: LoreWorlds, now: () => number = Date.now): OverlayWrite {
  return (db, input) => {
    refuseJoined(db, input.user, input.turn);
    const ref = loreRefOf(input.entry);
    const world = ref?.kind === "book" ? null : worlds.at(input.user, input.chat, input.turn);
    // A world entry is known when it is numbered and is an entry of the chat's own world.
    const numbered = ref?.kind === "world" ? db.query<{ world: string; key: string }, [string, number]>("SELECT world, key FROM lore_world_number WHERE user = ? AND n = ?").get(input.user, ref.n) : null;
    const known =
      ref?.kind === "book"
        ? db.query<{ n: number }, [string, number]>("SELECT n FROM lore_entry_number WHERE user = ? AND n = ?").get(input.user, ref.n) !== null
        : ref?.kind === "world" && world !== null && numbered !== null && numbered.world === world.world.id && hasOwn(world.world.lore, numbered.key);
    if (!known) {
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
    }
    const row = db
      .query<{ id: number }, [string, string, string, string, string, string | null, number, string | null, string | null, number]>("INSERT INTO lore_overlay (user, chat, turn, entry, note, by, created, agent, job, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .get(input.user, input.chat, input.turn, input.entry, input.note, input.by, now(), input.agent, input.job, input.ord);
    return { written: { overlay: row?.id ?? null, entry: input.entry, note: input.note } };
  };
}

/** An overlay on a chat's path, as written: its entry, its note, the turn that wrote it (by its place on the path, counted from 1: "turn 40") and who. */
export interface OverlayRow {
  id: number;
  entry: string;
  note: string;
  /** The turn's id. */
  turn: string;
  /** The turn's place on the path, counted from 1. */
  number: number;
  /** The definition of the agent that wrote it, and its handle and job. */
  by: string | null;
  agent: string | null;
  job: string | null;
  created: number;
}

/** A note on an entry, with the turn it was written on (its place on the path, counted from 1). */
export interface OverlayNote {
  note: string;
  turn: number;
}

/** The overlays the turns of a path wrote, in the path's order and in their places within a turn. */
export function overlayRows(db: Database, user: string, turns: readonly string[]): OverlayRow[] {
  if (turns.length === 0) return [];
  const order = new Map(turns.map((t, i) => [t, i]));
  return db
    .query<{ id: number; turn: string; entry: string; note: string; by: string | null; agent: string | null; job: string | null; ord: number; created: number }, [string, string]>(
      "SELECT id, turn, entry, note, by, agent, job, ord, created FROM lore_overlay WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2))",
    )
    .all(user, JSON.stringify(turns))
    .sort((a, b) => (order.get(a.turn) ?? 0) - (order.get(b.turn) ?? 0) || a.ord - b.ord || a.id - b.id)
    .map((r) => ({ id: r.id, entry: r.entry, note: r.note, turn: r.turn, number: (order.get(r.turn) ?? 0) + 1, by: r.by, agent: r.agent, job: r.job, created: r.created }));
}

/**
 * The overlays the turns of a path wrote, by entry (on `entries` only, or on every entry for null):
 * each entry's notes in the path's order, and in their places within a turn.
 */
export function overlayNotes(db: Database, user: string, turns: readonly string[], entries: readonly string[] | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [entry, notes] of overlayNoted(db, user, turns, entries)) out.set(entry, notes.map((n) => n.note));
  return out;
}

/** `overlayNotes`, each note with the turn it was written on. */
export function overlayNoted(db: Database, user: string, turns: readonly string[], entries: readonly string[] | null): Map<string, OverlayNote[]> {
  const out = new Map<string, OverlayNote[]>();
  if (entries?.length === 0) return out;
  const wanted = entries === null ? null : new Set(entries);
  for (const r of overlayRows(db, user, turns)) if (wanted === null || wanted.has(r.entry)) out.set(r.entry, [...(out.get(r.entry) ?? []), { note: r.note, turn: r.number }]);
  return out;
}
