// The people tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): who there is, one person's sheet, where
// someone is, and how someone regards others, each read through the agent's `ToolReadView`:
//
// - `pov` reads as Play: the people the player character may know of (`povMayKnow`, the resolver's
//   own rule), each where Play's Cast has them. Someone with it (at its very place, as Play's Scene
//   has it) is where they are, and doing what Cast shows (`shownActivity`: a private block reads
//   "busy"); someone away is only where and when it last saw them (`lastSighting`, from Cast life 2),
//   never where they are now nor what they do or plan. A sheet gives the fields it may see, in the
//   narrator's words for them (`thingDetails`), never what they are doing or plan; regard is only
//   theirs toward the player character, or its own: any other pair is a mind, `TOOL_NOTE.hidden`.
// - `everyone` reads everyone in the world, where they are and what they are doing, a restricted
//   person, place, field, life state or private activity marked in the user's wording.
// - `gm` reads everyone, a removed one too, unmarked, with each restricted one's visibility, and the
//   GM's own data of a sheet: whether the engine runs them, what the story holds of them, their schedules.
//
// A sheet under `everyone` and `gm` is the GM's Character sheet (`buildCharacter`); regard is the
// relationships pack's (`regardWords`, `regardView`, `regardAxes`); lore about someone is the
// world's lore as read now, World Info included, each entry as the view gives it (`loreEntry`).
// Where someone is (`whereabouts`) is one rule, which the places tools read too.

import { calendarOf, formatClock, placeOffset } from "../../../../engine/calendar";
import { buildCharacter } from "../../../../engine/character";
import { lifeKnownTo, lifeOf, povLife } from "../../../../engine/life";
import { own } from "../../../../engine/pack-kit";
import { together } from "../../../../engine/presence";
import { bandOf, isGone, kindIs, placeOfEntity, placeWithin } from "../../../../engine/scope";
import { lastSighting, type Sighting } from "../../../../engine/seen";
import { thingDescription, thingDetails } from "../../../../engine/thing-words";
import { shownActivity } from "../../../../packs/castlife/core/index";
import { axesOf, bandsOf, regardAxes, regardView, regardWords } from "../../../../packs/relationships/core/index";
import { placePath } from "../../../../packs/space/core/map-scope";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { CharacterDTO, CharacterField, CharacterRelation } from "../../../../shared/character";
import type { EntityId, PlaceId } from "../../../../shared/ids";
import { hasOwn, type JsonValue } from "../../../../shared/json";
import { ALIVE, lifeStateOf, type LoreEntryDef } from "../../../../shared/world";
import type { ToolOutcome } from "../../runtime";
import type { Secrecy, ToolReadView, ViewLore, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolvePerson, resolvePlace } from "../resolve";
import { badValue, kindEnum, needText, objectSchema, placeEnum, schemaWorld, text, textArg } from "../schema";

// ---------------------------------------------------------------- where someone is, shared

/** A place as a view names it; under `pov` one the player character can't see goes by `Somewhere`, never its name or id. */
export type PlaceShown = ViewRef | { name: string };

/** Where and when the player character last saw someone away. */
export interface Sighted {
  place: PlaceShown;
  at: string;
}

/**
 * Where a person is as the view knows it. Under `pov`: whether they are with the player character
 * (`here`), and then where (when it may see their place) and what they are doing as Cast shows it;
 * someone away only where and when it last saw them. Under `everyone` and `gm`: where they are, the
 * places around it (outermost first) and what they are doing. Their life state when it isn't alive.
 */
export interface Whereabouts {
  here?: boolean;
  place?: PlaceShown;
  path?: ViewRef[];
  doing?: string;
  life?: string;
  lastSeen?: Sighted;
}

/** A place as the view names it, else `Somewhere` (`view.hiddenPlace`). */
export function placeShown(view: ToolReadView, place: PlaceId): PlaceShown {
  return view.place(place) ?? { name: view.hiddenPlace };
}

/** The places around a place, outermost first, as the view names them; cut at the first it can't name, as `knownPlaceRefs` cuts a path, so nothing around a hidden place is named. */
export function pathOf(view: ToolReadView, place: PlaceId): ViewRef[] {
  const out: ViewRef[] = [];
  for (const id of placePath(view.world, place).slice(0, -1).reverse()) {
    const ref = view.place(id);
    if (!ref) break;
    out.unshift(ref);
  }
  return out;
}

