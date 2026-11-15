// What a typed read of an action names that nothing fits (DESIGN §9.4), for the panels' taps and
// for the ways the engine reads a player's words: the first ref param that names nothing real the
// POV may know of, who a param that pays pays in place of what it names, and why it pays no one.

import { optionalQuery } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import { outsideOf } from "../../engine/resolve";
import { kindIs } from "../../engine/scope";
import { selectorMatches } from "../../engine/selector";
import type { WorldState } from "../../engine/state";
import { canSeeEntity, canSeePlace } from "../../engine/visibility";
import type { EntityId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, safeKey } from "../../shared/json";
import type { ActionDef, ParamDef, WorldDoc } from "../../shared/world";

/**
 * A ref param of `interpret`'s read that names nothing that fits (`unfitRef`): its name, its
 * definition and what it held; for a param that pays, why it pays no one when the receiver isn't the
 * reason (`reason`: "it needs an amount", "Piggy bank is yours"), which its receipt gives as is.
 */
export interface UnfitRef {
  param: string;
  def: ParamDef;
  value: JsonValue | undefined;
  reason?: string;
}

/**
 * The first ref param of `interpret`'s params that doesn't name the right real thing, or null when
 * every one does: an entity of the param's kind (with inheritance), or a place where the param takes
 * places. Typed text that names nothing that fits ("I take the cash" when cash is an account, not an
 * item) is roleplay for the narrator and `extract`, not an action that would fail; its reply says why
 * on a decline chip (DESIGN §9.4). An entity the POV may not know of (`mayKnow`), or a place it
 * can't see, counts as nothing: a guessed id of a hidden thing must read as one nothing has, or the
 * outcome would tell the player it exists.
 *
 * A param that pays (`ParamDef.outside`, DESIGN §9.4 typed money) takes the parties its selector
 * names that the POV can see (`seesParty`, as the Money views name a payee), wherever they are, and
 * never a place. On the read (`outside`), one it pays someone else for in place of what it names fits
 * too (`payeeOf`): the read pays them (`paidOutside`), while a request from the player's own surfaces
 * names whom they picked. A payment missing another detail its action needs pays no one, and so does
 * money put in the player character's own thing, which stays theirs; each says why (`reason`).
 */
export function unfitRef(registry: Registry, action: ActionDef, params: JsonObject, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean, skip?: string, outside = true): UnfitRef | null {
  for (const [name, def] of Object.entries(action.params)) {
    // `skip`: a param a claim fills (DESIGN §9.4), so only the action's others are judged.
    if (def.type !== "ref" || name === skip) continue;
    const value = params[name];
    if (unset(value)) {
      if (!def.optional) return { param: name, def, value };
      continue;
    }
    if (!safeKey(value)) return { param: name, def, value };
    if (def.outside !== undefined) {
      if (outside && payeeOf(registry, action, params, def, value, world, state, mayKnow) !== null) continue;
      // A party it can see is paid as named, once the payment has all it needs; without an amount it plays as roleplay, saying so (`unpaidWhy`).
      if (takes(registry, world, state, def, value) && seesParty(registry, world, state, value) && missingOf(action, params) === null) continue;
      const reason = unpaidWhy(registry, action, params, def, value, world, state, mayKnow);
      return { param: name, def, value, ...(reason !== null ? { reason } : {}) };
    }
    const entity = hasOwn(state.entities, value) ? state.entities[value] : undefined;
    if (entity) {
      if (!mayKnow(value) || (def.ref && !kindIs(registry, world, entity.kind, def.ref))) return { param: name, def, value };
      continue;
    }
    if (!hasOwn(world.places, value) || (def.ref !== undefined && def.ref !== "place") || !canSeePlace(registry, world, state, world.pov, value)) return { param: name, def, value };
  }
  return null;
}

/** Whether a param holds nothing: absent, null or empty text. */
export function unset(value: JsonValue | undefined): value is undefined | null | "" {
  return value === undefined || value === null || value === "";
}

/** Whether ref param `def` takes entity `id`: one of its kind (with inheritance) that its selector (`of`) names. */
export function takes(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, def: ParamDef, id: string): boolean {
  const entity = hasOwn(state.entities, id) ? state.entities[id] : undefined;
  return entity !== undefined && (def.ref === undefined || kindIs(registry, world, entity.kind, def.ref)) && (def.of === undefined || selectorMatches(registry, world, state, def.of, id));
}

/**
 * Whether the POV can see party `id` (`canSeeEntity`): the bar the Money views and the palette's
 * requests hold a payee to, so the player character's employer, or a business it has heard of, is
 * someone to pay from wherever it stands. Someone hidden is no one to pay.
 */
export function seesParty(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, id: string): boolean {
  return id === world.pov || canSeeEntity(registry, world, state, world.pov, id);
}

