// What the Author's words name in the world (plan §6.4 l.680, §7.1): a principal out of view is recorded
// with the places and people its whereabouts and intention name, and a statement of what a character knows
// with what it is about, by their refs in the world state (`place:<id>`, `entity:<id>`), and with the story
// time the intention is meant for, where that reads as a time. The names are found by the engine's one
// reading of names (`Reading`), whatever kinds it finds, and a place named as the engine finds one in play.
// A word the world holds none of is left unreferenced and answered with the names nearest to it, never
// guessed at; code judges nothing else.

import { calendarOf, placeOffset } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import { findPlaces } from "../engine/places-in-play";
import type { ReadContext } from "../engine/registry";
import { writtenTime } from "../engine/time";
import { IFACE_DEFAULTS } from "../iface/kit";
import { isFound, Reading } from "../iface/reading";
import type { Database } from "bun:sqlite";
import type { CastCall } from "./kit";
import { type CastItem, charactersOf, findCharacter, nameKey } from "./record";
import { personNamed } from "./secrets";

/** What words name: a ref in the world's tree, or the names nearest to them where they name nothing (several: each of those they fit). */
export type Named = { ref: string } | { near: string[] };

/**
 * What the call's words name, by the engine's one reading of names at the call's own point of the story: a person, thing, place or any
 * other point of the tree, by id, ref, name or the words of one name; else a place named in play. Where the call reads no world, nothing is named.
 */
export function namesIn(call: CastCall): (said: string) => Named {
  let reading: Reading | null | undefined;
  return (said) => {
    if (reading === undefined) {
      const made = Reading.of({ scope: call.scope, agent: call.agent, lines: call.lines, deps: { store: call.deps.store.user(call.scope.user), env: call.deps.store.env }, settings: { nearMatches: IFACE_DEFAULTS.nearMatches, nearDistance: IFACE_DEFAULTS.nearDistance } });
      reading = made instanceof Reading ? made : null;
    }
    if (reading === null) return { near: [] };
    const found = reading.find(said, "point");
    if (isFound(found)) return { ref: found.ref };
    // A place named in play, as the engine finds one by the words of its name.
    const text = said.trim();
    const stands = placeOfEntity(reading.ctx.state, reading.ctx.world.pov);
    const places = findPlaces(reading.ctx, text.replace(/^place:/, ""), stands === null ? {} : { near: stands });
    const [place] = places;
    if (found.several.length === 0 && place !== undefined && (places.length === 1 || place.matched !== "head")) return { ref: `place:${place.id}` };
    const several = found.several.map((s) => s.name);
    return { near: several.length > 0 ? several : found.near.map((n) => n.name) };
  };
}

/** The story time (minutes of the world's clock) words give, where they are a date and time, a clock time, a part of the day or a counted span; none where they read as none of these. */
export function storyTimeOf(ctx: ReadContext, said: string): number | null {
  const stands = placeOfEntity(ctx.state, ctx.world.pov);
  return writtenTime(calendarOf(ctx.world), ctx.state.clock, said, (at) => placeOffset(ctx.world, at, stands));
}

/** Who a relationship is toward: the character of the chat (by its id) or, the world's person by its entity, the name as written kept beside it. */
export interface Toward {
  ref: string;
  /** The name as the call wrote it, or as the character or person is now called where the reference found one. */
  name: string;
}

/**
 * Who `said` names as the other end of a relationship: a character of the chat by id or by name; else the world's person by id or name
 * (the character that is that person, where the chat has one); else only the name. A relationship kept by that reference follows the
 * person through a rename, and a nickname or the id joins the same relationship.
 */
export function towardOf(db: Database, user: string, chats: readonly string[], ctx: ReadContext | null, said: string): Toward {
  const text = said.trim();
  const character = findCharacter(db, user, chats, text);
  if (character !== null) return { ref: character.id, name: character.name };
  if (ctx !== null) {
    const found = personNamed(ctx, text);
    if ("id" in found) {
      const holder = charactersOf(db, user, chats).find((c) => c.person === found.id);
      return holder !== undefined ? { ref: holder.id, name: holder.name } : { ref: `entity:${found.id}`, name: ctx.state.entities[found.id]?.name ?? text };
    }
  }
  return { ref: nameKey(text), name: text };
}

/** What a relationship's other end is called now: the character's or the person's own name where the relationship is by reference, else the name as written. */
export function towardName(db: Database, user: string, chats: readonly string[], ctx: ReadContext | null, item: Pick<CastItem, "fields">): string | null {
  const written = typeof item.fields.with === "string" ? item.fields.with : null;
  const ref = item.fields.toward;
  if (typeof ref !== "string") return written;
  if (ref.startsWith("entity:")) return ctx?.state.entities[ref.slice("entity:".length)]?.name ?? written;
  return charactersOf(db, user, chats).find((c) => c.id === ref)?.name ?? written;
}
