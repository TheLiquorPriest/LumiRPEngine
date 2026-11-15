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
import { loreRefOf, worldEntryId } from "./ids";
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
 * has numbered for the user (it has been shown to an agent), or an entry of the chat's world where the
 * turn stands. A turn joined to another is refused first, with the typed error naming the turn it
 * joined (`refuseJoined`).
 */
export function overlayWrite(worlds: LoreWorlds, now: () => number = Date.now): OverlayWrite {
  return (db, input) => {
    refuseJoined(db, input.user, input.turn);
    const ref = loreRefOf(input.entry);
    const world = ref?.kind === "book" ? null : worlds.at(input.user, input.chat, input.turn);
    const known =
      ref?.kind === "book"
        ? db.query<{ n: number }, [string, number]>("SELECT n FROM lore_entry_number WHERE user = ? AND n = ?").get(input.user, ref.n) !== null
        : ref?.kind === "world" && world !== null && hasOwn(world.world.lore, ref.key);
    if (!known) {
      const asked = foldName(input.entry);
      const near =
        world === null
          ? []
          : Object.entries(world.world.lore).flatMap(([key, entry]) => {
              const names = [key, typeof entry.title === "string" ? entry.title : "", ...(Array.isArray(entry.keys) ? entry.keys : [])].filter((n): n is string => typeof n === "string" && n !== "");
              return asked !== "" && names.some((n) => foldName(n) === asked) ? [worldEntryId(key)] : [];
            });
      return { unknown: input.entry, ...(near.length > 0 ? { near } : {}) };
    }
    const row = db
      .query<{ id: number }, [string, string, string, string, string, string | null, number, string | null, string | null, number]>("INSERT INTO lore_overlay (user, chat, turn, entry, note, by, created, agent, job, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .get(input.user, input.chat, input.turn, input.entry, input.note, input.by, now(), input.agent, input.job, input.ord);
    return { written: { overlay: row?.id ?? null, entry: input.entry, note: input.note } };
  };
}

/**
 * The overlays the turns of a path wrote, by entry (on `entries` only, or on every entry for null):
 * each entry's notes in the path's order, and in their places within a turn.
 */
export function overlayNotes(db: Database, user: string, turns: readonly string[], entries: readonly string[] | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (turns.length === 0 || entries?.length === 0) return out;
  const order = new Map(turns.map((t, i) => [t, i]));
  const wanted = entries === null ? null : new Set(entries);
  const rows = db
    .query<{ turn: string; entry: string; note: string; ord: number; id: number }, [string, string]>("SELECT turn, entry, note, ord, id FROM lore_overlay WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2))")
    .all(user, JSON.stringify(turns));
  const on = rows.filter((r) => wanted === null || wanted.has(r.entry)).sort((a, b) => (order.get(a.turn) ?? 0) - (order.get(b.turn) ?? 0) || a.ord - b.ord || a.id - b.id);
  for (const r of on) out.set(r.entry, [...(out.get(r.entry) ?? []), r.note]);
  return out;
}
