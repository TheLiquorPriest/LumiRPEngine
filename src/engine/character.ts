// Characters as their own model (DESIGN §7, the Character model): one pure builder for Build's
// Character page, from the draft world (where the world starts them), and for GM's Character
// sheet, from a chat's head world and state (where they are now, and what they're doing). Both are
// author or GM views, so every place and person is in it with its visibility; nothing is hidden.

import type { CharacterBed, CharacterDTO, CharacterField, CharacterNow, CharacterResult, CharacterSection, PlaceRef, ThingRef, VisibilityValue } from "../shared/character";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId } from "../shared/ids";
import { PARTY_RELATION } from "../shared/party";
import { ALIVE, lifeStateOf, type FieldDef, type RelationInstance, type WorldDoc } from "../shared/world";
import { calendarOf, formatStamp, placeOffset } from "./calendar";
import { lifeOf } from "./life";
import { own } from "./pack-kit";
import type { Registry } from "./registry-impl";
import { isGone, kindDef, kindFields, kindIs } from "./scope";
import type { WorldState } from "./state";

/** What the builder reads of an entity: the draft's definition and the state's entity alike. */
interface Body {
  kind: string;
  name: string;
  tier: string;
  fields: JsonObject;
  relations: readonly RelationInstance[];
}

/** The section each person field belongs to; a field not named here is the kind's own (identity) or advanced. */
const SECTION_OF: Record<string, CharacterSection["id"]> = {
  birthday: "identity",
  occupation: "identity",
  region: "identity",
  wealth: "identity",
  place: "where",
  home: "where",
  bed: "where",
  scene: "where",
  activity: "day",
  appointments: "day",
  trips: "day",
  chores: "day",
  employer: "work",
  pay_prefs: "work",
  filing_status: "work",
  local_tax: "work",
  conditions: "stats",
};

const SECTION_ORDER: readonly CharacterSection["id"][] = ["identity", "where", "day", "work", "stats", "advanced"];

/** What the story holds, in words: the place they stay at, the activity they keep. */
const HOLD_WORDS: Record<string, string> = { place: "Stays where they are", activity: "Keeps doing what they're doing" };

/** A thing a person may sleep in or on, by its name or its catalog id. */
const BEDLIKE = /\b(bed|beds|bunk|cot|futon|couch|sofa|hammock|sleeping[ _-]?bag)\b/i;

/** Every place as a picker shows it, by id. */
export function placeRefs(world: Pick<WorldDoc, "places">): Map<PlaceId, PlaceRef> {
  const out = new Map<PlaceId, PlaceRef>();
  const pathOf = (id: PlaceId): string[] => {
    const names: string[] = [];
    let cur = own(world.places, id)?.parent;
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      const p = own(world.places, cur);
      if (!p) break;
      names.unshift(p.name);
      cur = p.parent;
    }
    return names;
  };
  for (const id of Object.keys(world.places).sort()) {
    const p = own(world.places, id);
    if (!p) continue;
    out.set(id, { id, name: p.name, path: pathOf(id), parent: p.parent !== undefined && own(world.places, p.parent) ? p.parent : null, visibility: p.visibility ?? "public" });
  }
  return out;
}

/** The place an entity stands at: its own, else its holder's (`in`), outermost first. */
function placeOf(bodies: Readonly<Record<EntityId, Body>>, id: EntityId): PlaceId | null {
  let cur: EntityId | undefined = id;
  for (let guard = 0; cur !== undefined && guard < 32; guard++) {
    const e: Body | undefined = own(bodies, cur);
    if (!e) return null;
    const p = e.fields.place;
    if (typeof p === "string" && p !== "") return p;
    cur = e.relations.find((r) => r.type === "in")?.to;
  }
  return null;
}

/** A label in plain words: a trailing parenthesised hint ("Birthday (MM-DD or YYYY-MM-DD)") moves to help. */
export function plainLabel(raw: string): { label: string; help?: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw);
  return m && m[1] !== undefined && m[1].trim() !== "" && m[2] !== undefined ? { label: m[1].trim(), help: m[2].trim() } : { label: raw };
}

function words(id: string): string {
  const text = id.replace(/[_-]+/g, " ").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : id;
}

/**
 * A person, as Build's Character page (no `state`: the draft world as it starts them) or GM's
 * Character sheet (the chat's head `state`: where they are now, and `now`) reads them, with every
 * place and thing for the pickers; null for an entity that isn't a person.
 */
