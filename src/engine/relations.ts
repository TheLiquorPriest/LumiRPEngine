// Relation integrity (DESIGN §3, §4.1): relation types come from the world first, then the packs.
// A symmetric type (siblings) and an inverse pair (`parent_of` / `child_of`) are kept two-sided:
// the `link` and `unlink` effects write or remove the other side in the same atomic group, and a
// chat's initial state completes authored relations that name only one side. Links written through
// the effect must also run between the allowed kinds and stay within the type's cardinality. Lint
// reports the same constraints on the authored world.
//
// Raw `link` events (pack services: gear's `in`, loans) keep their own bookkeeping; the checks
// here are the effect's, so ledgers recorded before them fold exactly as they did.

import type { EntityId, RelationTypeId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { LintIssue } from "../shared/protocol";
import type { Cardinality, RelationInstance, RelationTypeDef, WorldDoc } from "../shared/world";
import { own } from "./pack-kit";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { kindDef, kindIs } from "./scope";
import type { WorldState } from "./state";
import { playerKnows } from "./player-events";
import { canSeePlace } from "./visibility";

/** What relation lookups need from the registry; a fold's event types are the registry. */
export interface RelationTypes {
  readonly relations: ReadonlyMap<string, RelationTypeDef>;
}

export function relationDef(types: RelationTypes, world: WorldDoc, id: RelationTypeId): RelationTypeDef | undefined {
  return own(world.relations, id) ?? types.relations.get(id);
}

/**
 * The relation the target holds back toward the source: the type's inverse, else the type that
 * names it as its inverse (an inverse declared on one side still pairs both), else the type
 * itself when it is symmetric; null for one-way types.
 */
export function counterpartOf(types: RelationTypes, world: WorldDoc, id: RelationTypeId): RelationTypeId | null {
  const def = relationDef(types, world, id);
  if (!def) return null;
  if (def.inverse) return def.inverse;
  if (def.symmetric) return id;
  for (const [other, d] of Object.entries(world.relations)) if (d.inverse === id) return other;
  for (const [other, d] of types.relations) if (d.inverse === id && !own(world.relations, other)) return other;
  return null;
}

/** A source holds at most one link of the type. */
function oneTarget(c: Cardinality): boolean {
  return c === "many_one" || c === "one_one";
}

/** A target has at most one source of the type. */
function oneSource(c: Cardinality): boolean {
  return c === "one_many" || c === "one_one";
}

function kindPhrase(reg: Registry, world: WorldDoc, kind: string): string {
  const label = (kindDef(reg, world, kind)?.label ?? kind.replace(/_/g, " ")).toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}

/** `Parent of` → `parent of`, for a sentence. */
function inline(def: RelationTypeDef): string {
  return def.label.charAt(0).toLowerCase() + def.label.slice(1);
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** One end of a link as the checks see it: an entity in the state, or one a spawn is about to add. */
interface End {
  id: EntityId;
  kind: string;
  name: string;
  relations: readonly RelationInstance[];
}

function endOf(state: Readonly<WorldState>, id: EntityId): End | null {
  const e = own(state.entities, id);
  return e ? { id, kind: e.kind, name: e.name, relations: e.relations } : null;
}

/**
 * Why `a → b` may not be linked with this type in this state: the kinds, or the cardinality. The
 * reason reaches a decline chip and the narrator's Outcome, so it names only those the player
 * knows, as a Journal line does (`playerKnows`: seen and met; "someone" for anyone else, DESIGN
 * §7); the raw one, naming everyone, is kept for the GM view.
 */
function linkProblem(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, def: RelationTypeDef, a: End, b: End): Rejection | null {
  const worded = (code: string, say: (name: (end: Pick<End, "id" | "name">) => string) => string): Rejection => {
    const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
    const reason = sentence(say((end) => (playerKnows(reg, world, state, world.pov, end.id) ? end.name : "someone")));
    const gm = sentence(say((end) => end.name));
    return reason === gm ? reject(code, reason) : { code, reason, gm };
  };
  if (def.from !== "*" && !kindIs(reg, world, a.kind, def.from)) return worded("relation_kind", (name) => `“${def.label}” runs from ${kindPhrase(reg, world, def.from)}; ${name(a)} is ${kindPhrase(reg, world, a.kind)}`);
  if (def.to !== "*" && !kindIs(reg, world, b.kind, def.to)) return worded("relation_kind", (name) => `“${def.label}” runs to ${kindPhrase(reg, world, def.to)}; ${name(b)} is ${kindPhrase(reg, world, b.kind)}`);
  if (oneTarget(def.cardinality)) {
    const other = a.relations.find((r) => r.type === def.id && r.to !== b.id);
    if (other) return worded("cardinality", (name) => `${name(a)} is already ${inline(def)} ${name({ id: other.to, name: own(state.entities, other.to)?.name ?? other.to })}; “${def.label}” allows one at a time`);
  }
  if (oneSource(def.cardinality)) {
    const holder = Object.keys(state.entities)
      .sort()
      .find((id) => id !== a.id && own(state.entities, id)?.relations.some((r) => r.type === def.id && r.to === b.id));
    if (holder) return worded("cardinality", (name) => `${name({ id: holder, name: own(state.entities, holder)?.name ?? holder })} is already ${inline(def)} ${name(b)}; “${def.label}” allows one at a time`);
  }
  return null;
}

/**
 * The events of a `link` effect: the link, and the other side of a symmetric or inverse type,
 * both checked against their types' kinds and cardinality. A self-link of a symmetric type is one link.
 */
export function linkEvents(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, link: { rel: RelationTypeId; from: EntityId; to: EntityId; fields?: JsonObject; until?: number }): LedgerEvent[] | Rejection {
  const extra = { ...(link.fields ? { fields: link.fields } : {}), ...(link.until !== undefined ? { until: link.until } : {}) };
  const events: LedgerEvent[] = [{ type: "link", rel: link.rel, from: link.from, to: link.to, ...extra }];
  const a = endOf(state, link.from);
  const b = endOf(state, link.to);
  // A missing end is the event's own rejection.
  if (!a || !b) return events;
  const def = relationDef(reg, world, link.rel);
  const problem = def ? linkProblem(reg, world, state, def, a, b) : null;
  if (problem) return problem;
  const back = counterpartOf(reg, world, link.rel);
  if (!back || (back === link.rel && link.from === link.to)) return events;
  const backDef = relationDef(reg, world, back);
  const backProblem = backDef ? linkProblem(reg, world, state, backDef, b, a) : null;
  if (backProblem) return backProblem;
  events.push({ type: "link", rel: back, from: link.to, to: link.from, ...extra });
  return events;
}

/**
 * The other sides of a spawn's relations, as links that follow the spawn in its unit: each relation
 * and each other side is checked like a `link` (kinds, cardinality). A relation to a place has no
 * other side, and a type that wants an entity kind at that end refuses it.
 */
export function spawnLinks(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, entity: { id: EntityId; kind: string; name: string; relations: readonly RelationInstance[] }): LedgerEvent[] | Rejection {
  const self: End = { id: entity.id, kind: entity.kind, name: entity.name, relations: entity.relations };
  const out: LedgerEvent[] = [];
  for (const r of entity.relations) {
    const def = relationDef(reg, world, r.type);
    const target = r.to === entity.id ? self : endOf(state, r.to);
    if (!target) {
      if (def && def.to !== "*") {
        const name = own(world.places, r.to)?.name ?? r.to;
        const reason = (place: string): string => `“${def.label}” runs to ${kindPhrase(reg, world, def.to)}; ${place} isn't one`;
        return canSeePlace(reg, world, state, world.pov, r.to) ? reject("relation_kind", reason(name)) : { code: "relation_kind", reason: reason("that place"), gm: reason(name) };
      }
      continue;
    }
    const problem = def ? linkProblem(reg, world, state, def, self, target) : null;
    if (problem) return problem;
    const back = counterpartOf(reg, world, r.type);
    if (!back || (back === r.type && r.to === entity.id)) continue;
    const backDef = relationDef(reg, world, back);
    const backProblem = backDef ? linkProblem(reg, world, state, backDef, target, self) : null;
    if (backProblem) return backProblem;
    out.push({ type: "link", rel: back, from: r.to, to: entity.id });
  }
  return out;
}

/** The events of an `unlink` effect: the link, and the other side when the target holds it. */
export function unlinkEvents(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, link: { rel: RelationTypeId; from: EntityId; to: EntityId }): LedgerEvent[] {
  const events: LedgerEvent[] = [{ type: "unlink", rel: link.rel, from: link.from, to: link.to }];
  const back = counterpartOf(reg, world, link.rel);
  if (!back || (back === link.rel && link.from === link.to)) return events;
  if (own(state.entities, link.to)?.relations.some((r) => r.type === back && r.to === link.from)) events.push({ type: "unlink", rel: back, from: link.to, to: link.from });
  return events;
}

/**
 * Adds the missing side of every authored symmetric or inverse relation, deterministically: sources
 * in id order, their relations in order, each added side appended to its holder with the authored
 * fields and end. Places are never relation holders, so a link to a place stays one-sided.
 */
export function completeRelations(types: RelationTypes, world: WorldDoc, entities: Record<EntityId, { relations: RelationInstance[] }>): void {
  const added: { holder: EntityId; relation: RelationInstance }[] = [];
  for (const id of Object.keys(entities).sort()) {
    for (const r of own(entities, id)?.relations ?? []) {
      const back = counterpartOf(types, world, r.type);
      const holder = own(entities, r.to);
      if (!back || !holder || (back === r.type && r.to === id)) continue;
      const present = (x: RelationInstance): boolean => x.type === back && x.to === id;
      if (holder.relations.some(present) || added.some((a) => a.holder === r.to && present(a.relation))) continue;
      added.push({ holder: r.to, relation: { type: back, to: id, ...(r.fields ? { fields: structuredClone(r.fields) } : {}), ...(r.until !== undefined ? { until: r.until } : {}) } });
    }
  }
  for (const { holder, relation } of added) own(entities, holder)?.relations.push(relation);
}

/**
 * Lint for authored relations: an inverse that names no relation type, links between kinds their
 * type doesn't allow, and cardinality broken by the relations a chat starts with (errors); and
 * symmetric or inverse links authored on one side only (a warning naming the missing side).
 */
export function relationIssues(reg: Registry, world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => void issues.push({ severity: "error", path, code, message });
  for (const [id, def] of Object.entries(world.relations)) {
    if (def.inverse && !relationDef(reg, world, def.inverse)) err(`relations.${id}.inverse`, "refs", `Relation ${def.label}'s inverse "${def.inverse}" isn't a relation type.`);
  }
  const nameOf = (id: EntityId): string => own(world.entities, id)?.name ?? own(world.places, id)?.name ?? id;
  for (const [id, e] of Object.entries(world.entities)) {
    for (const r of e.relations) {
      const def = relationDef(reg, world, r.type);
      if (!def) continue;
      const target = own(world.entities, r.to);
      const path = `entities.${id}.relations`;
      if (def.from !== "*" && !kindIs(reg, world, e.kind, def.from)) err(path, "relation_kind", `${e.name}'s “${def.label}” link needs ${kindPhrase(reg, world, def.from)} on ${e.name}'s side; ${e.name} is ${kindPhrase(reg, world, e.kind)}.`);
      if (def.to !== "*" && (!target || !kindIs(reg, world, target.kind, def.to))) err(path, "relation_kind", `${e.name}'s “${def.label}” link to ${nameOf(r.to)} needs ${kindPhrase(reg, world, def.to)} at the other end; ${nameOf(r.to)} is ${target ? kindPhrase(reg, world, target.kind) : "a place"}.`);
      const back = counterpartOf(reg, world, r.type);
      if (!back || !target || (back === r.type && r.to === id) || target.relations.some((x) => x.type === back && x.to === id)) continue;
      const backLabel = relationDef(reg, world, back)?.label ?? back;
      issues.push({ severity: "warning", path, code: "one_sided", message: `${e.name} is ${inline(def)} ${target.name}, but ${target.name} has no “${backLabel}” link back to ${e.name}; a chat adds it when it starts.` });
    }
  }
  // Cardinality over the relations a chat starts with: the authored ones, their missing sides added.
  const start: Record<EntityId, { relations: RelationInstance[] }> = {};
  for (const [id, e] of Object.entries(world.entities)) start[id] = { relations: e.relations.map((r) => ({ ...r })) };
  completeRelations(reg, world, start);
  const sources = new Map<string, EntityId[]>();
  for (const id of Object.keys(start).sort()) {
    const counts = new Map<string, EntityId[]>();
    for (const r of own(start, id)?.relations ?? []) {
      const def = relationDef(reg, world, r.type);
      if (!def) continue;
      if (oneTarget(def.cardinality)) counts.set(r.type, [...(counts.get(r.type) ?? []), r.to]);
      if (oneSource(def.cardinality)) sources.set(`${r.type}\u0000${r.to}`, [...(sources.get(`${r.type}\u0000${r.to}`) ?? []), id]);
    }
    for (const [type, targets] of counts) {
      const def = relationDef(reg, world, type);
      if (def && targets.length > 1) err(`entities.${id}.relations`, "cardinality", `${nameOf(id)} is ${inline(def)} ${targets.map(nameOf).join(" and ")}; “${def.label}” allows one.`);
    }
  }
  for (const [key, from] of sources) {
    const [type = "", to = ""] = key.split("\u0000");
    const def = relationDef(reg, world, type);
    const last = from.at(-1);
    if (def && last !== undefined && from.length > 1) err(`entities.${last}.relations`, "cardinality", `${from.map(nameOf).join(" and ")} are each ${inline(def)} ${nameOf(to)}; “${def.label}” allows one.`);
  }
  return issues;
}
