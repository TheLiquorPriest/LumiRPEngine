// Characters as their own model (DESIGN §7, the Character model): one pure builder for Build's
// Character page, from the draft world (where the world starts them), and for GM's Character
// sheet, from a chat's head world and state (where they are now, and what they're doing). Both are
// author or GM views, so every place and person is in it with its visibility; nothing is hidden.

import type { CharacterBed, CharacterDTO, CharacterField, CharacterNow, CharacterRelation, CharacterResult, CharacterSchedule, CharacterSection, PlaceRef, ThingRef, VisibilityValue } from "../shared/character";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId } from "../shared/ids";
import { PARTY_RELATION } from "../shared/party";
import { ALIVE, lifeStateOf, type FieldDef, type Recurrence, type RelationInstance, type RelationTypeDef, type ScheduleDef, type ScheduleSlot, type WorldDoc } from "../shared/world";
import { calendarOf, formatStamp, formatTimeOfDay, placeOffset, weekdayName } from "./calendar";
import { lifeOf } from "./life";
import { optionalQuery, own } from "./pack-kit";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { allSchedules, scheduleOwners } from "./schedules";
import { isGone, kindDef, kindFields, kindIs } from "./scope";
import type { WorldState } from "./state";
import { initialState } from "./world-state";

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

/**
 * The places a player may pick, as a picker shows them on a player surface (the place ✎ fixes):
 * those `known` says the POV may know, in id order, each with its path through known places only,
 * cut at the first one it may not know (so nothing around it is named), its parent only when known,
 * and every one as public, since Play never shows how hidden a place really is.
 */
export function knownPlaceRefs(world: Pick<WorldDoc, "places">, known: (id: PlaceId) => boolean): PlaceRef[] {
  const out: PlaceRef[] = [];
  for (const id of Object.keys(world.places).sort()) {
    const p = own(world.places, id);
    if (!p || !known(id)) continue;
    const path: string[] = [];
    let cur = p.parent;
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      const up = own(world.places, cur);
      if (!up || !known(cur)) break;
      path.unshift(up.name);
      cur = up.parent;
    }
    const parent = p.parent !== undefined && own(world.places, p.parent) && known(p.parent) ? p.parent : null;
    out.push({ id, name: p.name, path, parent, visibility: "public" });
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
  // Build has no chat: its schedules and regard are read from the world as a chat would start. A
  // draft is mid-edit, so a start or an epoch that doesn't parse yet leaves out only what reads the
  // clock (schedules and regard), never the page.
  const read = state ?? startState(reg, world);
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
    schedules: read ? schedulesOf(reg, world, read, id) : [],
    relations: relationsOf(reg, world, read ? reg.context(world, read) : null, id, e),
    ...(state ? { now: nowOf(world, state, id) } : {}),
    sections: sectionsOf(reg, world, e),
  };
  return { character, places: [...refs.values()], things };
}

/** The state a chat would start with, or none while the draft's clock (its start or epoch) doesn't parse. */
function startState(reg: Registry, world: WorldDoc): WorldState | null {
  try {
    calendarOf(world);
    return initialState(world, "character", reg);
  } catch {
    return null;
  }
}

/** The days a recurrence runs, in words ("Weekdays", "Every day", "Mon, Wed and Fri", "On the 1st"). */
function daysWords(world: WorldDoc, r: Recurrence): string {
  const cal = calendarOf(world);
  if (r.every === "day") return "Every day";
  if (r.every === "year") return "Every year";
  if (r.every === "month") return r.days && r.days.length > 0 ? `On the ${list(r.days.map(ordinal))} of the month` : "Every month";
  const days = [...new Set(r.weekdays ?? [])].sort((a, b) => a - b);
  const key = days.join(",");
  if (days.length === 0 || days.length === 7) return "Every day";
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return list(days.map((d) => weekdayName(cal, d).slice(0, 3)));
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" }) as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
}

