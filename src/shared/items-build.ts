// Build's helpers for authoring things (DESIGN §13): the "Reveal this item" scaffold that hides a
// thing until it is searched for (§7 discoverable things); the item checks a quest's objectives test
// (`carries`, `has_item`, `at`); what keeps a thing where it is (§7 containment), which the engine
// and the pickers both read; and what a catalog type makes a thing (`typeFields`), for a thing made
// in play and one added in Build.

import type { JsonObject, JsonValue } from "./json";
import { hasOwn, isRecord } from "./json";
import type { DataTable, TableRow } from "./tables";
import { isSize } from "./things";
import type { KindDef } from "./world";

/** Why a thing stays where it is (DESIGN §7): it is a vehicle, a part built into one, or fixed in place. */
export type FixedReason = "vehicle" | "part" | "fixed";

/**
 * What keeps a thing where it is, as the world declares it (DESIGN §7): a vehicle (`isVehicle`, from
 * its kind); a part built into what holds it, marked so (`part`, ITEMS-SPEC §3.2) or with a catalog
 * row in the world's Containers table that is `vehicle_fixed` (a truck bed, a glovebox, a boat's
 * lockers); or a thing marked `fixed` (a mill stone, an installed relay). Null for a thing that can be
 * picked up. Never read from its name.
 */
export function fixedReason(isVehicle: boolean, fields: JsonObject, tables: Readonly<Record<string, DataTable>>): FixedReason | null {
  if (isVehicle) return "vehicle";
  if (fields.fixed === true) return "fixed";
  if (fields.part === true) return "part";
  const catalog = fields.catalog;
  const rows = hasOwn(tables, "gear.containers") ? tables["gear.containers"]?.rows : undefined;
  const row = rows && typeof catalog === "string" && hasOwn(rows, catalog) ? rows[catalog] : undefined;
  return row?.location === "vehicle_fixed" ? "part" : null;
}

/** The tables a thing's type (`catalog`) names a row of, in the order a type is looked up: the gear tables first. */
export const TYPE_TABLES = ["gear.items", "gear.containers", "economy.catalog"] as const;
export type TypeTable = (typeof TYPE_TABLES)[number];

/**
 * What a thing of a catalog type is (ITEMS-SPEC §3.1): a container for a row of the Containers table,
 * or a row with a capacity or a size it holds (a refrigerator, a wardrobe), else an item; and the
 * fields its row fills: the type itself, its category, the slot it is worn in, and its weight,
 * volume and room (a container's empty weight as its weight).
 */
export function typeFields(table: TypeTable, id: string, row: Readonly<TableRow>): { kind: "item" | "container"; fields: JsonObject } {
  const fields: JsonObject = { catalog: id };
  if (typeof row.category === "string") fields.category = row.category;
  if (typeof row.equip_slot === "string" && row.equip_slot !== "none") fields.slot = row.equip_slot;
  for (const key of ["weight_g", "volume_l", "capacity_l", "max_load_kg"] as const) {
    const v = row[key];
    if (typeof v === "number") fields[key] = v;
  }
  if (typeof row.empty_weight_g === "number") fields.weight_g = row.empty_weight_g;
  return { kind: table === "gear.containers" || typeof row.capacity_l === "number" || isSize(row.holds) ? "container" : "item", fields };
}

/** Whether `kind` is a thing (an item, or a kind that extends one), by the world's kinds and the packs'. */
export function isItemKind(kinds: Readonly<Record<string, KindDef>>, kind: string): boolean {
  let cur: string | undefined = kind;
  for (let guard = 0; cur && guard < 32; guard++) {
    if (cur === "item") return true;
    cur = hasOwn(kinds, cur) ? kinds[cur]?.extends : undefined;
  }
  return false;
}

/**
 * "Reveal this item": the thing, made `discoverable`, so it stays hidden until the player character
 * searches where it lies, or opens the container it is in, with the built-in Search. It must lie
 * somewhere first (a place, or in a container or on someone): a thing nowhere can never be found.
 * Its Known by stays, granting it as for a `known_by` thing. A secret thing is made discoverable too:
 * that is what the author asked for.
 */
export function revealScaffold(entity: JsonObject): { entity: JsonObject } | { problem: string } {
  const fields = isRecord(entity.fields) ? entity.fields : {};
  const placed = typeof fields.place === "string" && fields.place !== "";
  const held = Array.isArray(entity.relations) && entity.relations.some((r: JsonValue) => isRecord(r) && r.type === "in" && typeof r.to === "string" && r.to !== "");
  if (!placed && !held) return { problem: "Put it somewhere first: a place, or in a container or on someone." };
  return { entity: { ...entity, visibility: "discoverable" } };
}

/** The item checks an objective can make: the player character has it with them, has one like it, or it lies at a place. */
export type ItemCheck = "carries" | "has_item" | "at";

/** A thing or place an item check names: its id for the condition, its name for the label. */
export interface Named {
  id: string;
  name: string;
}

/**
 * An objective testing a thing (DESIGN §10): a label the player reads in their quests, `label` or a
 * plain one from the check ("Have the spare relay with you"), and its condition, `carries(pov, 'id')`,
 * `has_item(pov, 'id')` or `at('id', 'place')`. Ids go in as quoted literals, which the quest-id lint checks.
 */
export function itemObjective(check: ItemCheck, item: Named, place: Named | null = null, label = ""): { label: string; when: string } {
  // World ids are plain keys (no quotes or backslashes), so a literal holds them as they are.
  const quote = (s: string): string => `'${s}'`;
  const when = check === "at" ? `at(${quote(item.id)}, ${quote(place?.id ?? "")})` : `${check}(pov, ${quote(item.id)})`;
  return { label: label.trim() !== "" ? label.trim() : itemObjectiveLabel(check, item, place), when };
}

/** The plain label an item check reads as when the author gives none. */
export function itemObjectiveLabel(check: ItemCheck, item: Named, place: Named | null = null): string {
  // "Spare relay" reads as "the spare relay"; a name that starts with a proper noun ("Rosie's keys") keeps its capital.
  const thing = /^[A-Z][a-z]/.test(item.name) && !/^[A-Z][a-z]*'/.test(item.name) ? item.name.charAt(0).toLowerCase() + item.name.slice(1) : item.name;
  if (check === "carries") return `Have the ${thing} with you`;
  if (check === "has_item") return `Have a ${thing}`;
  return `Get the ${thing} to ${place?.name ?? "the place"}`;
}
