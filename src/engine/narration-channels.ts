// The engine's own narration channels (DESIGN §7, §9.4; D4): `knows`, the player character learning
// of a public person or thing a reply shows them, or hearing of a place it didn't know, and `spawn`,
// a new character a reply introduces, at the world's spawn tier. Both are bounded. `knows` takes
// public entities and `known_by` or `discoverable` places the POV can't see yet, named by id or by
// name: never a secret or `known_by` entity, a secret place, a gated or secret lore entry, or a
// track. `spawn` validates its kind and place, deduplicates by name and stops at the world's spawn cap.
// Neither refusal tells of something the POV may not know: one that would is worded, or dropped, as
// it would be were there no such thing.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import type { EntityId } from "../shared/ids";
import { loreIsSecret } from "../shared/lore";
import { spawnTierOf } from "../shared/tiers";
import { spawnCapOf, type EffectSpec } from "../shared/world";
import { povMayKnow } from "./player-events";
import type { ProposalChannelDef, ReadContext, Rejection } from "./registry";
import { kindIs, placeOfEntity } from "./scope";
import { canSeePlace, loreGateReader, trackShown } from "./visibility";
import { placeKey } from "./place-names";
import { labelOf, own } from "./pack-kit";

/** The `spawned` field value that marks a character a reply introduced. */
export const SPAWNED_BY_NARRATION = "narration";
const NAME_MAX = 60;
const ROLE_MAX = 80;
/** Letters, digits, spaces and name punctuation: no markup, macros or control characters. */
const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} .,'’-]*$/u;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function isPublic(v: unknown): boolean {
  return v === undefined || v === null || v === "public";
}

function knowsAlready(ctx: ReadContext, who: EntityId, id: string): boolean {
  return own(ctx.state.entities, who)?.relations.some((r) => r.type === "knows" && r.to === id) ?? false;
}

/** A place the POV may not even hear of: a secret one it can't see. A reply's name never finds it, so a refusal can't tell of it. */
function placeKept(ctx: ReadContext, id: string): boolean {
  const v = own(ctx.world.places, id)?.visibility;
  return !isPublic(v) && v !== "known_by" && v !== "discoverable" && !canSeePlace(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
}

/** A place a reply names by its name (as the POV hears it, the id is never shown; compared as `placeKey` compares names): the one place with that name the POV may hear of. */
function placeNamed(ctx: ReadContext, fact: string): string | null {
  const key = placeKey(fact);
  const ids = key === "" ? [] : Object.keys(ctx.world.places).filter((id) => placeKey(own(ctx.world.places, id)?.name ?? "") === key && !placeKept(ctx, id));
  return ids.length === 1 ? (ids[0] ?? null) : null;
}

/** The world fact a proposal's `fact` names: an entity or place id, else a place by its name, else itself. */
function factOf(ctx: ReadContext, fact: string): string {
  if (hasOwn(ctx.state.entities, fact) || hasOwn(ctx.world.places, fact)) return fact;
  return placeNamed(ctx, fact) ?? fact;
}

/**
 * The refusal of a fact no world has, as the reply named it (an id in words, `labelOf`'s last
 * resort). A fact the POV may not know of is refused in these same words, so the chip and the next
 * reply's note read alike whether or not it exists; `gm` keeps the real reason.
 */
function noSuchFact(said: string, gm?: string): Rejection {
  return { ...reject("unknown_fact", `no world fact ${said.replace(/_/g, " ").trim() || "nothing"}`), ...(gm !== undefined ? { gm } : {}) };
}

/** Why `fact` can't be learned from a reply, or null when it is a public entity or a hidden, non-secret place the POV doesn't know yet. */
function unlearnable(ctx: ReadContext, fact: string): Rejection | null {
  const { world, state, registry } = ctx;
  const pov = world.pov;
  if (fact === "") return reject("bad_proposal", "knows needs a fact");
  if (fact === pov) return reject("already_known", "everyone knows themselves");
  if (hasOwn(state.entities, fact)) {
    if (!isPublic(own(world.entities, fact)?.visibility ?? own(state.entities, fact)?.fields.visibility)) {
      return povMayKnow(registry, world, state, fact) ? reject("not_public", "only public facts are read from a reply") : noSuchFact(fact, `${labelOf(ctx, fact)} isn't public, and the POV doesn't know them`);
    }
    return knowsAlready(ctx, pov, fact) ? reject("already_known", `already knows ${labelOf(ctx, fact)}`) : null;
  }
  const place = hasOwn(world.places, fact) ? own(world.places, fact) : undefined;
  if (place) {
    // A reply can tell of a place kept to those who know it or hidden until found; a secret one only its story reveals.
    if (placeKept(ctx, fact)) return noSuchFact(fact, `${place.name} is secret`);
    if (place.visibility !== "known_by" && place.visibility !== "discoverable") return isPublic(place.visibility) ? reject("already_known", `${place.name} is public`) : reject("not_public", "only public facts are read from a reply");
    return canSeePlace(registry, world, state, pov, fact) ? reject("already_known", `already knows ${place.name}`) : null;
  }
  const lore = hasOwn(world.lore, fact) ? own(world.lore, fact) : undefined;
  if (lore && loreIsSecret(lore) && !loreGateReader(registry, world, state)(lore)) return noSuchFact(fact, "secret lore whose gate doesn't hold");
  if (lore && (loreIsSecret(lore) || lore.gate !== undefined)) return reject("not_public", "secret lore is learned through its gate, never from a reply");
  if (hasOwn(world.tracks, fact)) return trackShown(registry, world, state, pov, fact) ? reject("not_public", "tracks advance through their stages, never from a reply") : noSuchFact(fact, "a track the POV may not know of");
  return noSuchFact(fact);
}

export const knowsChannel: ProposalChannelDef = {
  type: "knows",
  boundField: "knows",
  validate(p, ctx) {
    const who = text(p.who) || ctx.world.pov;
    if (who !== ctx.world.pov) return reject("not_pov", "a reply only teaches the player character");
    return unlearnable(ctx, factOf(ctx, text(p.fact)));
  },
  toEffects: (p, ctx) => [{ type: "link", args: { rel: "knows", from: ctx.world.pov, to: factOf(ctx, text(p.fact)) } }],
};

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s !== "" ? s : hashParts("spawn", name).slice(0, 10);
}