/** The answer under `pov` to what the player character can't know. */
export function beyondPov(view: ToolReadView): ToolOutcome {
  return view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
}

/** Ids of entities or places in the order of their names, then their ids. */
export function byName(view: ToolReadView): (a: string, b: string) => number {
  return (a, b) => view.name(a).localeCompare(view.name(b)) || a.localeCompare(b);
}

/**
 * Where the view knows someone to be: the place it knows them at now (under `pov` only someone with
 * the player character, at its very place, or the player character itself), and under `pov` its
 * last sight of someone away, which Cast shows from Cast life 2.
 */
interface Locus {
  here: boolean;
  now: PlaceId | null;
  seen: Sighting | null;
}

function locate(view: ToolReadView, id: EntityId): Locus {
  const at = placeOfEntity(view.state, id);
  if (view.knowledge !== "pov") return { here: false, now: at, seen: null };
  if (id === view.pov || (at !== null && at === placeOfEntity(view.state, view.pov))) return { here: true, now: at, seen: null };
  return { here: false, now: null, seen: view.ctx.levelOf(view.pov, "castlife") >= 2 ? lastSighting(view.state, id) : null };
}

/**
 * Someone's life state when it isn't alive: under `pov` as the player character takes it (`povLife`);
 * under `everyone` as it is, marked as known to those who know it when the player character takes
 * it otherwise; under `gm` as it is.
 */
function lifeWords(view: ToolReadView, id: EntityId): string | undefined {
  if (view.knowledge === "pov") return povLife(view.world, view.state, id)?.label;
  const truth = lifeOf(view.state, id);
  if (truth === ALIVE) return undefined;
  const label = lifeStateOf(view.world, truth).label;
  if (view.knowledge === "gm" || lifeKnownTo(view.state, id, view.pov) === truth) return label;
  const known = Object.keys(view.state.entities)
    .filter((who) => who !== id && view.isPerson(who) && !isGone(view.state, who) && lifeKnownTo(view.state, id, who) === truth)
    .map((who) => view.name(who));
  return view.mark(label, { known, kept: "everyone" });
}

/**
 * What someone is doing, as it is (`everyone`, `gm`): under `everyone` an activity the player is
 * told as "busy" (a private block of their routine, an agenda it may not know of) marked as theirs
 * to know, and a restricted Activity field marked as its secrecy says.
 */
function doingNow(view: ToolReadView, id: EntityId): string | undefined {
  const activity = own(view.state.entities, id)?.fields.activity;
  if (typeof activity !== "string" || activity === "") return undefined;
  const kept: Secrecy | null = id !== view.pov && shownActivity(view.ctx, id, activity) !== activity ? { known: [view.name(id)], kept: "everyone" } : view.fieldSecrecy(id, "activity");
  return view.mark(activity, kept);
}

/** Where a person is as the view knows it (see `Whereabouts`): the people tools' and the places tools' one rule. */
export function whereabouts(view: ToolReadView, id: EntityId): Whereabouts {
  const locus = locate(view, id);
  const life = lifeWords(view, id);
  const now = locus.now;
  if (view.knowledge !== "pov") {
    const place = now !== null ? view.place(now) : null;
    return { ...(now !== null && place ? { place, path: pathOf(view, now) } : {}), doing: doingNow(view, id), life };
  }
  if (!locus.here) {
    const seen = locus.seen;
    const at = seen ? formatClock(calendarOf(view.world), seen.at, placeOffset(view.world, seen.at, view.seesPlace(seen.place) ? seen.place : null)) : null;
    return { here: false, ...(seen && at !== null ? { lastSeen: { place: placeShown(view, seen.place), at } } : {}), life };
  }
  const activity = own(view.state.entities, id)?.fields.activity;
  const said = typeof activity === "string" && activity !== "" ? activity : null;
  // The player character itself, as its own sheet in Play has it: where it is, and what it is doing.
  if (id === view.pov) return { here: true, ...(now !== null ? { place: placeShown(view, now) } : {}), ...(said !== null ? { doing: said } : {}), life };
  // Someone with it, as Cast shows someone here: their place and doing as fields it may see, no doing for one who doesn't act.
  const acts = povLife(view.world, view.state, id)?.acts !== false;
  return {
    here: true,
    ...(now !== null && view.seesField(id, "place") ? { place: placeShown(view, now) } : {}),
    ...(said !== null && acts && view.seesField(id, "activity") ? { doing: shownActivity(view.ctx, id, said).replace(/_/g, " ") } : {}),
    life,
  };
}

