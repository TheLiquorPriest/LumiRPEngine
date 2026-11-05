// The GM view's world (DESIGN §7): everything as it stands, secrets and removed entities included,
// shaped for the GM editor: every entity with its fields as their definitions type them, its
// relations, levels, classes, tags and designed sheet, and whether the player claimed it into being;
// places with their visibility; tracks with every stage and truth; the relation types the editor
// can add; the world's facets, hidden ones too; everyone's money; and the routine roles the chat set.
// Read on request only, and it records nothing (L34): unopened accounts show the opening balances
// they'll start from.

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { lorePinsOf } from "../shared/lore";
import { DOMAINS, type KindId } from "../shared/ids";
import type { GmEntity, GmField, GmRosterEntry, GmView } from "../shared/state-view";
import { tiersInOrder } from "../shared/tiers";
import type { FieldDef, FieldType, WorldDoc } from "../shared/world";
import { BUILTIN_RELATIONS, ENGINE_FIELDS, GM_OWNER, GM_OWNER_NAME, lifeStateOf, lifeStatesOf } from "../shared/world";
import { PARTY_KINDS } from "../shared/finance";
import { fieldBounds } from "./effects";
import { optionalQuery, own } from "./pack-kit";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { lifeAwareness, lifeOf } from "./life";
import { buildEntitySheet, levelProgression } from "./ruleset";
import { fieldDef, GONE_FIELD, isGone, kindFields, kindIs, kindParent, placeOfEntity, scopeEnv } from "./scope";
import { classValues, tagsOf } from "./selector";
import type { WorldState } from "./state";
import { entityVisibility, isDiscoverable, knows } from "./visibility";

function fieldOf(reg: Registry, ctx: ReadContext, entity: string, kind: KindId, id: string, def: FieldDef, stored: JsonValue | undefined): GmField {
  const numeric = def.type === "number" || def.type === "money" || def.type === "duration";
  const derived = def.derived !== undefined;
  const read = derived ? scopeEnv({ reg, ctx, bindings: { self: entity } }).lookup(["self", id]) : undefined;
  // A progression's level follows its XP: shown with the field it follows, never edited itself.
  const prog = levelProgression(reg, ctx.world, kind, id);
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
    ...(prog ? { follows: fieldDef(reg, ctx.world, kind, prog.xpField)?.label ?? prog.xpField.replace(/_/g, " ") } : {}),
  };
}