/**
 * The id a newcomer gets: its name's slug and a digest of the name and how many replies introduced
 * someone before it. Never the name alone, so it isn't an id an author would write; the same on a
 * re-read of the same reply after the same story, and kept in the `spawn` event, so replays and
 * swipes fold alike.
 */
function spawnId(ctx: ReadContext, name: string): EntityId {
  return `npc_${slug(name)}_${hashParts("spawn", name, spawnedCount(ctx)).slice(0, 8)}`;
}

function spawnedCount(ctx: ReadContext): number {
  let n = 0;
  for (const e of Object.values(ctx.state.entities)) if (e.fields.spawned === SPAWNED_BY_NARRATION) n++;
  return n;
}

function placeFor(p: JsonObject, ctx: ReadContext): string {
  return text(p.place) || (placeOfEntity(ctx.state, ctx.world.pov) ?? "");
}

export const spawnChannel: ProposalChannelDef = {
  type: "spawn",
  boundField: "spawn",
  validate(p, ctx) {
    const kind = text(p.kind);
    if (kind === "" || !(hasOwn(ctx.world.kinds, kind) || ctx.registry.kinds.has(kind))) return reject("missing_kind", `no kind ${kind}`);
    if (!kindIs(ctx.registry, ctx.world, kind, "person")) return reject("not_a_character", "a reply introduces characters only");
    const name = text(p.name);
    if (name === "" || name.length > NAME_MAX || !NAME_OK.test(name)) return reject("bad_name", "a new character needs a plain name");
    const place = placeFor(p, ctx);
    const def = hasOwn(ctx.world.places, place) ? own(ctx.world.places, place) : undefined;
    if (!def) return reject("missing_place", `no place ${place}`);
    if (def.visibility === "secret") return reject("not_public", "a reply can't place someone somewhere secret");
    const lower = name.toLowerCase();
    const named = Object.keys(ctx.state.entities).filter((id) => own(ctx.state.entities, id)?.name.trim().toLowerCase() === lower);
    if (named.some((id) => povMayKnow(ctx.registry, ctx.world, ctx.state, id))) return reject("duplicate", `${name} already exists`);
    const cap = spawnCapOf(ctx.world);
    if (spawnedCount(ctx) >= cap) return reject("spawn_cap", cap === 0 ? "this world lets no reply introduce characters" : `replies have introduced ${cap} characters already`);
    // A name only people the POV may not know have: the player can't tell the newcomer from one of
    // them, so it is dropped as a change that changed nothing, which no chip or note tells of; only
    // the log says why (DESIGN §7). Checked after every refusal the player sees, so those read as
    // they would with no such person.
    if (named.length > 0) return { code: "duplicate", reason: "that newcomer didn't appear", gm: `${name} is already ${named.join(", ")}, whom the POV may not know`, unseen: true };
    // An authored id that happens to be the newcomer's is the same: nothing the player sees says it is taken.
    const id = spawnId(ctx, name);
    if (hasOwn(ctx.state.entities, id)) return { code: "duplicate", reason: "that newcomer didn't appear", gm: `the id ${id} is taken`, unseen: true };
    return null;
  },
  toEffects(p, ctx): EffectSpec[] {
    const name = text(p.name);
    const id = spawnId(ctx, name);
    const role = text(p.role).slice(0, ROLE_MAX);
    const fields: JsonObject = { spawned: SPAWNED_BY_NARRATION, ...(role !== "" ? { role } : {}) };
    return [
      // A newcomer joins at the world's spawn tier; the reply never picks one.
      { type: "spawn", args: { id, kind: text(p.kind), name, tier: spawnTierOf(ctx.world), place: placeFor(p, ctx), fields } },
      // The player character has just met them.
      { type: "link", args: { rel: "knows", from: ctx.world.pov, to: id } },
    ];
  },
};
