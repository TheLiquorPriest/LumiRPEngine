// The GM view's world (DESIGN §7): everything as it stands, secrets and removed entities included,
// shaped for the GM editor: every entity with its fields as their definitions type them, its
// relations, levels, classes, tags and designed sheet; places with their visibility; tracks with
// every stage and truth; the relation types the editor can add; the world's facets, hidden ones
// too; and everyone's money. Read on request only, and it records nothing (L34): unopened accounts
// show the opening balances they'll start from.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { DOMAINS } from "../shared/ids";
import type { GmEntity, GmField, GmView } from "../shared/state-view";
import { tiersInOrder } from "../shared/tiers";
import type { FieldDef, FieldType, WorldDoc } from "../shared/world";
import { BUILTIN_RELATIONS, lifeStateOf, lifeStatesOf } from "../shared/world";
import { fieldBounds } from "./effects";
import { optionalQuery, own } from "./pack-kit";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { lifeAwareness, lifeOf } from "./life";
import { buildEntitySheet } from "./ruleset";
import { GONE_FIELD, isGone, kindFields, placeOfEntity, scopeEnv } from "./scope";
import { classValues, tagsOf } from "./selector";
import type { WorldState } from "./state";
import { entityVisibility } from "./visibility";

function fieldOf(reg: Registry, ctx: ReadContext, entity: string, id: string, def: FieldDef, stored: JsonValue | undefined): GmField {
  const numeric = def.type === "number" || def.type === "money" || def.type === "duration";
  const derived = def.derived !== undefined;
  const read = derived ? scopeEnv({ reg, ctx, bindings: { self: entity } }).lookup(["self", id]) : undefined;
  return {
    id,
    label: def.label ?? id.replace(/_/g, " "),
    type: def.type,
    value: derived ? (read ?? null) : (stored ?? def.default ?? null),
    ...(def.values ? { values: def.values } : {}),
    ...(numeric ? fieldBounds(reg, ctx, entity, def) : {}),
    ...(def.ref ? { ref: def.ref } : {}),
    ...(derived ? { derived: true as const } : {}),
    ...(def.locked ? { locked: true as const } : {}),
  };
}

function entityOf(reg: Registry, ctx: ReadContext, id: string): GmEntity | null {
  const { world, state } = ctx;
  const e = own(state.entities, id);
  if (!e) return null;
  const defs = kindFields(reg, world, e.kind);
  const fields: GmField[] = Object.entries(defs).map(([field, def]) => fieldOf(reg, ctx, id, field, def, own(e.fields, field)));
  for (const [field, value] of Object.entries(e.fields)) {
    if (field === GONE_FIELD || own(defs, field)) continue;
    // A value the kind doesn't declare is edited as what it holds.
    fields.push({ id: field, label: field.replace(/_/g, " "), type: typeof value === "number" ? "number" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "list" : "text", value, extra: true });
  }
  const regard = optionalQuery(ctx, "regard");
  const life = lifeStateOf(world, lifeOf(state, id));
  const awareness = lifeAwareness(reg, world, state, id);
  const named = (ids: readonly string[]): { id: string; name: string }[] => ids.map((p) => ({ id: p, name: own(state.entities, p)?.name ?? p }));
  return {
    id,
    name: e.name,
    kind: e.kind,
    tier: e.tier,
    agent: e.agent,
    pov: id === world.pov,
    gone: isGone(state, id),
    spawned: !own(world.entities, id),
    visibility: entityVisibility(world, state, id),
    place: placeOfEntity(state, id),
    holder: e.relations.find((r) => r.type === "in")?.to ?? null,
    ...(own(state.accounts, id) !== undefined ? { balance: own(state.accounts, id) } : {}),
    fields,
    relations: e.relations.map((r) => ({
      type: r.type,
      to: r.to,
      toName: own(state.entities, r.to)?.name ?? r.to,
      ...(r.fields ? { fields: r.fields } : {}),
      ...(r.until !== undefined ? { until: r.until } : {}),
      // A regard's value as the relationships pack reads it now (decayed at level 4), NPC↔NPC included.
      ...(r.type === "regard" && regard && own(state.entities, r.to) ? { value: Math.round(regard(ctx, id, r.to) * 10) / 10 } : {}),
    })),
    levels: DOMAINS.map((domain) => ({ domain, level: ctx.levelOf(id, domain), override: e.levels[domain] ?? null })),
    class: Object.fromEntries(
      Object.keys(world.classifications).flatMap((facet) => {
        const values = classValues(world, state, id, facet);
        return values.length > 0 ? [[facet, [...values]]] : [];
      }),
    ),
    tags: [...tagsOf(world, state, id)],
    sheet: buildEntitySheet(ctx, id),
    life: { state: lifeOf(state, id), label: life.label, acts: life.acts, everyone: awareness.everyone, aware: named(awareness.aware), unaware: named(awareness.unaware) },
  };
}

