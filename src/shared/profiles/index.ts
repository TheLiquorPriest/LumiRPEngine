// Ruleset profiles (DESIGN §11): ready-made rulesets as world fragments the engine already reads,
// and applying one to a world. Build previews a profile on the draft (`planProfile`, here in the
// frontend) and the backend applies it to the stored draft in one editor write
// (`applyProfile`, `lre.editor profile`), so both read the same plan.
//
//   the kinds        the fields go on every kind the profile's tabletop rules name (`ruleset.d20.kinds`),
//                    else on the point of view's kind: the world's own kind, or, when it is a pack's
//                    kind, a world copy of that kind with the fields added
//   items            every field, check, action, table and ruleset part is new (`add`), the same as
//                    the world's (`same`), or different (`conflict`, kept unless the author takes
//                    the profile's); applying twice therefore changes nothing. What the world still
//                    holds exactly as the profile it last started from wrote it is that profile's, not
//                    the world's own, and another profile's is written in its place (`add`)
//   people           read each new field's default; a stored value is changed only when a field
//                    taken from the profile can't hold it (clamped into its bounds, else cleared)
//
// Pure: no engine, no registry. The packs' kinds come in as data (`lre.world get` sends them to Build).

import { hashJson } from "../hash";
import type { EntityId, KindId } from "../ids";
import { hasOwn, isRecord, safeKey, type JsonValue } from "../json";
import type { FieldDef, KindDef, RulesetDef, WorldDoc } from "../world";
import { CLASSIC } from "./classic";
import { CLASSIC_REVISED } from "./classic-revised";
import { CUSTOM } from "./custom";
import { FIFTH } from "./fifth";
import { MODERN } from "./modern";
import type { ProfileDef, ProfileId } from "./types";

export type { ProfileDef, ProfileId } from "./types";

export const PROFILES: Readonly<Record<ProfileId, ProfileDef>> = { modern: MODERN, classic: CLASSIC, classic_revised: CLASSIC_REVISED, fifth: FIFTH, custom: CUSTOM };

/** The picker's order: the fullest first, the bare one last. */
export const PROFILE_IDS: readonly ProfileId[] = ["modern", "classic", "classic_revised", "fifth", "custom"];

export function profileOf(id: unknown): ProfileDef | null {
  const found = PROFILE_IDS.find((p) => p === id);
  return found ? PROFILES[found] : null;
}

/** Per conflicting item: keep the world's, or take the profile's. */
export type ProfileChoice = "mine" | "profile";
export type ProfileStatus = "add" | "same" | "conflict";
export type ProfileGroup = "fields" | "checks" | "actions" | "tables" | "ruleset";

export interface ProfileItem {
  /** Where it goes in the document (`kinds.character.fields.hp`, `checks.skill`, `ruleset.sheet`); conflict choices are keyed by it. */
  path: string;
  group: ProfileGroup;
  label: string;
  status: ProfileStatus;
}

/** A person's stored value a field taken from the profile can't hold, and what it becomes (null: cleared, so the default applies). */
export interface ProfileValue {
  entity: EntityId;
  name: string;
  field: string;
  from: JsonValue;
  to: JsonValue | null;
}

export interface ProfilePlan {
  profile: ProfileId;
  /** The first kind the fields go on, and whether the world gets its own copy of a pack's kind for them. */
  kind: { id: KindId; label: string; copied: boolean };
  /** Every kind the fields go on, `kind` first: the kinds the profile's tabletop rules name, else the point of view's alone. */
  kinds: { id: KindId; label: string; copied: boolean }[];
  items: ProfileItem[];
  /** How many people (of those kinds or one inheriting one) read the new fields' defaults. */
  people: number;
  values: ProfileValue[];
}

type PackKinds = Readonly<Record<KindId, KindDef>>;

/** Conflict choices from a request: a valid path and a valid choice each; anything else is dropped. */
export function profileChoices(raw: unknown): Record<string, ProfileChoice> {
  const out: Record<string, ProfileChoice> = {};
  if (!isRecord(raw)) return out;
  for (const [path, choice] of Object.entries(raw)) if (safeKey(path) && (choice === "mine" || choice === "profile")) out[path] = choice;
  return out;
}

