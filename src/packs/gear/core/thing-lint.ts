// The things lint (ITEMS-SPEC §3.2, §10.1 Problems), read as a chat would start: an authored thing
// where the size rules never let play put one (on a person above the person ceiling, or in a holder
// smaller than it), each with the fix Problems makes in one press; a thing both lying at a place and
// in a holder, kept where play reads it; and, as a note, an authored thing whose size nothing gives.
// Pure.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { JsonPatchOp, LintFix, LintIssue } from "../../../shared/protocol";
import { pointerOf } from "../../../shared/json-patch";
import type { Size, SizeClass } from "../../../shared/things";
import { SIZE_LABELS, sizeRank, thingsConfigOf } from "../../../shared/things";
import type { WorldDoc } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import type { LintRule, ReadContext } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import { holdsOf, isThing, sizeOf } from "../../../engine/things";
import { initialState } from "../../../engine/world-state";

/** The issue codes the rule reports. */
export const THING_LINT = { tooBig: "gear.too_big", twoPlaces: "gear.two_places", sizeUnknown: "gear.size_unknown" } as const;

/**
 * Whether a thing of `size` may rest in a holder taking up to `holds`, as an op's size rules have it:
 * a part or a Built-in thing is part of what holds it, a vehicle goes only on a vehicle, and a size
 * nothing gives counts as fitting.
 */
function fits(size: SizeClass, holds: Size, vehicleHolder: boolean): boolean {
  if (size === "unknown" || size === "part" || size === "builtin") return true;
  if (size === "vehicle") return vehicleHolder;
  return sizeRank(size) <= sizeRank(holds);
}

/** The draft patch that puts authored thing `id` at `place`: out of `holder` (its `in`, and off it when worn), lying there. */
function putAt(world: WorldDoc, id: EntityId, holder: EntityId | null, place: PlaceId): JsonPatchOp[] {
  const relations = own(world.entities, id)?.relations ?? [];
  const out: JsonPatchOp[] = [];
  // Highest index first, so each removal leaves the next one's index as it was.
  for (let i = relations.length - 1; i >= 0; i--) {
    const r = relations[i];
    if (r && (r.type === "in" || ((r.type === "worn_by" || r.type === "equipped") && r.to === holder))) out.push({ op: "remove", path: pointerOf(["entities", id, "relations", String(i)]) });
  }
  return [...out, { op: "add", path: pointerOf(["entities", id, "fields", "place"]), value: place }];
}

/** Where a thing too big for a person goes: their home, else where the story starts them. */
function personPlace(ctx: ReadContext, person: EntityId): PlaceId | null {
  const f = own(ctx.world.entities, person)?.fields;
  for (const v of [f?.home, f?.place]) if (typeof v === "string" && own(ctx.world.places, v)) return v;
  return null;
}

function check(world: WorldDoc, registry: Registry): LintIssue[] {
  const ctx = registry.context(world, initialState(world, "", registry));
  const ceiling = thingsConfigOf(world).sizes.ceiling;
  const issues: LintIssue[] = [];
  const placeName = (place: PlaceId): string => own(world.places, place)?.name ?? place;
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    if (!e || !isThing(ctx, id)) continue;
    const size = sizeOf(ctx, id).size;
    const holder = e.relations.find((r) => r.type === "in")?.to ?? null;
    const place = typeof e.fields.place === "string" && e.fields.place !== "" ? e.fields.place : null;
    if (place !== null && holder !== null) {
      const fix: LintFix | undefined = own(world.places, place) ? { label: `Keep it at ${placeName(place)}`, ops: putAt(world, id, holder, place) } : undefined;
      issues.push({ severity: "warning", code: THING_LINT.twoPlaces, path: `entities.${id}`, message: `${e.name} lies at ${placeName(place)} and is in ${own(world.entities, holder)?.name ?? holder} at once; play reads it at ${placeName(place)}.${fix ? ` Keep it there?` : ""}`, ...(fix ? { fix } : {}) });
    } else if (holder !== null) {
      const h = own(ctx.state.entities, holder);
      const holds = holdsOf(ctx, holder);
      if (h && holds !== null && !fits(size, holds, kindIs(registry, world, h.kind, "vehicle"))) {
        const person = kindIs(registry, world, h.kind, "person");
        const to = person ? personPlace(ctx, holder) : placeOfEntity(ctx.state, holder);
        const fix: LintFix | undefined = to !== null ? { label: `Put it at ${placeName(to)}`, ops: putAt(world, id, holder, to) } : undefined;
        const big = size === "unknown" || size === "part" || size === "vehicle" ? null : size;
        const why = big === null ? `${e.name} is ${person ? "on" : "in"} ${h.name}: a vehicle goes only on another vehicle.` : person ? `${e.name} is on ${h.name}: too big to carry (${SIZE_LABELS[big]}; a person carries up to ${SIZE_LABELS[ceiling]}).` : `${e.name} is in ${h.name}: too big for it (${h.name} takes things up to ${SIZE_LABELS[holds]}).`;
        issues.push({ severity: "warning", code: THING_LINT.tooBig, path: `entities.${id}`, message: `${why}${to !== null ? ` Put it at ${placeName(to)}?` : ""}`, ...(fix ? { fix } : {}) });
      }
    }
    if (size === "unknown") issues.push({ severity: "info", code: THING_LINT.sizeUnknown, path: `entities.${id}.fields.size`, message: `${e.name} has no size, and nothing gives one (its type, volume or category), so play treats it as portable. Give it a size on its page.` });
  }
  return issues;
}

/** The things lint, one rule: its issues are `THING_LINT`'s codes. */
export const THING_LINTS: readonly LintRule[] = [{ code: "gear.things", check: (world, registry) => (registry ? check(world, registry) : []) }];
