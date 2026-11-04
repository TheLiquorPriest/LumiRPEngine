// The people tools (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): who there is, one person's sheet, where
// someone is, and how someone regards others, each read through the agent's `ToolReadView`:
//
// - `everyone` reads everyone in the world, where they are and what they are doing, a restricted
//   person, place, field, life state or private activity marked in the user's wording.
// - `gm` reads everyone, a removed one too, unmarked, with each restricted one's visibility, and the
//   GM's own data of a sheet: whether the engine runs them, what the story holds of them, their schedules.
//
// A sheet under `everyone` and `gm` is the GM's Character sheet (`buildCharacter`); regard is the
// relationships pack's (`regardWords`, `regardView`, `regardAxes`); lore about someone is the
// world's lore as read now, World Info included, each entry as the view gives it (`loreEntry`).
// Where someone is (`whereabouts`) is one rule, which the places tools read too.

import { buildCharacter } from "../../../../engine/character";
import { lifeKnownTo, lifeOf } from "../../../../engine/life";
import { own } from "../../../../engine/pack-kit";
import { together } from "../../../../engine/presence";
import { bandOf, isGone, kindIs, placeOfEntity, placeWithin } from "../../../../engine/scope";
import { shownActivity } from "../../../../packs/castlife/core/index";
import { axesOf, bandsOf, regardAxes, regardWords } from "../../../../packs/relationships/core/index";
import { placePath } from "../../../../packs/space/core/map-scope";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { CharacterDTO, CharacterField, CharacterRelation } from "../../../../shared/character";
import type { EntityId, PlaceId } from "../../../../shared/ids";
import { hasOwn, type JsonValue } from "../../../../shared/json";
import type { PartyTier } from "../../../../shared/party";
import { ALIVE, lifeStateOf, type LoreEntryDef } from "../../../../shared/world";
import type { Secrecy, ToolReadView, ViewLore, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolvePerson, resolvePlace } from "../resolve";
import { badValue, kindEnum, needText, objectSchema, placeEnum, schemaWorld, text, textArg } from "../schema";

// ---------------------------------------------------------------- where someone is, shared

/** A place as a view names it; one the world has no place by goes by `Somewhere`, never its id. */
export type PlaceShown = ViewRef | { name: string };

/** Where a person is: where they are, the places around it (outermost first) and what they are doing; their life state when it isn't alive. */
export interface Whereabouts {
  place?: PlaceShown;
  path?: ViewRef[];
  doing?: string;
  life?: string;
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

/** Ids of entities or places in the order of their names, then their ids. */
export function byName(view: ToolReadView): (a: string, b: string) => number {
  return (a, b) => view.name(a).localeCompare(view.name(b)) || a.localeCompare(b);
}

/** Someone's life state when it isn't alive: where the view marks, as it is, marked as known to those who know it when the player character takes it otherwise; else as it is. */
function lifeWords(view: ToolReadView, id: EntityId): string | undefined {
  const truth = lifeOf(view.state, id);
  if (truth === ALIVE) return undefined;
  const label = lifeStateOf(view.world, truth).label;
  if (!view.marked || lifeKnownTo(view.state, id, view.pov) === truth) return label;
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

/** Where a person is (see `Whereabouts`): the people tools' and the places tools' one rule. */
export function whereabouts(view: ToolReadView, id: EntityId): Whereabouts {
  const now = placeOfEntity(view.state, id);
  const place = now !== null ? view.place(now) : null;
  return { ...(now !== null && place ? { place, path: pathOf(view, now) } : {}), doing: doingNow(view, id), life: lifeWords(view, id) };
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
      const kept = view.marked && view.loreSecrecy(entry) === null ? secrecy(subject) : null;
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
  /** Every field set, a place, someone or something by its ref. */
  fields?: SheetField[];
  /** What holds them (a car, a boat). */
  inside?: ViewRef;
  relations: SheetRelation[];
  /** Under `gm`: whether the engine runs their mind and day. */
  agent?: boolean;
  /** Under `gm`: until when they keep doing what they do, their tier in the player character's party (null: not in it), and what the story holds. */
  now?: { until?: string; partyTier: PartyTier | null; holds: { label: string; until: string | null }[] };
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

/** A field's value as the view gives it: a place, someone or something by its ref; where the view marks, a restricted field's value marked. */
function fieldValue(view: ToolReadView, id: EntityId, f: CharacterField): JsonValue | ViewRef {
  const kept = view.marked ? view.fieldSecrecy(id, f.id) : null;
  const value = f.value;
  if (f.type === "ref" && typeof value === "string") {
    const ref = hasOwn(view.state.entities, value) ? view.entity(value) : view.place(value);
    if (ref) return kept ? { ...ref, name: view.mark(view.name(value), kept) } : ref;
  }
  return kept ? view.mark(typeof value === "string" ? value : JSON.stringify(value), kept) : value;
}

/**
 * Their relations as the view reads them: each to someone or somewhere it may name, in the GM
 * sheet's words.
 */
function sheetRelations(view: ToolReadView, id: EntityId, relations: readonly CharacterRelation[]): SheetRelation[] {
  const out: SheetRelation[] = [];
  for (const r of relations) {
    const to = hasOwn(view.state.entities, r.to.id) ? view.entity(r.to.id) : view.place(r.to.id);
    if (!to) continue;
    const words = r.words;
    out.push({ type: r.type, to, ...(words !== "" ? { words } : {}) });
  }
  return out;
}

/** A person's sheet as the view reads it (see the header), with what the lore says about them. */
function sheetOf(view: ToolReadView, person: ViewRef, sheet: CharacterDTO, lore: ViewLore[]): SheetAnswer {
  const id = person.id;
  const head = { person, kind: sheet.kind, tier: sheet.tier, ...whereabouts(view, id) };
  const relations = sheetRelations(view, id, sheet.relations);
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
          ...(now ? { now: { ...(now.until !== null ? { until: now.until } : {}), partyTier: now.partyTier, holds: now.holds } } : {}),
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

/** A person's regard toward each the view may name that they regard (or only `toward`), by name, in words, with every axis's band and value. */
function regardOf(view: ToolReadView, from: EntityId, toward: EntityId | null): Regard[] {
  const targets = (own(view.state.entities, from)?.relations ?? []).filter((r) => r.type === "regard" && (toward === null || r.to === toward)).map((r) => r.to);
  const out: Regard[] = [];
  for (const to of [...new Set(targets)].sort(byName(view))) {
    const ref = view.entity(to);
    if (!ref) continue;
    out.push({ toward: ref, words: regardWords(view.ctx, from, to) ?? undefined, axes: axesNow(view, from, to) });
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
          const kinds = kindEnum(schemaWorld(view.world, view.registry), "person");
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
          const at = placeOfEntity(view.state, id);
          if (within !== null && !placeWithin(view.world, at, within)) continue;
          people.push({ ...ref, kind: e.kind, place: whereabouts(view, id).place });
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
        if (r.id !== view.pov) answer.together = together(view.world, placeOfEntity(view.state, view.pov), placeOfEntity(view.state, r.id));
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
        const answer: RegardAnswer = { person, regard: regardOf(view, who.id, toward) };
        return view.answer(answer);
      });
    },
  },
];
