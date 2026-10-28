// Player claims at the read (DESIGN §9.4): what becomes of a typed action's ref param that names a
// thing the world doesn't have, as the POV sees it. Only a param that takes claims (`ParamDef.claim`)
// and holds words the player typed can be one. A thing the POV may know by those words keeps its
// own rules, and cash the player character carries is handed over as it is: to whom the action
// gives it, or, when the story hasn't established them, to the world's catch-all (DESIGN §9.4 typed
// money). The chat's policy decides the rest: made real, asked about first (under Make it real too,
// when its catalog price is over the world's claim cap under a capped policy, or it is money they
// lack, a key, a weapon or a document), or dropped to play as plain roleplay with its receipt.

import type { ClaimPlace, ClaimsPolicy } from "../shared/claims";
import type { ActionId, EntityId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { ActionDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { optionalQuery, optionalService, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { findAction } from "../engine/resolve";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { Claim, Needs } from "../engine/steps";
import { canSeePlace } from "../engine/visibility";
import { matchCatalog } from "../packs/economy/core/index";
import { catalogName, itemName } from "../packs/economy/core/items";
import { claimCap, FOOD_AND_DRINK, priceOf } from "../packs/economy/core/model";
import { cashGift } from "../packs/gear/core/index";
import { isInside } from "../packs/gear/core/model";
import type { ThingSort } from "./steps";
import { namesOf, paidOutside, takes, unfitRef, type UnfitRef } from "./turn-steps";

/**
 * An action that plays in the read's place, held to the needs of the one the player's words named
 * (`needs`, DESIGN §9.4), with the player's own words for a receiver it pays outside (`said`).
 */
type InPlace = { action: ActionId; params: JsonObject; needs: Needs; said?: Record<string, string> };

export type ClaimVerdict =
  /** A thing the POV may know goes by those words: the action takes it, and keeps its own rules. */
  | { kind: "known"; params: JsonObject }
  | { kind: "real"; claim: Claim }
  /**
   * The turn waits on the player's answer before anything is generated (Ask first, or Make it real
   * for money, a key, a weapon or a document, or over the cap). `play`: the action that plays in the
   * read's place once it is added (money is paid over with the economy's Pay).
   */
  | { kind: "ask"; claim: Claim; question: string; detail: string; play?: InPlace }
  /** Nothing to add: the read plays as another action the world can carry (money the player character carries, paid over with the economy's Pay in cash). */
  | { kind: "play"; play: InPlace }
  /** Dropped to play as plain roleplay, as under Hold me to the world. */
  | { kind: "hold" };

/** What `claimFor` judges: the read's action and params, its unfit param, and the chat's policy. */
interface ClaimInput {
  registry: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  action: ActionDef;
  params: JsonObject;
  unfit: UnfitRef;
  said: readonly string[];
  thing: ThingSort | undefined;
  policy: ClaimsPolicy;
  mayKnow: (id: EntityId) => boolean;
}

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

/**
 * What the POV may know that `name` names (the same main noun, with every word of it): a thing,
 * one it holds first, then one where it is, then by id; "place" for a place it can see, named in
 * full. A gone thing (a claimed coffee drunk) is none.
 */
function knownBy(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string, mayKnow: (id: EntityId) => boolean): EntityId | "place" | null {
  const said = itemName(name);
  if (!said) return null;
  const names = (other: string): boolean => {
    const n = itemName(other);
    return n !== null && n.head === said.head && [...said.words].every((w) => n.words.has(w));
  };
  const here = placeOfEntity(state, world.pov);
  const rank = (id: EntityId): number => (isInside(state, id, world.pov) ? 0 : placeOfEntity(state, id) === here ? 1 : 2);
  const things = Object.keys(state.entities)
    // The player character's own thing elsewhere isn't taken as is (the action would fail for want of it): it is a claim's (`mineByName`).
    .filter((id) => id !== world.pov && !isGone(state, id) && mayKnow(id) && !mineElsewhere(world, state, id, mayKnow) && names(own(state.entities, id)?.name ?? ""))
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
export function claimFor(input: ClaimInput): ClaimVerdict | null {
  const { registry, world, state, action, unfit, mayKnow } = input;
  const at = unfit.def.claim;
  const kind = unfit.def.ref ?? "item";
  if (!at || typeof unfit.value !== "string" || !kindIs(registry, world, kind, "item")) return null;
  // The player character's own thing, named by id (`outOfHand`), that the world has elsewhere.
  const named = mineElsewhere(world, state, unfit.value, mayKnow) ? unfit.value : null;
  // A hidden thing's id counts as nothing (it is absent as the POV sees it); a known one keeps its decline.
  if (!named && ((own(state.entities, unfit.value) && mayKnow(unfit.value)) || own(world.places, unfit.value))) return null;
  const name = named ? (own(state.entities, named)?.name ?? null) : typedName(unfit.value, input.said);
  // Money (a cash phrase, or the sort `money`) is the economy's, whatever the preset.
  const cash = name === null ? null : cashGift(name, world.currency);
  const money = name !== null && (cash !== null || input.thing === "money");
  // A claim makes a thing, never a person or a place: the action's other params must fit. Money is
  // handed over as the economy's Pay, so its recipient is judged as the Pay's receiver is (`asPaid`):
  // whomever the Pay pays fits (a party, a thing's owner, the world's catch-all, `moneyClaim`).
  if (unfitRef(registry, money ? asPaid(registry, world, action, unfit.param) : action, input.params, world, state, mayKnow, unfit.param)) return null;
  if (name === null) return null;
  const known = named ? null : knownBy(registry, world, state, name, mayKnow);
  if (known === "place") return { kind: "hold" };
  if (known !== null) return { kind: "known", params: { ...input.params, [unfit.param]: known } };
  const verb = (action.lexicon?.[0] ?? action.label).toLowerCase();
  if (money) return moneyClaim(input, at, kind, cash?.amount ?? null, verb);
  const ctx = registry.context(world, state);
  if (input.policy.mode === "hold" || !optionalService(ctx, "gear.claim") || ctx.levelOf(world.pov, "gear") === 0) return { kind: "hold" };
  const title = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  // A tracking gap, not a new thing: the player character's own thing the world has somewhere else
  // ("I put on my clothes" while the world keeps them at home). Made real, it is that very thing
  // brought to hand (`existing`), never a second one; the policy still decides, as for any claim.
  const existing = named ?? mineByName(registry, world, state, name, mayKnow);
  if (existing) {
    const claim: Claim = { param: unfit.param, name, at, kind, consumable: false, existing };
    const detail = input.policy.mode === "ask" ? "This chat asks before it changes where your things are." : input.thing !== undefined && hasOwn(RESTRICTED, input.thing) ? "Keys, weapons and documents always ask first." : null;
    return detail === null ? { kind: "real", claim } : { kind: "ask", claim, question: `${title} isn't with you as far as the world knows. Have it with you and ${verb} it?`, detail };
  }
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
  return { kind: "ask", claim, question: `${title} isn't in this world yet. Add it and ${verb} it?`, detail };
}

/**
 * Money the player says they have (DESIGN §9.4). It goes as the economy's Pay, in cash, to whom the
 * Pay pays the recipient the action gives it to (`paidOutside`, DESIGN §9.4 typed money): a party the
 * player character can see, a known thing's owner, else World, the world's catch-all. It goes only as
 * that action could: its needs on everything but the money still hold the Pay (`needs`) as it plays,
 * and on whom it went to only while the Pay pays the very one the read named and the action takes
 * them (Give's `at(to, here)` for a person), so cash goes only to someone here. A receiver paid in
 * another's place, or one the action doesn't take (a business, a thing's owner elsewhere, World), has
 * none: there is no one to hand it to, and the money goes all the same. Cash the player character
 * carries is no claim at all, so a Pay it covers plays as read, in every mode. Only what they lack is
 * asked about first, in every mode but Hold me to the world, as a key is, since it buys anything: Add
 * puts what their carried cash lacks of the amount in it as the Pay plays (`economy.claim_cash`), and
 * the Pay hands the whole amount over. Money said without an amount or given to no one, or in a world
 * that keeps no money for the player character, has nothing to carry it, and plays as plain roleplay.
 * The recipient and the amount live only in the Pay's params, which the needs and the claim read as
 * it plays (`shared`, `amountParam`), so the intent gate's Edit of either is what they hold it to.
 */
function moneyClaim(input: ClaimInput, at: ClaimPlace, kind: string, amount: number | null, verb: string): ClaimVerdict {
  const { registry, world, state, action, unfit } = input;
  const ctx = registry.context(world, state);
  const pay = findAction(registry, world, "pay");
  const to = recipientOf(registry, world, action, unfit.param);
  const recipient = to === undefined ? undefined : input.params[to];
  const cents = amount === null ? 0 : Math.round(amount * 10 ** world.currency.decimals);
  if (!pay || to === undefined || typeof recipient !== "string" || !(cents > 0) || !optionalService(ctx, "economy.claim_cash") || ctx.levelOf(world.pov, "money") === 0) return { kind: "hold" };
  // `said` ends with the player's message: the only words the card and the Outcome may name the receiver by.
  const paid = paidOutside(registry, pay, { to: recipient, amount: cents, method: "cash" }, world, state, input.mayKnow, input.said.at(-1) ?? "");
  const given = own(action.params, to);
  const named = pay.params.to ? namesOf(registry, world, state, pay.params.to, recipient, input.mayKnow) : null;
  const handed = named !== null && named === paid.params.to && given !== undefined && takes(registry, world, state, given, named);
  const needs: Needs = { action: action.id, params: Object.fromEntries(Object.entries(input.params).filter(([name]) => name !== unfit.param && name !== to)), shared: handed ? { [to]: "to" } : {} };
  const play: InPlace = { action: pay.id, params: paid.params, needs, ...(Object.keys(paid.said).length > 0 ? { said: paid.said } : {}) };
  const carried = Math.max(0, optionalQuery(ctx, "economy.carried_cash")?.(ctx, world.pov) ?? 0);
  if (carried >= cents) return { kind: "play", play };
  if (input.policy.mode === "hold") return { kind: "hold" };
  const money = formatMoney(cents, world.currency);
  const added = formatMoney(cents - carried, world.currency);
  return {
    kind: "ask",
    claim: { param: unfit.param, name: added, at, kind, consumable: false, cents, amountParam: "amount" },
    question: carried > 0 ? `Only ${formatMoney(carried, world.currency)} of the ${money} is with you as far as the world knows. Add the other ${added} and ${verb} it?` : `${money} in cash isn't with you as far as the world knows. Add it and ${verb} it?`,
    detail: "Money you say you have and don't carry always asks first.",
    play,
  };
}

/** The param a money claim's recipient fills (`moneyClaim`): the action's first person ref but the claim's own. */
function recipientOf(registry: Registry, world: WorldDoc, action: ActionDef, claim: string): string | undefined {
  return Object.entries(action.params).find(([name, def]) => name !== claim && def.type === "ref" && def.ref !== undefined && kindIs(registry, world, def.ref, "person"))?.[0];
}

/**
 * `action` with the param a money claim's recipient fills judged as the economy's Pay judges its
 * receiver (DESIGN §9.4 typed money): any party the POV may know, a known thing's owner, or Pay's
 * outside account for a receiver the story hasn't established, as the Pay that plays in the action's
 * place pays them (`moneyClaim`).
 */
function asPaid(registry: Registry, world: WorldDoc, action: ActionDef, claim: string): ActionDef {
  const to = recipientOf(registry, world, action, claim);
  const paid = findAction(registry, world, "pay")?.params.to;
  return to === undefined || paid === undefined || own(action.params, to) === undefined ? action : { ...action, params: { ...action.params, [to]: paid } };
}

/**
 * Whether `id` is the player character's own thing that the world has neither on them nor where they
 * stand, and one the POV may know: a secret or undiscovered thing of theirs is no tracking gap, it is
 * absent, so a guess at it plays as a made-up claim does and tells nothing.
 */
function mineElsewhere(world: WorldDoc, state: Readonly<WorldState>, id: string, mayKnow: (id: EntityId) => boolean): boolean {
  const e = own(state.entities, id);
  return e !== undefined && id !== world.pov && !isGone(state, id) && mayKnow(id) && e.fields.owner === world.pov && !isInside(state, id, world.pov) && placeOfEntity(state, id) !== placeOfEntity(state, world.pov);
}

/** The player character's own thing elsewhere that `name` names (the same main noun, with every word of it), the first by id; none when none does. */
function mineByName(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string, mayKnow: (id: EntityId) => boolean): EntityId | null {
  const said = itemName(name);
  if (!said) return null;
  const fits = Object.keys(state.entities)
    .filter((id) => mineElsewhere(world, state, id, mayKnow) && kindIs(registry, world, own(state.entities, id)?.kind ?? "", "item"))
    .filter((id) => {
      const n = itemName(own(state.entities, id)?.name ?? "");
      return n !== null && n.head === said.head && [...said.words].every((w) => n.words.has(w));
    })
    .sort();
  return fits[0] ?? null;
}

/**
 * A claim param (DESIGN §9.4) that names, by id, the player character's own thing the world has
 * elsewhere: the action would fail only for want of it in hand (or here), a gap in what the engine
 * tracks, so it goes to the claims policy (`claimFor`) rather than stopping the message. Null when none does.
 */
export function outOfHand(action: ActionDef, params: JsonObject, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean): UnfitRef | null {
  for (const [param, def] of Object.entries(action.params)) {
    const value = params[param];
    if (def.type === "ref" && def.claim && typeof value === "string" && mineElsewhere(world, state, value, mayKnow)) return { param, def, value };
  }
  return null;
}
