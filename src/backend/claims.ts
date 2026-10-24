// Player claims at the read (DESIGN §9.4): what becomes of a typed action's ref param that names a
// thing the world doesn't have, as the POV sees it. Only a param that takes claims (`ParamDef.claim`)
// and holds words the player typed can be one. A thing the POV may know by those words keeps its
// own rules, and money is never made. The chat's policy decides the rest: made real, asked about
// first (under Make it real too, when its catalog price is over the world's claim cap under a
// capped policy, or it is a key, a weapon or a document), or dropped with its decline chip.

import type { ClaimsPolicy } from "../shared/claims";
import type { EntityId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { ActionDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { optionalService, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { Claim } from "../engine/steps";
import { canSeeEntity, canSeePlace } from "../engine/visibility";
import { matchCatalog } from "../packs/economy/core/index";
import { catalogName, itemName } from "../packs/economy/core/items";
import { claimCap, FOOD_AND_DRINK, priceOf } from "../packs/economy/core/model";
import { cashGift } from "../packs/gear/core/index";
import { isInside } from "../packs/gear/core/model";
import type { ThingSort } from "./steps";
import { unfitRef, type UnfitRef } from "./turn-steps";

export type ClaimVerdict =
  /** A thing the POV may know goes by those words: the action takes it, and keeps its own rules. */
  | { kind: "known"; params: JsonObject }
  | { kind: "real"; claim: Claim }
  /** The turn waits on the player's answer before anything is generated (Ask first, or Make it real over the cap or for a key, a weapon or a document). */
  | { kind: "ask"; claim: Claim; question: string; detail: string }
  /** Dropped with its decline chip, as under Hold me to the world; `reason` replaces the usual one (money). */
  | { kind: "hold"; reason?: string };

/** What the reading may say a claimed thing is that always asks first: a claim can't stand in for what opens or proves things, or arms someone. */
const RESTRICTED: Readonly<Record<string, true>> = { weapon: true, key: true, document: true };

const DETERMINER = /^(?:a|an|the|some|my|your|his|her|their|our|this|that)\s+/i;

/** `value`'s words as the player typed them in `said` (the action's own words, then the message), as whole words, without a leading article; null when they aren't there. */
function typedName(value: string, said: readonly string[]): string | null {
  const given = value.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (given === "" || given.length > 80) return null;
  const words = new RegExp(`(?<![\\p{L}\\p{N}])${given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
  for (const text of said) {
    const typed = words.exec(text)?.[0]?.replace(DETERMINER, "").trim();
    if (typed) return typed;
  }
  return null;
}

/** Whether a thing's name is what `name` names: the same main noun, with every word of it; null when `name` names no thing. */
function namesThing(name: string): ((other: string) => boolean) | null {
  const said = itemName(name);
  if (!said) return null;
  return (other) => {
    const n = itemName(other);
    return n !== null && n.head === said.head && [...said.words].every((w) => n.words.has(w));
  };
}

/**
 * Whether an authored thing hidden from the POV (secret, or known only to others) goes by `name`,
 * a hidden quest key say: a claim of it would make a second one beside the one the story is
 * keeping back. A thing that is merely elsewhere isn't hidden, and a claim of it asks or adds as before.
 */
function hiddenBy(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string): boolean {
  const names = namesThing(name);
  if (!names) return false;
  return Object.keys(world.entities).some((id) => {
    const e = own(state.entities, id);
    return e !== undefined && !canSeeEntity(registry, world, state, world.pov, id) && !isGone(state, id) && kindIs(registry, world, e.kind, "item") && names(e.name);
  });
}

/**
 * What the POV may know that `name` names (the same main noun, with every word of it): a thing,
 * one it holds first, then one where it is, then by id; "place" for a place it can see, named in
 * full. A gone thing (a claimed coffee drunk) is none.
 */
function knownBy(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string, mayKnow: (id: EntityId) => boolean): EntityId | "place" | null {
  const said = itemName(name);
  const names = namesThing(name);
  if (!said || !names) return null;
  const here = placeOfEntity(state, world.pov);
  const rank = (id: EntityId): number => (isInside(state, id, world.pov) ? 0 : placeOfEntity(state, id) === here ? 1 : 2);
  const things = Object.keys(state.entities)
    .filter((id) => id !== world.pov && !isGone(state, id) && mayKnow(id) && names(own(state.entities, id)?.name ?? ""))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (things[0] !== undefined) return things[0];
  // A place only by every word of its name ("Bluebird Coffee", never "a coffee"): the reading put a place where a thing goes.
  const place = Object.values(world.places).some((p) => {
    const n = itemName(p.name);
    return n !== null && n.head === said.head && [...n.words].every((w) => said.words.has(w)) && canSeePlace(registry, world, state, world.pov, p.id);
  });
  return place ? "place" : null;
}

/** A gear item or container row the claimed thing is like, for its weight, size and wear slot: one whose noun it is, holding the most of its words, then by id. */
function gearRow(world: WorldDoc, name: string): string | undefined {
  const said = itemName(name);
  if (!said) return undefined;
  let best: { id: string; score: number } | undefined;
  for (const table of ["gear.items", "gear.containers"]) {
    for (const [id, row] of Object.entries(world.tables[table]?.rows ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const n = catalogName(id, typeof row.name === "string" ? row.name : id);
      if (!n.heads.has(said.head)) continue;
      const score = [...said.words].filter((w) => n.words.has(w)).length;
      if (!best || score > best.score) best = { id, score };
    }
  }
  return best?.id;
}

/**
 * What becomes of an action whose ref param names nothing that fits (`unfit`), as a claim: null
 * when it is none (its param takes no claims, holds no words the player typed, names a real thing
 * of another kind or a place, or the action names a person or place nothing has besides), and the
 * caller drops it as before. `said` holds the action's own words, then the message; `thing` is
 * the reading's word for what it is.
 */
export function claimFor(input: { registry: Registry; world: WorldDoc; state: Readonly<WorldState>; action: ActionDef; params: JsonObject; unfit: UnfitRef; said: readonly string[]; thing: ThingSort | undefined; policy: ClaimsPolicy; mayKnow: (id: EntityId) => boolean }): ClaimVerdict | null {
  const { registry, world, state, action, unfit, mayKnow } = input;
  const at = unfit.def.claim;
  const kind = unfit.def.ref ?? "item";
  if (!at || typeof unfit.value !== "string" || !kindIs(registry, world, kind, "item")) return null;
  // A hidden thing's id counts as nothing (it is absent as the POV sees it); a known one keeps its decline.
  if ((own(state.entities, unfit.value) && mayKnow(unfit.value)) || own(world.places, unfit.value)) return null;
  // A claim makes a thing, never a person or a place: the action's other params must fit.
  if (unfitRef(registry, action, input.params, world, state, mayKnow, unfit.param)) return null;
  const name = typedName(unfit.value, input.said);
  if (name === null) return null;
  const known = knownBy(registry, world, state, name, mayKnow);
  if (known === "place") return { kind: "hold" };
  if (known !== null) return { kind: "known", params: { ...input.params, [unfit.param]: known } };
  // Cash and accounts belong to the economy, whatever the preset.
  if (cashGift(name, world.currency) !== null || input.thing === "money") return { kind: "hold", reason: "money is never made from what you say you have" };
  // A hidden authored thing by those words is never made twice: the claim is declined as any is
  // under Hold me to the world, with the usual words, so nothing tells the player it exists.
  if (hiddenBy(registry, world, state, name)) return { kind: "hold" };
  const ctx = registry.context(world, state);
  if (input.policy.mode === "hold" || !optionalService(ctx, "gear.claim") || ctx.levelOf(world.pov, "gear") === 0) return { kind: "hold" };
  const here = placeOfEntity(state, world.pov);
  const row = matchCatalog(ctx, name, here);
  const category = row ? String(ctx.tables.get("economy.catalog")?.rows[row]?.category ?? "") : "";
  const price = row ? (priceOf(ctx, { catalog: row, place: here })?.unitCents ?? null) : null;
  // Food and drink by its catalog category, else by the reading's word for it.
  const consumable = row ? hasOwn(FOOD_AND_DRINK, category) : input.thing === "food" || input.thing === "drink";
  const like = gearRow(world, name);
  const claim: Claim = { param: unfit.param, name, at, kind, ...(row ? { catalog: row } : {}), ...(category !== "" ? { category } : {}), consumable, ...(like ? { like } : {}) };
  const cap = claimCap(world);
  const detail =
    input.policy.mode === "ask"
      ? "This chat asks before it adds what you say you have."
      : input.thing !== undefined && hasOwn(RESTRICTED, input.thing)
        ? "Keys, weapons and documents always ask first."
        : input.policy.capped && price !== null && price > cap
          ? `It costs about ${formatMoney(price, world.currency)}, over this world's ${formatMoney(cap, world.currency)} for what you say you have.`
          : null;
  if (detail === null) return { kind: "real", claim };
  const verb = (action.lexicon?.[0] ?? action.label).toLowerCase();
  return { kind: "ask", claim, question: `${name.charAt(0).toUpperCase()}${name.slice(1)} isn't in this world yet. Add it and ${verb} it?`, detail };
}