/**
 * What the world's lore says about `subjects` (a person; or a place, then each place holding it,
 * nearest first), as the view gives each entry (`loreEntry`): every entry of the lore as read now
 * (`lore()`, World Info included) that links one, in Place lore's order (`placeLoreLines`: the
 * nearest subject first, then priority, then title). Under `everyone` an entry nothing restricts of
 * its own, about a restricted subject, is marked as its subject is (`secrecy`): it is theirs to know.
 */
export async function loreAbout(view: ToolReadView, subjects: readonly string[], secrecy: (subject: string) => Secrecy | null): Promise<ViewLore[]> {
  const world = await view.lore();
  const found: { entry: LoreEntryDef; subject: string; at: number }[] = [];
  for (const entry of Object.values(world.lore)) {
    const links = Array.isArray(entry.links) ? entry.links : [];
    const at = subjects.findIndex((s) => links.includes(s));
    const subject = subjects[at];
    if (subject !== undefined && typeof entry.content === "string" && entry.content.trim() !== "") found.push({ entry, subject, at });
  }
  found.sort((a, b) => a.at - b.at || (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || String(a.entry.title).localeCompare(String(b.entry.title)) || a.entry.id.localeCompare(b.entry.id));
  return view.read(() =>
    found.flatMap(({ entry, subject }): ViewLore[] => {
      const shown = view.loreEntry(entry);
      if (!shown) return [];
      const kept = view.knowledge === "everyone" && view.loreSecrecy(entry) === null ? secrecy(subject) : null;
      return [kept ? { ...shown, text: view.mark(shown.text, kept) } : shown];
    }),
  );
}

// ---------------------------------------------------------------- answers

interface FindAnswer {
  people: FoundPerson[];
}

interface FoundPerson extends ViewRef {
  kind: string;
  place?: PlaceShown;
  lastSeen?: Sighted;
}

interface WhereAnswer extends Whereabouts {
  person: ViewRef;
  /** Under `everyone` and `gm`: whether they are in the player character's scene (`together`). */
  together?: boolean;
}

interface SheetField {
  id: string;
  label: string;
  value: JsonValue | ViewRef;
}

interface SheetRelation {
  type: string;
  to: ViewRef;
  words?: string;
}

interface SheetAnswer extends Whereabouts {
  person: ViewRef;
  kind: { id: string; label: string };
  tier: { id: string; label: string };
  /** Under `pov`: each field the player character may see, in the narrator's words for it ("age 31", "home 114 Harbor Street"). */
  details?: string[];
  description?: string;
  /** Under `everyone` and `gm`: every field set, a place, someone or something by its ref. */
  fields?: SheetField[];
  /** Under `everyone` and `gm`: what holds them (a car, a boat). */
  inside?: ViewRef;
  relations: SheetRelation[];
  /** Under `gm`: whether the engine runs their mind and day. */
  agent?: boolean;
  /** Under `gm`: until when they keep doing what they do, whether they travel with the player character, and what the story holds. */
  now?: { until?: string; party: boolean; holds: { label: string; until: string | null }[] };
  /** Under `gm`: the schedules that apply to them, in words. */
  schedules?: { label: string; summary: string }[];
  lore: ViewLore[];
}

/** One axis of regard, as the relationships pack's panels give it: its label, its band in the world's words, and its value where told. */
interface RegardAxis {
  axis: string;
  band: string;
  value?: number;
}

interface Regard {
  toward: ViewRef;
  words?: string;
  axes: RegardAxis[];
}

interface RegardAnswer {
  person: ViewRef;
  regard: Regard[];
}

// ---------------------------------------------------------------- sheets

/** Fields a sheet under `pov` never tells: what someone is doing or plans (their doing is told as Cast tells it). Locked fields are never told: no model is offered one. */
const DOINGS: Readonly<Record<string, true>> = { activity: true, scene: true, appointments: true, trips: true, chores: true };

/** A field's value as the view gives it: a place, someone or something by its ref; under `everyone` a restricted field's value marked. */
function fieldValue(view: ToolReadView, id: EntityId, f: CharacterField): JsonValue | ViewRef {
  const kept = view.knowledge === "everyone" ? view.fieldSecrecy(id, f.id) : null;
  const value = f.value;
  if (f.type === "ref" && typeof value === "string") {
    const ref = hasOwn(view.state.entities, value) ? view.entity(value) : view.place(value);
    if (ref) return kept ? { ...ref, name: view.mark(view.name(value), kept) } : ref;
  }
  return kept ? view.mark(typeof value === "string" ? value : JSON.stringify(value), kept) : value;
}

/**
 * Their relations as the view may read them: each to someone or somewhere it may name, in the GM
 * sheet's words; under `pov` regard only theirs toward the player character, or its own, in the
 * Stance section's words (`regardWords`, none at Relationships 0), and whom someone knows only its
 * own: another's mind is not the player character's to read.
 */
function sheetRelations(view: ToolReadView, id: EntityId, relations: readonly CharacterRelation[]): SheetRelation[] {
  const out: SheetRelation[] = [];
  for (const r of relations) {
    const to = hasOwn(view.state.entities, r.to.id) ? view.entity(r.to.id) : view.place(r.to.id);
    if (!to) continue;
    let words = r.words;
    if (view.knowledge === "pov") {
      if (r.type === "knows" && id !== view.pov) continue;
      if (r.type === "regard") {
        if (id !== view.pov && r.to.id !== view.pov) continue;
        words = regardWords(view.ctx, id, r.to.id) ?? "";
        if (words === "") continue;
      }
    }
    out.push({ type: r.type, to, ...(words !== "" ? { words } : {}) });
  }
  return out;
}

/** A person's sheet as the view reads it (see the header), with what the lore says about them. */
function sheetOf(view: ToolReadView, person: ViewRef, sheet: CharacterDTO, lore: ViewLore[]): SheetAnswer {
  const id = person.id;
  const head = { person, kind: sheet.kind, tier: sheet.tier, ...whereabouts(view, id) };
  const relations = sheetRelations(view, id, sheet.relations);
  if (view.knowledge === "pov") {
    const description = thingDescription(view.ctx, id);
    const details = thingDetails(view.ctx, id, (field, def) => def.locked === true || hasOwn(DOINGS, field));
    return { ...head, details, ...(description !== null ? { description } : {}), relations, lore };
  }
  // Where they are and what they are doing are told apart (`whereabouts`), an activity the player reads as "busy" marked there.
  const fields = sheet.sections
    .flatMap((s) => s.fields)
    .flatMap((f): SheetField[] => (f.value === null || f.locked === true || f.id === "place" || f.id === "activity" ? [] : [{ id: f.id, label: f.label, value: fieldValue(view, id, f) }]));
  const inside = sheet.inside ? view.entity(sheet.inside.id) : null;
  const now = sheet.now;
  const gm =
    view.knowledge === "gm"
      ? {
          agent: sheet.agent,
          ...(now ? { now: { ...(now.until !== null ? { until: now.until } : {}), party: now.party, holds: now.holds } } : {}),
          schedules: sheet.schedules.map((s) => ({ label: s.label, summary: s.summary })),
        }
      : {};
  return { ...head, fields, ...(inside ? { inside } : {}), relations, ...gm, lore };
}

// ---------------------------------------------------------------- regard

/** Every axis of A's regard toward B now, with its band in the world's words and its value (`regardAxes`), whatever the level: as the GM reads it. */
function axesNow(view: ToolReadView, from: EntityId, to: EntityId): RegardAxis[] {
  const values = regardAxes(view.ctx, from, to);
  const bands = bandsOf(view.ctx);
  return axesOf(view.ctx).map((a) => {
    const value = own(values, a.id) ?? 0;
    return { axis: a.label, band: bandOf(bands, value)?.label ?? "neutral", value };
  });
}

/**
 * A person's regard toward each the view may name that they regard (or only `toward`), by name:
 * under `pov` another's only toward the player character, as Play shows it, at the regarding
 * party's level (`regardWords`, `regardView`: none at Relationships 0); under `everyone` and `gm` in
 * words, with every axis's band and value.
 */
function regardOf(view: ToolReadView, from: EntityId, toward: EntityId | null): Regard[] {
  const targets = (own(view.state.entities, from)?.relations ?? [])
    .filter((r) => r.type === "regard" && (toward === null || r.to === toward) && (view.knowledge !== "pov" || from === view.pov || r.to === view.pov))
    .map((r) => r.to);
  const out: Regard[] = [];
  for (const to of [...new Set(targets)].sort(byName(view))) {
    const ref = view.entity(to);
    if (!ref) continue;
    const words = regardWords(view.ctx, from, to) ?? undefined;
    if (view.knowledge !== "pov") out.push({ toward: ref, words, axes: axesNow(view, from, to) });
    else {
      const axes = regardView(view.ctx, from, to);
      if (axes.length > 0) out.push({ toward: ref, words, axes });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the tools

const FIND = "people_find";
const SHEET = "people_sheet";
const WHERE = "people_where";
const REGARD = "people_regard";

export const PEOPLE_TOOLS: readonly ToolDefinition[] = [
  {
    name: FIND,
    family: "people",
    tier: "read",
    parameters: (world) => objectSchema({ name: text(), kind: text(kindEnum(world, "person")), place: text(placeEnum(world)) }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const name = textArg(args, "name")?.toLowerCase() ?? null;
      const kind = textArg(args, "kind");
      const placeSaid = textArg(args, "place");
      return view.read(() => {
        if (kind !== null) {
          const kinds = kindEnum(schemaWorld(view.world, view.registry, view.knowledge), "person");
          if (!kinds.includes(kind)) return badValue(view, FIND, "kind", kind, kinds);
        }
        let within: PlaceId | null = null;
        if (placeSaid !== null) {
          const r = resolvePlace(view, placeSaid);
          if ("refused" in r) return r.refused;
          within = r.id;
        }
        const people: FoundPerson[] = [];
        for (const id of Object.keys(view.state.entities).filter((id) => view.isPerson(id)).sort(byName(view))) {
          const e = own(view.state.entities, id);
          if (!e || (name !== null && !e.name.toLowerCase().includes(name)) || (kind !== null && !kindIs(view.registry, view.world, e.kind, kind))) continue;
          const ref = view.entity(id);
          if (!ref) continue;
          // At a place by what the view knows of where they are: under `pov` with the player character there, or last seen there.
          const locus = locate(view, id);
          if (within !== null && !placeWithin(view.world, locus.now ?? locus.seen?.place ?? null, within)) continue;
          const { place, lastSeen } = whereabouts(view, id);
          people.push({ ...ref, kind: e.kind, place, lastSeen });
        }
        const answer: FindAnswer = { people };
        return view.answer(answer);
      });
    },
  },
  {
    name: SHEET,
    family: "people",
    tier: "read",
    parameters: () => objectSchema({ person: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, SHEET, args, "person");
      if (typeof said !== "string") return said;
      const r = view.read(() => resolvePerson(view, said));
      if ("refused" in r) return r.refused;
      const lore = await loreAbout(view, [r.id], (id) => view.entitySecrecy(id));
      return view.read(() => {
        const person = view.entity(r.id);
        const sheet = buildCharacter(view.registry, view.world, r.id, view.state)?.character;
        if (!person || !sheet) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        return view.answer(sheetOf(view, person, sheet, lore));
      });
    },
  },
  {
    name: WHERE,
    family: "people",
    tier: "read",
    parameters: () => objectSchema({ person: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, WHERE, args, "person");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const r = resolvePerson(view, said);
        if ("refused" in r) return r.refused;
        const person = view.entity(r.id);
        if (!person) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        const answer: WhereAnswer = { person, ...whereabouts(view, r.id) };
        if (view.knowledge !== "pov" && r.id !== view.pov) answer.together = together(view.world, placeOfEntity(view.state, view.pov), placeOfEntity(view.state, r.id));
        return view.answer(answer);
      });
    },
  },
  {
    name: REGARD,
    family: "people",
    tier: "read",
    parameters: () => objectSchema({ person: text(), toward: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, REGARD, args, "person");
      if (typeof said !== "string") return said;
      const towardSaid = textArg(args, "toward");
      return view.read(() => {
        const who = resolvePerson(view, said);
        if ("refused" in who) return who.refused;
        const person = view.entity(who.id);
        if (!person) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        let toward: EntityId | null = null;
        if (towardSaid !== null) {
          const r = resolvePerson(view, towardSaid);
          if ("refused" in r) return r.refused;
          toward = r.id;
        }
        // Another's regard for anyone but the player character is their mind.
        if (view.knowledge === "pov" && who.id !== view.pov && toward !== null && toward !== view.pov) return beyondPov(view);
        const answer: RegardAnswer = { person, regard: regardOf(view, who.id, toward) };
        return view.answer(answer);
      });
    },
  },
];