export function buildCharacter(reg: Registry, world: WorldDoc, id: EntityId, state?: Readonly<WorldState>): CharacterResult | null {
  const bodies: Readonly<Record<EntityId, Body>> = state ? state.entities : world.entities;
  const e = own(bodies, id);
  if (!e || !kindIs(reg, world, e.kind, "person")) return null;
  const refs = placeRefs(world);
  const placeRef = (place: unknown): PlaceRef | null => (typeof place === "string" ? (refs.get(place) ?? null) : null);
  const gone = (thing: EntityId): boolean => (state ? isGone(state, thing) : false);
  const thingRef = (thing: unknown): ThingRef | null => {
    if (typeof thing !== "string") return null;
    const t = own(bodies, thing);
    return t ? { id: thing, name: t.name, kind: t.kind, place: placeRef(placeOf(bodies, thing)) } : null;
  };
  // A thing one can sleep in or on is an item (furniture, a sleeping bag, a van): never an account,
  // a job or a property deed, which the world also files as things.
  const isItem = (thing: Body): boolean => kindIs(reg, world, thing.kind, "item");
  const things: ThingRef[] = Object.keys(bodies)
    .sort()
    .flatMap((thing) => {
      const t = own(bodies, thing);
      const ref = t && isItem(t) && !gone(thing) ? thingRef(thing) : null;
      return ref ? [ref] : [];
    });

  const home = placeRef(e.fields.home);
  const bedValue = e.fields.bed;
  const bed: CharacterBed = typeof bedValue === "string" && own(world.places, bedValue) ? { kind: "place", place: placeRef(bedValue), item: null } : typeof bedValue === "string" && own(bodies, bedValue) ? { kind: "item", place: placeRef(placeOf(bodies, bedValue)), item: thingRef(bedValue) } : { kind: "home", place: home, item: null };

  const holder = e.relations.find((r) => r.type === "in")?.to;
  const def = kindDef(reg, world, e.kind);
  const pov = id === world.pov;
  const lifeId = state ? lifeOf(state, id) : (own(world.entities, id)?.life ?? ALIVE);
  const life = lifeId === ALIVE ? null : { state: lifeId, label: lifeStateOf(world, lifeId).label };
  const visibility: VisibilityValue = own(world.entities, id)?.visibility ?? "public";
  const character: CharacterDTO = {
    id,
    name: e.name,
    kind: { id: e.kind, label: def?.label ?? words(e.kind) },
    tier: { id: e.tier, label: own(world.tiers, e.tier)?.label ?? words(e.tier) },
    pov,
    agent: state ? (own(state.entities, id)?.agent ?? false) : (own(world.entities, id)?.agent ?? false),
    life,
    visibility,
    place: placeRef(state ? placeOf(bodies, id) : e.fields.place),
    inside: holder !== undefined ? thingRef(holder) : null,
    home,
    bed,
    bedChoices: bedChoices(bodies, refs, typeof e.fields.home === "string" ? e.fields.home : null, isItem, gone),
    employer: thingRef(e.fields.employer),
    ...(state ? { now: nowOf(world, state, id) } : {}),
    sections: sectionsOf(reg, world, e),
  };
  return { character, places: [...refs.values()], things };
}

/**
 * Where the bed picker looks first: the places in their home's subtree, nearest first, each with its
 * path from the home; and the things lying there, the likeliest beds first (a name or a catalog id
 * that says bed, bunk, cot, futon, couch, sofa, hammock or sleeping bag), then by name.
 */
function bedChoices(bodies: Readonly<Record<EntityId, Body>>, refs: ReadonlyMap<PlaceId, PlaceRef>, home: PlaceId | null, isItem: (b: Body) => boolean, gone: (id: EntityId) => boolean): CharacterDTO["bedChoices"] {
  const homeRef = home !== null ? refs.get(home) : undefined;
  if (home === null || !homeRef) return { places: [], items: [] };
  // Each place under the home, with how deep under it and its names from the home down.
  const under = new Map<PlaceId, { depth: number; path: string[] }>([[home, { depth: 0, path: [] }]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const ref of refs.values()) {
      const parent = ref.parent !== null ? under.get(ref.parent) : undefined;
      if (!parent || under.has(ref.id)) continue;
      const parentName = refs.get(ref.parent ?? "")?.name ?? "";
      under.set(ref.id, { depth: parent.depth + 1, path: [...parent.path, parentName] });
      grew = true;
    }
  }
  const places = [...under]
    .filter(([id]) => id !== home)
    .sort((a, b) => a[1].depth - b[1].depth || (refs.get(a[0])?.name ?? "").localeCompare(refs.get(b[0])?.name ?? ""))
    .flatMap(([id, at]) => {
      const ref = refs.get(id);
      return ref ? [{ ...ref, path: at.path }] : [];
    });
  const bedlike = (b: Body): boolean => BEDLIKE.test(b.name) || (typeof b.fields.catalog === "string" && BEDLIKE.test(b.fields.catalog.replace(/_/g, " ")));
  const items = Object.keys(bodies)
    .flatMap((id): { ref: ThingRef; likely: boolean }[] => {
      // Things lying there themselves: not what someone carries, nor what's packed inside another thing.
      const t = own(bodies, id);
      const at = t && isItem(t) && !gone(id) && typeof t.fields.place === "string" ? t.fields.place : null;
      if (!t || at === null || !under.has(at)) return [];
      return [{ ref: { id, name: t.name, kind: t.kind, place: refs.get(at) ?? null }, likely: bedlike(t) }];
    })
    .sort((a, b) => Number(b.likely) - Number(a.likely) || a.ref.name.localeCompare(b.ref.name) || (a.ref.id < b.ref.id ? -1 : 1))
    .map((x) => x.ref);
  return { places, items };
}

