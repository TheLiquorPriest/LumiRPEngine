// A thing as the sections name it for the narrator (DESIGN §6.11): its name, a count above one, a
// kit's pieces present, and what the player character may see of it: each field its kind defines,
// by the kind's label, and its description. Only fields the thing has set, live at the player
// character's level in their domain and visible to him (`canSeeField`), so a detail never tells
// what he can't know. Pure.

import type { EntityId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { formatMoney, type FieldDef } from "../shared/world";
import { fieldNoun } from "../shared/words";
import { optionalQuery, own, rowOf } from "./pack-kit";
import type { ReadContext } from "./registry";
import { bandOf, kindParent } from "./scope";
import { canSeeEntity, canSeeField, canSeePlace } from "./visibility";

/**
 * Fields a detail never tells: where a thing is, whose it is and how many (each line tells those its
 * own way), its description (told after its details), the gear pack's load bookkeeping (weights,
 * volumes, capacities and its catalog category, which the engine checks and the narrator needn't
 * weigh) and the engine's own bookkeeping.
 */
const UNTOLD: Readonly<Record<string, true>> = { place: true, x: true, y: true, owner: true, qty: true, description: true, notable: true, catalog: true, category: true, slot: true, weight_g: true, volume_l: true, capacity_l: true, max_load_kg: true, overdue: true, piece: true, from_kit: true, stock: true, kit: true, pieces: true, piece_count: true };

/** A kind's fields in the order a line tells them: its own first, as defined, then each ancestor's; at each step the world's kind over the pack's. */
function fieldsInOrder(ctx: ReadContext, kind: string): [string, FieldDef][] {
  const out = new Map<string, FieldDef>();
  let id: string | undefined = kind;
  for (let guard = 0; id !== undefined && guard < 32; guard++) {
    const mine = own(ctx.world.kinds, id);
    const pack = ctx.registry.kinds.get(id);
    if (!mine && !pack) break;
    for (const [field, def] of [...Object.entries(mine?.fields ?? {}), ...Object.entries(pack?.fields ?? {})]) if (!out.has(field)) out.set(field, def);
    id = kindParent(ctx.registry, ctx.world, id);
  }
  return [...out];
}

/** A number as a line says it: a measure with its unit (thousands grouped), else as it is ("2017"). */
function numberWords(v: number, unit: string): string {
  const r = Math.round(v * 100) / 100;
  return `${unit !== "" && Number.isInteger(r) && Math.abs(r) >= 1000 ? r.toLocaleString("en-US") : String(r)}${unit}`;
}

/** A field's value in words, as the player character may know it; "" for a set flag, which its label alone says; null for nothing to tell. */
function valueWords(ctx: ReadContext, def: FieldDef, unit: string, v: JsonValue | undefined): string | null {
  const pov = ctx.world.pov;
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? "" : null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (def.type === "money") return formatMoney(v, ctx.world.currency);
    return bandOf(def.bands, v)?.label ?? numberWords(v, unit);
  }
  if (typeof v === "string") {
    const text = v.replace(/\s+/g, " ").trim();
    if (text === "") return null;
    if (def.type === "ref") {
      // A place or someone named only as he may know them; anything else isn't told.
      const place = own(ctx.world.places, text);
      if (place) return canSeePlace(ctx.registry, ctx.world, ctx.state, pov, text) ? place.name : null;
      const e = own(ctx.state.entities, text);
      return e && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, text) ? e.name : null;
    }
    if (def.table) {
      const row = rowOf(ctx, def.table, text);
      const name = row?.name ?? row?.label;
      if (typeof name === "string" && name.trim() !== "") return name.trim();
    }
    // An enum value or a code-like word (`needs_service`) reads as words ("needs service").
    return def.type === "enum" || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(text) ? text.replace(/_/g, " ") : text;
  }
  if (Array.isArray(v)) {
    const words = v.map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : typeof x === "number" && Number.isFinite(x) ? String(x) : ""));
    return words.length > 0 && words.every((w) => w !== "") ? words.join(", ") : null;
  }
  return null;
}

/**
 * Each detail of a thing the player character may see, as `label value` in its kind's own labels
 * ("condition worn", "odometer 96,400 mi", "year 2017", "fixed in place"): every field of its kind
 * it has set, but those a line tells its own way (`UNTOLD`) and those the caller `omit`s, live at
 * his level in its domain, that he may see.
 */
export function thingDetails(ctx: ReadContext, id: EntityId, omit: (field: string, def: FieldDef) => boolean = () => false): string[] {
  const pov = ctx.world.pov;
  const e = own(ctx.state.entities, id);
  if (!e) return [];
  const out: string[] = [];
  for (const [field, def] of fieldsInOrder(ctx, e.kind)) {
    if (UNTOLD[field] || def.derived !== undefined || omit(field, def)) continue;
    if (def.domain && ctx.levelOf(pov, def.domain) < (def.level ?? 1)) continue;
    if (!canSeeField(ctx.registry, ctx.world, ctx.state, pov, id, field)) continue;
    const { noun, unit } = fieldNoun(def.label, field);
    const words = valueWords(ctx, def, unit, own(e.fields, field));
    if (words !== null) out.push(words === "" ? noun : `${noun} ${words}`);
  }
  return out;
}

/** A thing's description, when it has one the player character may see. */
export function thingDescription(ctx: ReadContext, id: EntityId): string | null {
  const text = own(ctx.state.entities, id)?.fields.description;
  if (typeof text !== "string" || !canSeeField(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id, "description")) return null;
  const words = text.replace(/\s+/g, " ").trim();
  return words === "" ? null : words;
}

/** From Gear 3 (the player character's, unless `gearLevel` says whose), a kit's pieces present: "44 of its 45 pieces". */
function kitWords(ctx: ReadContext, id: EntityId, gearLevel: number): string | null {
  const kit = gearLevel >= 3 ? (optionalQuery(ctx, "gear.kit_status")?.(ctx, id) ?? null) : null;
  return kit ? `${kit.present} of its ${kit.total} pieces` : null;
}

/** A thing's name with a count above one ("Flare ×3"). */
function countedName(ctx: ReadContext, id: EntityId): string {
  const e = own(ctx.state.entities, id);
  if (!e) return id;
  const qty = typeof e.fields.qty === "number" ? e.fields.qty : 1;
  return `${e.name}${qty > 1 ? ` ×${qty}` : ""}`;
}

/** A thing's name as a line names it: a count above one, and a kit's pieces present (`kitWords`). */
export function thingName(ctx: ReadContext, id: EntityId, gearLevel: number = ctx.levelOf(ctx.world.pov, "gear")): string {
  const kit = kitWords(ctx, id, gearLevel);
  return `${countedName(ctx, id)}${kit ? ` (${kit})` : ""}`;
}

/**
 * A thing whole, as a section lists it for the narrator: `Name ×2 (kit; lead; details): description`,
 * the caller's `lead` (whose it is, where it is) before its details.
 */
export function thingText(ctx: ReadContext, id: EntityId, lead: readonly string[] = []): string {
  const kit = kitWords(ctx, id, ctx.levelOf(ctx.world.pov, "gear"));
  const parts = [...(kit ? [kit] : []), ...lead, ...thingDetails(ctx, id)];
  const description = thingDescription(ctx, id);
  return `${countedName(ctx, id)}${parts.length > 0 ? ` (${parts.join("; ")})` : ""}${description ? `: ${description}` : ""}`;
}

/** A line ended as a sentence: a full stop unless it already ends in one. */
export function sentence(text: string): string {
  return /[.!?…]["')\]]?$/.test(text) ? text : `${text}.`;
}
