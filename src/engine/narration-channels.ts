// The engine's own narration channels (DESIGN §7, §9.4; D4): `knows`, the player character learning
// of a public person or thing a reply shows them, and `spawn`, a new background character a reply
// introduces. Both are bounded. `knows` takes public entities only: never a secret or `known_by`
// entity, a secret place, a gated or secret lore entry, or a track. `spawn` validates its kind and
// place, deduplicates by name and is capped per world.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import type { EntityId } from "../shared/ids";
import type { EffectSpec } from "../shared/world";
import type { ProposalChannelDef, ReadContext, Rejection } from "./registry";
import { kindIs, placeOfEntity } from "./scope";
import { labelOf, own } from "./pack-kit";

/** Characters a world's replies may introduce, in total. */
export const SPAWN_CAP = 24;
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

/** Why `fact` can't be learned from a reply, or null when it is a public entity the POV doesn't know yet. */
function unlearnable(ctx: ReadContext, fact: string): Rejection | null {
  const { world, state } = ctx;
  const pov = world.pov;
  if (fact === "") return reject("bad_proposal", "knows needs a fact");
  if (fact === pov) return reject("already_known", "everyone knows themselves");
  if (hasOwn(state.entities, fact)) {
    if (!isPublic(own(world.entities, fact)?.visibility ?? own(state.entities, fact)?.fields.visibility)) return reject("not_public", "only public facts are read from a reply");
    return knowsAlready(ctx, pov, fact) ? reject("already_known", `already knows ${labelOf(ctx, fact)}`) : null;
  }
  const place = hasOwn(world.places, fact) ? own(world.places, fact) : undefined;
  if (place) return isPublic(place.visibility) ? reject("already_known", `${place.name} is public`) : reject("not_public", "only public facts are read from a reply");
  const lore = hasOwn(world.lore, fact) ? own(world.lore, fact) : undefined;
  if (lore && (lore.secret === true || lore.gate !== undefined)) return reject("not_public", "secret lore is learned through its gate, never from a reply");
  if (hasOwn(world.tracks, fact)) return reject("not_public", "tracks advance through their stages, never from a reply");
  return reject("unknown_fact", `no world fact ${labelOf(ctx, fact)}`);
}

export const knowsChannel: ProposalChannelDef = {
  type: "knows",
  boundField: "knows",
  validate(p, ctx) {
    const who = text(p.who) || ctx.world.pov;
    if (who !== ctx.world.pov) return reject("not_pov", "a reply only teaches the player character");
    return unlearnable(ctx, text(p.fact));
  },
  toEffects: (p, ctx) => [{ type: "link", args: { rel: "knows", from: ctx.world.pov, to: text(p.fact) } }],
};

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s !== "" ? s : hashParts("spawn", name).slice(0, 10);
}

/** The id a spawned character gets: stable per name, so a re-read of the same reply proposes the same entity. */
export function spawnId(name: string): EntityId {
  return `npc_${slug(name)}`;
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
    if (hasOwn(ctx.state.entities, spawnId(name)) || Object.values(ctx.state.entities).some((e) => e.name.trim().toLowerCase() === lower)) return reject("duplicate", `${name} already exists`);
    if (spawnedCount(ctx) >= SPAWN_CAP) return reject("spawn_cap", `replies have introduced ${SPAWN_CAP} characters already`);
    return null;
  },
  toEffects(p, ctx): EffectSpec[] {
    const name = text(p.name);
    const id = spawnId(name);
    const role = text(p.role).slice(0, ROLE_MAX);
    const fields: JsonObject = { spawned: SPAWNED_BY_NARRATION, ...(role !== "" ? { role } : {}) };
    return [
      { type: "spawn", args: { id, kind: text(p.kind), name, tier: "background", place: placeFor(p, ctx), fields } },
      // The player character has just met them.
      { type: "link", args: { rel: "knows", from: ctx.world.pov, to: id } },
    ];
  },
};