/** What the GM sees of them now: their activity until when, whether they travel with the POV, and what the story holds. */
function nowOf(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): CharacterNow {
  const e = own(state.entities, id);
  const cal = calendarOf(world);
  const where = typeof e?.fields.place === "string" ? e.fields.place : null;
  const when = (t: unknown): string | null => (typeof t === "number" && t > state.clock ? formatStamp(cal, t, placeOffset(world, t, where)) : null);
  const activity = typeof e?.fields.activity === "string" ? e.fields.activity : "idle";
  const holds = isRecord(e?.fields.holds) ? e.fields.holds : {};
  return {
    activity,
    activityLabel: words(activity),
    until: when(e?.fields.activity_until),
    party: e?.relations.some((r) => r.type === PARTY_RELATION && r.to === world.pov) ?? false,
    holds: Object.keys(holds)
      .sort()
      .flatMap((field) => {
        const until = when(holds[field]);
        return until !== null ? [{ label: HOLD_WORDS[field] ?? words(field), until }] : [];
      }),
  };
}

/** Their fields by section: the kind's own world-authored fields as who they are, the person fields where they belong, the rest advanced. */
function sectionsOf(reg: Registry, world: WorldDoc, e: Body): CharacterSection[] {
  const defs = kindFields(reg, world, e.kind);
  // Fields a world kind of theirs authors itself (not a pack's): who this kind of person is; and the
  // sheet's numbers, as any kind in the chain files them (a world kind re-declaring Charm keeps it a stat).
  const authored = new Set<string>();
  const sheet = new Set<string>();
  for (let id: string | undefined = e.kind, guard = 0; id && guard < 32; guard++) {
    const k = kindDef(reg, world, id);
    if (k && own(world.kinds, id) && k.pack === undefined) for (const f of Object.keys(k.fields)) authored.add(f);
    for (const [f, d] of Object.entries(k?.fields ?? {})) if (d.domain === "sheets" && d.type === "number") sheet.add(f);
    id = k?.extends;
  }
  const sections = new Map<CharacterSection["id"], CharacterField[]>(SECTION_ORDER.map((s) => [s, []]));
  const ids = [...new Set([...Object.keys(defs), ...Object.keys(e.fields)])];
  for (const field of ids) {
    const def = own(defs, field);
    const section: CharacterSection["id"] = def?.locked || def?.derived !== undefined ? "advanced" : (SECTION_OF[field] ?? (sheet.has(field) ? "stats" : authored.has(field) ? "identity" : "advanced"));
    sections.get(section)?.push(fieldOf(field, def, own(e.fields, field)));
  }
  return SECTION_ORDER.map((id) => ({ id, fields: sections.get(id) ?? [] }));
}

function fieldOf(id: string, def: FieldDef | undefined, stored: JsonValue | undefined): CharacterField {
  const { label, help } = plainLabel(def?.label ?? words(id));
  const type = def?.type ?? (typeof stored === "number" ? "number" : typeof stored === "boolean" ? "bool" : Array.isArray(stored) ? "list" : "text");
  // A list's items: the kind's type, else text when every stored item is text (traits a kind left
  // untyped), so a list of text is edited as its items, never as JSON; a list of shapes (pay_prefs)
  // says none, and its own editor reads it.
  const of = type === "list" ? (def?.of ?? (Array.isArray(stored) && stored.length > 0 && stored.every((x) => typeof x === "string") ? "text" : undefined)) : undefined;
  return {
    id,
    label,
    type,
    value: stored ?? def?.default ?? null,
    ...(def?.values ? { values: [...def.values] } : {}),
    ...(def?.min !== undefined ? { min: def.min } : {}),
    ...(def?.max !== undefined ? { max: def.max } : {}),
    ...(def?.ref !== undefined ? { ref: def.ref } : {}),
    ...(of !== undefined ? { of } : {}),
    ...(def?.locked || def?.derived !== undefined ? { locked: true } : {}),
    ...(help !== undefined ? { help } : {}),
  };
}