/** The first detail `action` needs that `params` leaves out, besides a param that pays, in words for a receipt ("an amount"); null when none is. */
function missingOf(action: ActionDef, params: JsonObject): string | null {
  const name = Object.keys(action.params).find((n) => {
    const p = action.params[n];
    return p !== undefined && !p.optional && p.outside === undefined && unset(params[n]);
  });
  if (name === undefined) return null;
  const def = action.params[name];
  return def?.type === "money" ? "an amount" : `a ${(def?.label ?? name.replace(/_/g, " ")).toLowerCase()}`;
}

/**
 * Whom ref param `def` of `action` pays in place of `value` (`ParamDef.outside`, DESIGN §9.4 typed
 * money), or null when the param's own rules judge it. What the value names is what the POV knows it
 * as: an id, else the one party or thing its words name in full (`namedBy`: "Alder Automotive", "the
 * tip jar"), else no one.
 * - A party the param takes that the POV can see (`seesParty`): themselves (null when the read gave
 *   their id); one it can't, the outside account, as one nothing has.
 * - No one and nothing the POV may know (`mayKnow`), and no place it can see: a thing nothing lists,
 *   a name nothing has, the outside account itself, or a guessed id of someone hidden, which reads as
 *   one nothing has. The outside account.
 * - A thing or a place the POV knows: whoever it belongs to (`economy.payee_of`, so the shop's tip
 *   jar pays the shop) when the param takes them and the POV can see them, else the outside account,
 *   so money given to it never vanishes. Money put in the player character's own thing stays theirs:
 *   null, so it plays as roleplay (`unpaidWhy`).
 *
 * A read missing another detail its action needs gets null too: with no amount there's no payment.
 */
export function payeeOf(registry: Registry, action: ActionDef, params: JsonObject, def: ParamDef, value: JsonValue | undefined, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean): string | null {
  const account = outsideOf(def);
  if (account === null || !safeKey(value)) return null;
  if (value === account) return account;
  if (missingOf(action, params) !== null) return null;
  const named = namesOf(registry, world, state, def, value, mayKnow);
  if (named === null) return account;
  if (hasOwn(state.entities, named)) {
    if (takes(registry, world, state, def, named)) return !seesParty(registry, world, state, named) ? account : named === value ? null : named;
    if (!mayKnow(named)) return account;
  } else if (!canSeePlace(registry, world, state, world.pov, named)) return account;
  const owner = ownerOf(registry, world, state, named);
  if (owner === world.pov) return null;
  return owner !== null && takes(registry, world, state, def, owner) && seesParty(registry, world, state, owner) ? owner : account;
}

/** Whoever a thing or a place belongs to, as money given to it goes (`economy.payee_of`): null for neither, or in a world without money. */
function ownerOf(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, id: string): EntityId | null {
  const ctx = registry.context(world, state);
  return optionalQuery(ctx, "economy.payee_of")?.(ctx, id) ?? null;
}

/** What a paying param's `value` names: the entity or place its id is, else the one its words name in full (`namedBy`); null for none. */
export function namesOf(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, def: ParamDef, value: string, mayKnow: (id: EntityId) => boolean): string | null {
  return hasOwn(state.entities, value) || hasOwn(world.places, value) ? value : namedBy(registry, world, state, def, value, mayKnow);
}

/**
 * The one entity whom or which `words` name in full (case, spacing and a leading "the" aside: "Alder
 * Automotive", "the tip jar") that paying param `def` may name as the POV knows it: a party it takes
 * that the POV can see, or a thing it may know (`mayKnow`); null for none or for several. It finds a
 * receiver the read gave in the input's own words, as the catalog lists only the scene's parties.
 * Someone or something hidden never matches, so its name reads as one nothing has.
 */
function namedBy(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, def: ParamDef, words: string, mayKnow: (id: EntityId) => boolean): EntityId | null {
  const plain = (text: string): string => text.toLowerCase().replace(/[_\s]+/g, " ").trim().replace(/^the /, "");
  const said = plain(words);
  if (said === "") return null;
  const fits = Object.keys(state.entities).filter((id) => plain(state.entities[id]?.name ?? "") === said && (takes(registry, world, state, def, id) ? seesParty(registry, world, state, id) : mayKnow(id)));
  return fits.length === 1 ? (fits[0] ?? null) : null;
}

/**
 * Why paying param `def` pays no one for `value` when that isn't for want of a receiver, in words for
 * its receipt (DESIGN §9.4 typed money), or null: another detail the action needs is missing ("it
 * needs an amount"), or what it names is the player character's own thing, so the money stays theirs
 * ("Piggy bank is yours").
 */
function unpaidWhy(registry: Registry, action: ActionDef, params: JsonObject, def: ParamDef, value: string, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean): string | null {
  const missing = missingOf(action, params);
  if (missing !== null) return `it needs ${missing}`;
  const named = namesOf(registry, world, state, def, value, mayKnow);
  const thing = named !== null && hasOwn(state.entities, named) && mayKnow(named) ? state.entities[named] : undefined;
  return thing && named !== null && ownerOf(registry, world, state, named) === world.pov ? `${thing.name} is yours` : null;
}