/** A kind as the world reads it: its own definition, else a pack's. */
function kindOf(world: WorldDoc, packKinds: PackKinds, id: KindId): KindDef | undefined {
  return hasOwn(world.kinds, id) ? world.kinds[id] : hasOwn(packKinds, id) ? packKinds[id] : undefined;
}

/** Walks a kind and its ancestors until `visit` answers. */
function upChain<T>(world: WorldDoc, packKinds: PackKinds, kind: KindId, visit: (id: KindId, def: KindDef) => T | undefined): T | undefined {
  let id: KindId | undefined = kind;
  for (let guard = 0; id !== undefined && guard < 32; guard++) {
    const def = kindOf(world, packKinds, id);
    if (!def) return undefined;
    const found = visit(id, def);
    if (found !== undefined) return found;
    id = def.extends;
  }
  return undefined;
}

/** One thing the profile writes: where, what the world has there now, and how to write the profile's. */
interface Slot {
  path: string;
  group: ProfileGroup;
  label: string;
  mine: unknown;
  theirs: unknown;
  /** A field of a kind the fields go on: that kind, the field's id and the profile's definition. */
  field?: { kind: KindId; id: string; def: FieldDef };
  write(doc: WorldDoc): void;
}

function words(id: string): string {
  const text = id.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The ruleset of a document being written, created when it has none. */
function rulesetIn(doc: WorldDoc): RulesetDef {
  const ruleset: RulesetDef = isRecord(doc.ruleset) ? doc.ruleset : {};
  doc.ruleset = ruleset;
  return ruleset;
}

/** A part of the world's ruleset, when it is a record. */
function rulesetPart(world: WorldDoc, key: keyof RulesetDef): Record<string, unknown> | undefined {
  const part: unknown = isRecord(world.ruleset) ? world.ruleset[key] : undefined;
  return isRecord(part) ? part : undefined;
}

/** The kinds a profile's fields go on: those its tabletop rules name, else the point of view's. */
function fieldKinds(world: WorldDoc, profile: ProfileDef): KindId[] {
  const named = (profile.ruleset.d20?.kinds ?? []).filter((k, i, all) => k !== "" && all.indexOf(k) === i);
  if (named.length > 0) return named;
  const pov = hasOwn(world.entities, world.pov) ? world.entities[world.pov] : undefined;
  return [pov?.kind ?? "person"];
}

function slotsOf(world: WorldDoc, profile: ProfileDef, packKinds: PackKinds): { kinds: ProfilePlan["kinds"]; slots: Slot[] } {
  const kinds: ProfilePlan["kinds"] = [];
  const slots: Slot[] = [];
  const several = fieldKinds(world, profile).length > 1;
  for (const kindId of fieldKinds(world, profile)) {
    const ownKind = hasOwn(world.kinds, kindId) ? world.kinds[kindId] : undefined;
    const packKind = hasOwn(packKinds, kindId) ? packKinds[kindId] : undefined;
    const label = ownKind?.label ?? packKind?.label ?? words(kindId);
    kinds.push({ id: kindId, label, copied: !ownKind });
    // A pack's kind is replaced whole by a world kind of the same id, so the copy keeps every field the pack gives it.
    const kindIn = (doc: WorldDoc): KindDef => {
      const existing = hasOwn(doc.kinds, kindId) ? doc.kinds[kindId] : undefined;
      if (existing) return existing;
      const copy: KindDef = { id: kindId, label, ...(packKind?.extends !== undefined ? { extends: packKind.extends } : {}), fields: structuredClone(packKind?.fields ?? {}) };
      doc.kinds[kindId] = copy;
      return copy;
    };
    for (const [id, def] of Object.entries(profile.fields)) {
      const name = def.label ?? words(id);
      slots.push({ path: `kinds.${kindId}.fields.${id}`, group: "fields", label: several ? `${name} (${label})` : name, mine: upChain(world, packKinds, kindId, (_k, k) => (hasOwn(k.fields, id) ? k.fields[id] : undefined)), theirs: def, field: { kind: kindId, id, def }, write: (doc) => void (kindIn(doc).fields[id] = structuredClone(def)) });
    }
  }
  for (const [id, def] of Object.entries(profile.checks)) {
    slots.push({ path: `checks.${id}`, group: "checks", label: words(id), mine: hasOwn(world.checks, id) ? world.checks[id] : undefined, theirs: def, write: (doc) => void (doc.checks[id] = structuredClone(def)) });
  }
  for (const [id, def] of Object.entries(profile.actions)) {
    slots.push({ path: `actions.${id}`, group: "actions", label: def.label, mine: hasOwn(world.actions, id) ? world.actions[id] : undefined, theirs: def, write: (doc) => void (doc.actions[id] = structuredClone(def)) });
  }
  for (const [id, def] of Object.entries(profile.tables)) {
    slots.push({ path: `tables.${id}`, group: "tables", label: def.label, mine: hasOwn(world.tables, id) ? world.tables[id] : undefined, theirs: def, write: (doc) => void (doc.tables[id] = structuredClone(def)) });
  }
  const rs = profile.ruleset;
  const progression = rulesetPart(world, "progression");
  for (const [id, def] of Object.entries(rs.progression)) {
    slots.push({
      path: `ruleset.progression.${id}`,
      group: "ruleset",
      label: `Progression: ${def.label}`,
      mine: progression && hasOwn(progression, id) ? progression[id] : undefined,
      theirs: def,
      write: (doc) => {
        const r = rulesetIn(doc);
        r.progression = { ...(isRecord(r.progression) ? r.progression : {}), [id]: structuredClone(def) };
      },
    });
  }
  slots.push({ path: "ruleset.sheet", group: "ruleset", label: "Sheet layout", mine: rulesetPart(world, "sheet"), theirs: rs.sheet, write: (doc) => void (rulesetIn(doc).sheet = structuredClone(rs.sheet)) });
  const floors = rulesetPart(world, "minLevels");
  for (const [domain, level] of Object.entries(rs.minLevels)) {
    slots.push({
      path: `ruleset.minLevels.${domain}`,
      group: "ruleset",
      label: `Level floor: ${words(domain)} ${String(level)}`,
      mine: floors && hasOwn(floors, domain) ? floors[domain] : undefined,
      theirs: level,
      write: (doc) => {
        const r = rulesetIn(doc);
        r.minLevels = { ...(isRecord(r.minLevels) ? r.minLevels : {}), [domain]: level };
      },
    });
  }
  slots.push({ path: "ruleset.adjudication", group: "ruleset", label: `How checks are decided: ${words(rs.adjudication.preset)}`, mine: rulesetPart(world, "adjudication"), theirs: rs.adjudication, write: (doc) => void (rulesetIn(doc).adjudication = structuredClone(rs.adjudication)) });
  slots.push({ path: "ruleset.combat", group: "ruleset", label: "Combat rules", mine: rulesetPart(world, "combat"), theirs: rs.combat, write: (doc) => void (rulesetIn(doc).combat = structuredClone(rs.combat)) });
  const d20 = rs.d20;
  if (d20 !== undefined) slots.push({ path: "ruleset.d20", group: "ruleset", label: "Tabletop rules", mine: rulesetPart(world, "d20"), theirs: d20, write: (doc) => void (rulesetIn(doc).d20 = structuredClone(d20)) });
  return { kinds, slots };
}

function statusOf(slot: Slot): ProfileStatus {
  if (slot.mine === undefined) return "add";
  return hashJson(slot.mine) === hashJson(slot.theirs) ? "same" : "conflict";
}

/**
 * What the profile the world last started from (`ruleset.profile`) wrote, by path, each as its hash: an item the world still holds
 * exactly as that profile wrote it is that profile's, not the world's own work, so another profile puts its own in place of it as
 * it adds a new one. Null where the world started from none, or from this same one.
 */
function lastWrote(world: WorldDoc, profile: ProfileDef, packKinds: PackKinds): { label: string; at: Map<string, string> } | null {
  const last = profileOf(isRecord(world.ruleset) ? world.ruleset.profile : undefined);
  if (last === null || last.id === profile.id) return null;
  return { label: last.label, at: new Map(slotsOf(world, last, packKinds).slots.map((s) => [s.path, hashJson(s.theirs)])) };
}

/** What a field definition makes of a stored value: undefined when it holds it, else the value it can hold (null: none). */
function fitted(def: FieldDef, v: JsonValue): JsonValue | null | undefined {
  switch (def.type) {
    case "number":
    case "money":
    case "duration": {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      // A floor that is a formula is read on the sheet, not here: only a number holds a stored value up.
      const lo = Math.max(def.min ?? -Infinity, def.pool ? (typeof def.pool.min === "string" ? -Infinity : (def.pool.min ?? 0)) : -Infinity);
      const n = Math.min(def.max ?? Infinity, Math.max(lo, v));
      return n === v ? undefined : n;
    }
    case "bool":
      return typeof v === "boolean" ? undefined : null;
    case "enum":
      return typeof v === "string" && (def.values ?? []).includes(v) ? undefined : null;
    case "list":
      return Array.isArray(v) ? undefined : null;
    default:
      return typeof v === "string" ? undefined : null;
  }
}

function planOf(world: WorldDoc, profile: ProfileDef, packKinds: PackKinds, choices: Readonly<Record<string, ProfileChoice>>): { plan: ProfilePlan; write: Slot[] } {
  const { kinds, slots } = slotsOf(world, profile, packKinds);
  const last = lastWrote(world, profile, packKinds);
  const items = slots.map((slot): ProfileItem => {
    const status = statusOf(slot);
    if (status === "conflict" && last !== null && last.at.get(slot.path) === hashJson(slot.mine)) return { path: slot.path, group: slot.group, label: `${slot.label} (in place of ${last.label}'s)`, status: "add" };
    return { path: slot.path, group: slot.group, label: slot.label, status };
  });
  const write = slots.filter((slot, i) => {
    const status = items[i]?.status;
    return status === "add" || (status === "conflict" && choices[slot.path] === "profile");
  });
  // The fields taken, by the kind they go on.
  const taken = new Map<KindId, Map<string, FieldDef>>(kinds.map((k) => [k.id, new Map<string, FieldDef>()]));
  for (const slot of write) if (slot.field) taken.get(slot.field.kind)?.set(slot.field.id, slot.field.def);
  const values: ProfileValue[] = [];
  let people = 0;
  for (const [id, e] of Object.entries(world.entities)) {
    // The nearest of the kinds that an entity's kind is or inherits: its fields are the ones it reads.
    const under = upChain(world, packKinds, e.kind, (k) => (taken.has(k) ? k : undefined));
    if (under === undefined) continue;
    people++;
    for (const [field, def] of taken.get(under) ?? []) {
      if (def.derived !== undefined || !hasOwn(e.fields, field)) continue;
      // A kind between the entity's and the one the field goes on that defines the field keeps its own definition, so its values stay.
      if (upChain(world, packKinds, e.kind, (k, d) => (k === under ? false : hasOwn(d.fields, field) ? true : undefined)) === true) continue;
      const from = e.fields[field];
      if (from === undefined) continue;
      const to = fitted(def, from);
      if (to !== undefined) values.push({ entity: id, name: e.name, field, from, to });
    }
  }
  const kind = kinds[0] ?? { id: "person", label: words("person"), copied: true };
  return { plan: { profile: profile.id, kind, kinds, items, people, values }, write };
}

/** What applying `profile` to `world` would add, leave and ask about, with the given conflict choices (unchosen: keep mine). */
export function planProfile(world: WorldDoc, profile: ProfileDef, packKinds: PackKinds, choices: Readonly<Record<string, ProfileChoice>> = {}): ProfilePlan {
  return planOf(world, profile, packKinds, choices).plan;
}

/**
 * The world with `profile` applied: new items written, conflicts written only where chosen
 * (`profile`), stored values the taken fields can't hold fixed, and `ruleset.profile` recorded.
 * A new document; `world` is untouched.
 */
export function applyProfile(world: WorldDoc, profile: ProfileDef, packKinds: PackKinds, choices: Readonly<Record<string, ProfileChoice>> = {}): WorldDoc {
  const { plan, write } = planOf(world, profile, packKinds, choices);
  const doc = structuredClone(world);
  for (const slot of write) slot.write(doc);
  for (const v of plan.values) {
    const fields = doc.entities[v.entity]?.fields;
    if (!fields) continue;
    if (v.to === null) delete fields[v.field];
    else fields[v.field] = v.to;
  }
  rulesetIn(doc).profile = profile.id;
  return doc;
}