function entityOf(reg: Registry, ctx: ReadContext, id: string): GmEntity | null {
  const { world, state } = ctx;
  const e = own(state.entities, id);
  if (!e) return null;
  const defs = kindFields(reg, world, e.kind);
  const fields: GmField[] = Object.entries(defs).map(([field, def]) => fieldOf(reg, ctx, id, e.kind, field, def, own(e.fields, field)));
  for (const [field, value] of Object.entries(e.fields)) {
    // The engine's own records of a span (the activity it was given for, a Speed through offered to
    // it): the GM edits the activity and its end, and an edit of the end stamps it (`resolveEdit`).
    if (field === GONE_FIELD || hasOwn(ENGINE_FIELDS, field) || own(defs, field)) continue;
    // A value the kind doesn't declare is edited as what it holds.
    fields.push({ id: field, label: field.replace(/_/g, " "), type: typeof value === "number" ? "number" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "list" : "text", value, extra: true });
  }
  const regard = optionalQuery(ctx, "regard");
  const life = lifeStateOf(world, lifeOf(state, id));
  const awareness = lifeAwareness(reg, world, state, id);
  const named = (ids: readonly string[]): { id: string; name: string }[] => ids.map((p) => ({ id: p, name: own(state.entities, p)?.name ?? p }));
  // What it can hold and where it may go (DESIGN §7), so Put inside offers only what makes sense; none without the gear pack.
  const containment = optionalQuery(ctx, "gear.containment")?.(ctx, id);
  return {
    id,
    name: e.name,
    kind: e.kind,
    tier: e.tier,
    agent: e.agent,
    pov: id === world.pov,
    person: kindIs(reg, world, e.kind, "person"),
    gone: isGone(state, id),
    spawned: !own(world.entities, id),
    // A discoverable thing reads as itself, with whether the player character has found it, not as the secret every other reader takes it for.
    ...(isDiscoverable(world, state, id) ? { visibility: "discoverable", found: knows(state, world.pov, id) } : { visibility: entityVisibility(world, state, id) }),
    place: placeOfEntity(state, id),
    holder: e.relations.find((r) => r.type === "in")?.to ?? null,
    ...(containment?.holds ? { holds: containment.holds } : {}),
    ...(containment && containment.goes !== "any" ? { goes: containment.goes } : {}),
    claimed: e.fields.claimed === true,
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

/**
 * One entity as GM → World's list shows it (`roster`): what `gmRosterEntry` keeps of its whole
 * entry, read without building its fields, relations, levels or sheet.
 */
function rosterOf(reg: Registry, ctx: ReadContext, id: string): GmRosterEntry | null {
  const { world, state } = ctx;
  const e = own(state.entities, id);
  if (!e) return null;
  const now = lifeOf(state, id);
  const life = lifeStateOf(world, now);
  const containment = optionalQuery(ctx, "gear.containment")?.(ctx, id);
  const discoverable = isDiscoverable(world, state, id);
  const visibility = discoverable ? "discoverable" : entityVisibility(world, state, id);
  const holder = e.relations.find((r) => r.type === "in")?.to ?? null;
  const tags = [...tagsOf(world, state, id)];
  return {
    id,
    name: e.name,
    kind: e.kind,
    tier: e.tier,
    place: placeOfEntity(state, id),
    ...(holder !== null ? { holder } : {}),
    ...(visibility !== "public" ? { visibility } : {}),
    ...(discoverable ? { found: knows(state, world.pov, id) } : {}),
    ...(now !== "alive" ? { life: { state: now, label: life.label, acts: life.acts } } : {}),
    ...(containment?.holds ? { holds: containment.holds } : {}),
    ...(containment && containment.goes !== "any" ? { goes: containment.goes } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(id === world.pov ? { pov: true as const } : {}),
    ...(kindIs(reg, world, e.kind, "person") ? { person: true as const } : {}),
    ...(e.agent ? { agent: true as const } : {}),
    ...(isGone(state, id) ? { gone: true as const } : {}),
    ...(!own(world.entities, id) ? { spawned: true as const } : {}),
    ...(e.fields.claimed === true ? { claimed: true as const } : {}),
  };
}

/** The parts of the GM view the world as it stands gives: all but the edits and the refused and held writes, which the chain and the journal hold, and the minds, which need the user's settings. */
export type GmWorldPart = Exclude<keyof GmView, "edits" | "refused" | "held" | "minds">;

/** Which items of a part to build: of the entities, the roster, the money and the organizations those `ids` name (in that order, any naming none left out); of the entities, the roster and the money those of `kind` (or a kind extending it). */
export interface GmPick {
  ids?: readonly string[];
  kind?: string;
}

/** The entities a pick names, in its order (else every entity in id order), of its kind when it names one. */
function picked(reg: Registry, ctx: ReadContext, pick: GmPick): string[] {
  const ids = pick.ids ? [...new Set(pick.ids)].filter((id) => own(ctx.state.entities, id)) : Object.keys(ctx.state.entities).sort();
  const kind = pick.kind;
  return kind === undefined ? ids : ids.filter((id) => kindIs(reg, ctx.world, own(ctx.state.entities, id)?.kind ?? "", kind));
}

/**
 * Each world part, built alone (`lre.gm.part`), in the view's order. With a pick (`GmPick`), of the
 * entities, the money and the organizations only those it names, of the entities and the money only
 * those of its kind; an organization named builds only its own page.
 */
const WORLD_PARTS: { [P in GmWorldPart]: (reg: Registry, ctx: ReadContext, pick: GmPick) => GmView[P] } = {
  entities: (reg, ctx, pick) => picked(reg, ctx, pick).flatMap((e) => entityOf(reg, ctx, e) ?? []),
  // The world's own kinds lie over built-in ones of the same id, as `kindParent` resolves them: its label, its Extends if it gives one.
  kinds: (reg, { world }) => {
    const kinds = new Map<string, { label: string; extends: string | null }>();
    for (const k of reg.kinds.values()) kinds.set(k.id, { label: k.label, extends: k.extends ?? null });
    for (const k of Object.values(world.kinds)) kinds.set(k.id, { label: k.label, extends: kindParent(reg, world, k.id) ?? null });
    return [...kinds].map(([id, k]) => ({ id, label: k.label, extends: k.extends })).sort((a, b) => a.label.localeCompare(b.label));
  },
  tiers: (_reg, { world }) => tiersInOrder(world).map(([id, t]) => ({ id, label: t.label })),
  lifeStates: (_reg, { world }) => lifeStatesOf(world).map(([id, def]) => ({ id, label: def.label, acts: def.acts })),
  domains: (reg) => DOMAINS.map((id) => ({ id, label: reg.packs.find((p) => p.domain === id)?.label ?? id })),
  classifications: (_reg, { world }) => world.classifications,
  places: (_reg, ctx) => {
    // Who may enter each place and whose it is (the orgs pack's GM → Places control).
    const entry = optionalQuery(ctx, "orgs.place_entry");
    return Object.values(ctx.world.places).map((p) => ({ id: p.id, name: p.name, visibility: p.visibility ?? "public", parent: p.parent ?? null, pins: own(lorePinsOf(ctx.world).places, p.id)?.length ?? 0, ...(entry ? { entry: entry(ctx, p.id) } : {}) }));
  },
  tracks: (_reg, { world, state }) =>
    Object.values(world.tracks).map((t) => ({
      id: t.id,
      label: t.label,
      kind: t.kind,
      visibility: t.visibility,
      owner: t.owner === GM_OWNER ? GM_OWNER_NAME : t.owner ? (own(state.entities, t.owner)?.name ?? t.owner) : null,
      stage: own(state.tracks, t.id)?.stage ?? t.start,
      stages: Object.entries(t.stages).map(([id, s]) => ({ id, label: s.label, ...(s.truth ? { truth: s.truth } : {}) })),
    })),
  relationTypes: (reg, { world }) => {
    const relationTypes = new Map<string, GmView["relationTypes"][number]>();
    for (const def of [...reg.relations.values(), ...Object.values(world.relations)]) {
      relationTypes.set(def.id, { id: def.id, label: def.label, from: def.from, to: def.to, fields: Object.entries(isRecord(def.fields) ? def.fields : {}).map(([id, f]) => ({ id, label: f.label ?? id.replace(/_/g, " "), type: f.type, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), ...(f.values ? { values: f.values } : {}) })) });
    }
    for (const id of BUILTIN_RELATIONS) if (!relationTypes.has(id)) relationTypes.set(id, { id, label: id.replace(/_/g, " "), from: "*", to: "*", fields: [] });
    return [...relationTypes.values()].sort((a, b) => a.label.localeCompare(b.label));
  },
  // Everyone's money as the economy pack's GM page builds it, of a kind's parties when a pick names one; or the parties a pick names, each built alone.
  money: (reg, ctx, pick) => {
    if (pick.ids === undefined) {
      const all = optionalQuery(ctx, "economy.people_money")?.(ctx) ?? [];
      const kind = pick.kind;
      return kind === undefined ? all : all.filter((m) => kindIs(reg, ctx.world, own(ctx.state.entities, m.party)?.kind ?? "", kind));
    }
    const finance = optionalQuery(ctx, "economy.finance");
    if (!finance) return [];
    return picked(reg, ctx, pick).flatMap((id) => {
      const e = own(ctx.state.entities, id);
      return e && PARTY_KINDS.some((k) => kindIs(reg, ctx.world, e.kind, k)) ? [finance(ctx, id, false)] : [];
    });
  },
  // Every organization as the GM sees it, with who holds each power there (the orgs pack's GM → Orgs); those a pick names, each built alone.
  orgs: (_reg, ctx, pick) => optionalQuery(ctx, "orgs.gm")?.(ctx, pick.ids) ?? [],
  // The fight under way, as only the GM sees it (the combat pack); its view model is plain JSON.
  encounter: (_reg, ctx) => (optionalQuery(ctx, "combat.gm")?.(ctx) ?? null) as unknown as JsonValue | null,
  routineRoles: (_reg, ctx) => optionalQuery(ctx, "castlife.chat_roles")?.(ctx) ?? [],
};

/** One world part of the GM view, built alone; with a pick, of the entities, money or organizations only those it names or of its kind. */
export function buildGmWorldPart<P extends GmWorldPart>(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, part: P, pick: GmPick = {}): GmView[P] {
  return WORLD_PARTS[part](reg, reg.context(world, state), pick);
}

/** The roster (`lre.gm.part` `roster`): every entity slim, in id order, or those a pick names or of its kind. */
export function buildGmRoster(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pick: GmPick = {}): GmRosterEntry[] {
  const ctx = reg.context(world, state);
  return picked(reg, ctx, pick).flatMap((id) => rosterOf(reg, ctx, id) ?? []);
}

/**
 * How many one world part of the GM view holds, for its outline (`GmOutline`): counted where the
 * part reads them, without building it (the entities, the kinds, tiers, life states and domains,
 * the facets, places, tracks and relation types); a part a pack builds (the money, the
 * organizations, the fight, the routine roles) built and counted.
 */
export function gmWorldPartCount(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, part: GmWorldPart): number {
  const ctx = reg.context(world, state);
  switch (part) {
    case "entities":
      return Object.keys(ctx.state.entities).length;
    case "kinds":
      return new Set([...[...reg.kinds.values()].map((k) => k.id), ...Object.values(world.kinds).map((k) => k.id)]).size;
    case "tiers":
      return tiersInOrder(world).length;
    case "lifeStates":
      return lifeStatesOf(world).length;
    case "domains":
      return DOMAINS.length;
    case "places":
      return Object.keys(ctx.world.places).length;
    case "tracks":
      return Object.keys(ctx.world.tracks).length;
    case "classifications":
      return Object.keys(ctx.world.classifications).length;
    case "relationTypes":
      return new Set([...[...reg.relations.values()].map((d) => d.id), ...Object.values(world.relations).map((d) => d.id), ...BUILTIN_RELATIONS]).size;
    default: {
      const value: unknown = WORLD_PARTS[part](reg, ctx, {});
      return Array.isArray(value) ? value.length : value === null ? 0 : 1;
    }
  }
}

/** Everything the GM view shows but its list of edits, which the chain holds, the refused and held writes, which the journal holds, and the minds, which need the user's settings. */
export function buildGmWorld(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): Pick<GmView, GmWorldPart> {
  const ctx = reg.context(world, state);
  return Object.fromEntries(Object.entries(WORLD_PARTS).map(([part, build]) => [part, build(reg, ctx, {})])) as Pick<GmView, GmWorldPart>;
}
