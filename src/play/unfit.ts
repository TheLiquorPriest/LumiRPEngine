// Which reason a tap that picks what does not fit gets (plan §6.1: only an id that does not exist, or
// that his character cannot know of, and input that cannot be parsed are refused), case by case, as
// the first build's `unfitReason` gave it. The code picks the case and the names; the words are the
// lines of `.prompts/play-answers.md`. Nothing picked: it needs someone, a place or something. A person,
// place or thing he knows, of a kind the action cannot take: that it is not that kind, or, for a
// payment, not someone to pay. A payment that pays no one for a reason of its own: that reason.
// Anyone or anything else, unknown, made up or hidden alike: that it names no one, no place or nothing
// he knows, in his own words for it where he typed them. A hidden thing reads exactly as a made-up one,
// and a name that would give a secret away, or is longer than `taps.maxNameChars`, reads as naming no one.

import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { kindIs } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { canSeeEntity, canSeePlace, findLeaks } from "../engine/visibility";
import type { EntityId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import type { UnfitRef } from "./state/unfit-ref";

/** A line of the play answers, and the values it is filled with. */
export interface UnfitWords {
  line: string;
  fields: Record<string, string>;
}

/** Why a tap's pick does not fit, as a line of the play answers and its fields. */
export function unfitWords(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, unfit: UnfitRef, typed: string, secrets: readonly string[], mayKnow: (id: EntityId) => boolean, nameMost: number): UnfitWords {
  const { def, value } = unfit;
  const place = def.ref === "place";
  const person = !place && (def.ref !== undefined ? kindIs(reg, world, def.ref, "person") : def.outside !== undefined || (def.of?.kind ?? []).some((k) => kindIs(reg, world, k, "person")));
  const what = place ? "place" : person ? "someone" : "something";
  if (value === undefined || value === null || value === "") return { line: `needs_${what}`, fields: {} };
  const none: UnfitWords = { line: place ? "names_no_place" : person ? "names_no_one" : "names_nothing", fields: {} };
  if (unfit.reason !== undefined) return findLeaks(unfit.reason, secrets).length > 0 ? none : { line: "pays_no_one", fields: { why: unfit.reason } };
  const id = typeof value === "string" ? value : "";
  // Only a param of one kind, or one that pays, refuses a real thing he knows for being another.
  const real = own(state.entities, id);
  const seen = real !== undefined && canSeeEntity(reg, world, state, world.pov, id) ? real : undefined;
  const placeDef = seen !== undefined ? undefined : own(world.places, id);
  const known = seen !== undefined ? (mayKnow(id) ? seen.name : null) : placeDef !== undefined && canSeePlace(reg, world, state, world.pov, id) ? placeDef.name : null;
  if (known !== null && (def.ref !== undefined || def.outside !== undefined)) {
    if (known.length > nameMost || findLeaks(known, secrets).length > 0) return none;
    if (def.ref === undefined) return { line: "not_payee", fields: { name: known } };
    const kind = place ? "place" : (reg.kinds.get(def.ref)?.label ?? own(world.kinds, def.ref)?.label ?? def.ref).toLowerCase();
    return { line: "not_kind", fields: { name: known, kind } };
  }
  // Anything else reads as one nothing has, a hidden thing's id included, so the answer cannot tell him it exists: by his own words for
  // it where he typed them, an id's underscores read as spaces.
  const given = id.replace(/_+/g, " ").trim();
  const said = given === "" ? undefined : new RegExp(`(?<![\\p{L}\\p{N}])${given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").exec(typed)?.[0];
  if (said === undefined || said.length > nameMost) return none;
  return { line: `not_known_${what}`, fields: { name: said } };
}