/** Everything the GM view shows but its list of edits, which the chain holds, and the minds, which need the user's settings. */
export function buildGmWorld(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): Omit<GmView, "edits" | "refused" | "minds"> {
  const ctx = reg.context(world, state);
  const relationTypes = new Map<string, GmView["relationTypes"][number]>();
  for (const def of [...reg.relations.values(), ...Object.values(world.relations)]) {
    relationTypes.set(def.id, { id: def.id, label: def.label, from: def.from, to: def.to, fields: Object.entries(isRecord(def.fields) ? def.fields : {}).map(([id, f]) => ({ id, label: f.label ?? id.replace(/_/g, " "), type: f.type, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), ...(f.values ? { values: f.values } : {}) })) });
  }
  for (const id of BUILTIN_RELATIONS) if (!relationTypes.has(id)) relationTypes.set(id, { id, label: id.replace(/_/g, " "), from: "*", to: "*", fields: [] });
  // The world's own kinds override built-in ones of the same id, as `kindDef` resolves them.
  const kinds = new Map<string, { label: string; extends: string | null }>();
  for (const k of reg.kinds.values()) kinds.set(k.id, { label: k.label, extends: k.extends ?? null });
  for (const k of Object.values(world.kinds)) kinds.set(k.id, { label: k.label, extends: k.extends ?? null });
  return {
    entities: Object.keys(state.entities)
      .sort()
      .flatMap((id) => entityOf(reg, ctx, id) ?? []),
    kinds: [...kinds].map(([id, k]) => ({ id, label: k.label, extends: k.extends })).sort((a, b) => a.label.localeCompare(b.label)),
    tiers: tiersInOrder(world).map(([id, t]) => ({ id, label: t.label })),
    lifeStates: lifeStatesOf(world).map(([id, def]) => ({ id, label: def.label, acts: def.acts })),
    domains: DOMAINS.map((id) => ({ id, label: reg.packs.find((p) => p.domain === id)?.label ?? id })),
    classifications: world.classifications,
    places: Object.values(world.places).map((p) => ({ id: p.id, name: p.name, visibility: p.visibility ?? "public", parent: p.parent ?? null })),
    tracks: Object.values(world.tracks).map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      visibility: t.visibility,
      owner: t.owner ? (own(state.entities, t.owner)?.name ?? t.owner) : null,
      stage: own(state.tracks, t.id)?.stage ?? t.start,
      stages: Object.entries(t.stages).map(([id, s]) => ({ id, label: s.label, ...(s.truth ? { truth: s.truth } : {}) })),
    })),
    relationTypes: [...relationTypes.values()].sort((a, b) => a.label.localeCompare(b.label)),
    money: optionalQuery(ctx, "economy.people_money")?.(ctx) ?? [],
    // The fight under way, as only the GM sees it (the combat pack); its view model is plain JSON.
    encounter: (optionalQuery(ctx, "combat.gm")?.(ctx) ?? null) as unknown as JsonValue | null,
  };
}