function list(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** A slot's value in words: a place by its name, else the value as words; a weighted slot's options joined by "or". */
function slotValue(world: WorldDoc, target: string, slot: ScheduleSlot): string {
  const one = (v: JsonValue | undefined): string => (target === "place" && typeof v === "string" && own(world.places, v) ? (own(world.places, v)?.name ?? v) : typeof v === "string" ? v : v === undefined || v === null ? "nothing" : JSON.stringify(v));
  if (slot.weighted && slot.weighted.length > 0) {
    const options = [...new Set(slot.weighted.map((w) => one(w.value)))];
    return options.length <= 1 ? (options[0] ?? "nothing") : `${options.slice(0, -1).join(", ")} or ${options.at(-1) ?? ""}`;
  }
  return one(slot.value);
}

/** A schedule in words, from its days and slots: "Weekdays 6:30 AM–12:00 PM: Alder Automotive, 12:00 PM–12:45 PM: The Rusty Anchor". */
export function scheduleSummary(world: WorldDoc, s: Pick<ScheduleDef, "target" | "recurrence" | "slots">): string {
  const time = (hhmm: string): string => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    return m ? formatTimeOfDay(Number(m[1]) * 60 + Number(m[2])) : hhmm;
  };
  const slots = s.slots.map((slot) => `${time(slot.start)}–${time(slot.end)}: ${slotValue(world, s.target, slot)}`);
  return `${daysWords(world, s.recurrence)} ${slots.join(", ")}`.trim();
}

/** The schedules that apply to them (their own, a group's, a kind's or a selector's), each labelled in words. */
function schedulesOf(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): CharacterSchedule[] {
  return allSchedules(reg, world)
    .filter((s) => s.owner !== undefined && scheduleOwners(reg, world, state, s).includes(id))
    .map((s) => {
      const summary = scheduleSummary(world, s);
      const own_ = (s as ScheduleDef & { label?: unknown }).label;
      return { id: s.id, label: typeof own_ === "string" && own_.trim() !== "" ? own_.trim() : summary, summary };
    });
}

/** Relation fields that are bookkeeping, never words (regard's last-touched time). */
const RELATION_INTERNAL = new Set(["t"]);

/**
 * Their relations as words, each with who it's to: regard in the world's band words ("warm"), any
 * other by its own fields ("Role: Owner, Rank: 1"). Containment and the party are where they are
 * and who they travel with, shown apart. Without a state (a draft whose clock doesn't parse) regard
 * reads by its fields too.
 */
function relationsOf(reg: Registry, world: WorldDoc, ctx: ReadContext | null, from: EntityId, e: Body): CharacterRelation[] {
  const types = new Map<string, RelationTypeDef>([...reg.relations.values(), ...Object.values(world.relations)].map((d) => [d.id, d]));
  const band = ctx ? optionalQuery(ctx, "regard_band") : undefined;
  return e.relations
    .filter((r) => r.type !== "in" && r.type !== PARTY_RELATION)
    .map((r) => {
      const def = types.get(r.type);
      const fieldDefs = isRecord(def?.fields) ? def.fields : {};
      const words_ =
        r.type === "regard" && band && ctx
          ? band(ctx, from, r.to)
          : Object.entries(r.fields ?? {})
              .filter(([k, v]) => !RELATION_INTERNAL.has(k) && v !== null && v !== "")
              .map(([k, v]) => `${own(fieldDefs, k)?.label ?? words(k)}: ${typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)}`)
              .join(", ");
      const to = (ctx ? own(ctx.state.entities, r.to) : undefined) ?? own(world.entities, r.to);
      return { type: r.type, to: { id: r.to, name: to?.name ?? own(world.places, r.to)?.name ?? r.to }, words: words_ };
    });
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
    sections.get(section)?.push(fieldOf(world, field, def, own(e.fields, field)));
  }
  return SECTION_ORDER.map((id) => ({ id, fields: sections.get(id) ?? [] }));
}

/** Words shared by a field's label and a table's, so "Occupation" and "Occupations" read as the same thing. */
function stems(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).map((w) => w.replace(/(ies|es|s)$/, "")));
}

function fieldOf(world: WorldDoc, id: string, def: FieldDef | undefined, stored: JsonValue | undefined): CharacterField {
  const plain = plainLabel(def?.label ?? words(id));
  const label = plain.label;
  const table = def?.table !== undefined ? own(world.tables, def.table) : undefined;
  const tableWords = table ? stems(table.label) : new Set<string>();
  const labelWords = stems(label);
  // The table tells something only when its name doesn't already say what the field is: "Occupations
  // and pay" for Occupation says nothing more; "Riverton districts" for Region does.
  const tells = table !== undefined && ![...labelWords].every((w) => tableWords.has(w));
  // A label's hint stays when it is words ("MM-DD or YYYY-MM-DD"); a shape ({use, min?, …}) is noise
  // for the pages, whose own editor reads the shape.
  const said = plain.help !== undefined && !/[{}[\]]/.test(plain.help) ? plain.help : undefined;
  const help = [said, tells && table ? `A row of ${table.label}` : undefined].filter((h): h is string => h !== undefined && h !== "").join(" · ") || undefined;
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
