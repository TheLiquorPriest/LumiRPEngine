// The Upgrade merge (DESIGN §4.3 `migrate`). A `migrate` marker with picks brings a newer
// revision's definition changes into a running chat as a deterministic step of the fold, computed
// from the revision the chat's definitions come from, the new revision, the touched record
// (`touched.ts`) and the owner's picks, which are intent only: every value comes from a revision.
// Both folds and every plan run this same code, so a swipe, branch or Re-narrate after the Upgrade
// folds it afresh. A `migrate` without picks only switches the revision, as it always has; the chat
// then remembers which revision its definitions still come from, so a later Upgrade with picks
// brings in everything since.
//
// Each part defaults to `take` when no applied event touched it and to `keep` when one did; a pick
// for the part, else one for its whole entity, overrides that:
//   - an entity new to the chat is created as a chat's first state creates it, its symmetric and
//     inverse relations two-sided, an agent caught up to now, a thing a map lays in a cell lying there;
//   - where an entity is (its place and cell) is one part, read as a chat starting on each revision
//     holds it, so a map that newly lays a thing in a cell, or moves its cell, moves it; putting it
//     into something or taking it out in play counts as moving it, and a thing held inside something
//     keeps its holder, so it never gets a place and cell while held;
//   - an entity gone from the revision stays, holding the classes, tags and visibility it had,
//     unless picked `remove`: then it leaves the world and is unlinked, as a GM's Remove does;
//   - kind, name, tier, agent flag, level overrides, classes and tags, life state, and each field;
//   - each relation by type and target; the two sides of a symmetric or inverse pair change together
//     or not at all;
//   - a taken opening balance of an account whose holder's money is open posts the difference
//     against the holder's outside account (the economy's `economy.reopen`);
//   - a track at a stage the revision no longer has goes back to its start, with a Journal note;
//   - a revision that turns the grid system on puts the POV on a cell and lets it see from there.

import { arrivalCell, cellIndex, placedItems, standingGrid } from "../shared/grid";
import { hashJson } from "../shared/hash";
import type { EntityId, FieldId, RelationTypeId, RevisionId, StageId, TrackId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { safeKey } from "../shared/json";
import { mapSettingsOf } from "../shared/maps";
import type { EntityPicks, LedgerEvent, MarkerBody, UpgradeAspect, UpgradePick, UpgradePicks } from "../shared/ledger";
import { UPGRADE_ASPECTS } from "../shared/ledger";
import { agentOf } from "../shared/tiers";
import { ALIVE, type EntityDef, type RelationInstance, type WorldDoc } from "../shared/world";
import { calendarOf, slotIndexAt } from "./calendar";
import type { EventTypes } from "./events";
import { FoldError } from "./ledger/chain";
import { mutableSlice, optionalService, own, sliceRecord } from "./pack-kit";
import type { ReadContext } from "./registry";
import { completeRelations, counterpartOf, type RelationTypes } from "./relations";
import { GONE_FIELD, placeOfEntity } from "./scope";
import type { EntityState, WorldState } from "./state";
import { observeCells } from "./seen";
import { forget, touchedAnyRelation, touchedAspect, touchedField, touchedRelation } from "./touched";
import { visibilityOf } from "./visibility";
import { clampLevels } from "./world-state";

/** What the merge needs from the registry: event types (an account's posting), relation types and read contexts. */
export interface UpgradeTypes extends EventTypes, RelationTypes {
  context(world: WorldDoc, state: Readonly<WorldState>): ReadContext;
}

/** What applying a marker needs besides the state: the world revisions and the registry. */
export interface MarkerEnv {
  worlds(revision: RevisionId): WorldDoc | undefined;
  types: UpgradeTypes;
}

/** An account's authored opening balance (the economy's field): once its holder's money is open, the balance holds it. */
const OPENING = "opening";

const PACK = "engine";
/** The revision the chat's definitions come from, while an Upgrade without picks has left them behind. */
const LAG = "definitions";

/** Where something is: its place and its cell there. An Upgrade takes or keeps them as one part. */
export const PLACEMENT_FIELDS: readonly FieldId[] = ["place", "x", "y"];

/** One part of an entity that differs between the revisions: the chat's value now, the revision's, and whether play wrote it. */
export interface PartDiff<V = unknown> {
  now: V;
  next: V;
  touched: boolean;
}

/** A relation that differs, by type and target. */
export interface RelationDiff {
  rel: RelationTypeId;
  to: string;
  /** The chat's relation now, or null. */
  now: RelationInstance | null;
  /** The revision's, or null when the revision drops it. */
  next: RelationInstance | null;
  touched: boolean;
  /** The other side of a symmetric or inverse pair: when it changes too, both change together or neither does. */
  partner: { holder: EntityId; rel: RelationTypeId } | null;
}

export interface EntityDiff {
  id: EntityId;
  /** New to the chat, gone from the revision, or changed. */
  status: "new" | "removed" | "changed";
  /** The revision's definition; the earlier one for an entity gone from it. */
  def: EntityDef;
  aspects: Partial<Record<UpgradeAspect, PartDiff>>;
  fields: Record<FieldId, PartDiff<JsonValue | undefined>>;
  relations: RelationDiff[];
  /** A new entity's relations as a chat starting on the revision holds them, and the other sides that land on entities already in the chat. */
  start?: { relations: RelationInstance[]; links: { holder: EntityId; relation: RelationInstance }[] };
}

export interface UpgradePlan {
  /** The revision the chat's definitions come from, and the one it upgrades to. */
  from: RevisionId;
  to: RevisionId;
  entities: EntityDiff[];
  /** Tracks at a stage the revision no longer has: they go back to its start. */
  tracks: { track: TrackId; stage: StageId; start: StageId }[];
}

/** The revision the chat's entity definitions come from, when an Upgrade without picks left them behind the revision in force; null when they match it. */
export function definitionsLag(state: Readonly<WorldState>): RevisionId | null {
  const v = state.packs[PACK]?.[LAG];
  return typeof v === "string" ? v : null;
}

/** Notes the revision the definitions come from, or (null) that they match the revision in force again. */
function setLag(state: WorldState, revision: RevisionId | null): void {
  if (revision !== null) {
    mutableSlice(state, PACK)[LAG] = revision;
    return;
  }
  const slice = state.packs[PACK];
  if (!slice) return;
  delete slice[LAG];
  if (Object.keys(slice).length === 0) delete state.packs[PACK];
}

function revisionDoc(env: MarkerEnv, revision: RevisionId): WorldDoc {
  const world = env.worlds(revision);
  if (!world) throw new FoldError(`unknown revision ${revision}`);
  return world;
}

/** Deep equality of plain values (key order aside). */
function same(a: unknown, b: unknown): boolean {
  return a === undefined || b === undefined ? a === b : hashJson(a) === hashJson(b);
}

/** Every entity's relations as a chat starting on `world` holds them: the authored ones, their other sides added. */
function startRelations(types: RelationTypes, world: WorldDoc): Record<EntityId, RelationInstance[]> {
  const holders: Record<EntityId, { relations: RelationInstance[] }> = {};
  for (const [id, e] of Object.entries(world.entities)) holders[id] = { relations: structuredClone(e.relations) };
  completeRelations(types, world, holders);
  const out: Record<EntityId, RelationInstance[]> = {};
  for (const [id, e] of Object.entries(holders)) out[id] = e.relations;
  return out;
}

const relationKey = (r: Pick<RelationInstance, "type" | "to">): string => `${r.type}\u0000${r.to}`;

/** Relations by type and target; the first of a duplicate counts, as the reducers find it. */
function byKey(list: readonly RelationInstance[]): Map<string, RelationInstance> {
  const out = new Map<string, RelationInstance>();
  for (const r of list) if (!out.has(relationKey(r))) out.set(relationKey(r), r);
  return out;
}

/** Classes and tags as one part: both are how selectors match an entity. */
function classesOf(e: Pick<EntityDef, "class" | "tags"> | undefined): { class: Record<string, string[]>; tags: string[] } {
  return { class: e?.class ?? {}, tags: e?.tags ?? [] };
}

/** A definition as the chat holds it, for an entity the revision defines but the earlier one didn't (play created it, or an older revision left it). */
function heldDef(id: EntityId, e: EntityState): EntityDef {
  return { id, kind: e.kind, name: e.name, tier: e.tier, fields: e.fields, relations: e.relations, levels: e.levels, agent: e.agent, ...(e.class ? { class: e.class } : {}), ...(e.tags ? { tags: e.tags } : {}), ...(e.life ? { life: e.life } : {}) };
}

/**
 * An entity's fields as a chat starting on a revision holds them: a thing that revision's maps lay
 * in a cell (`placedItems`) lies there, unless it starts inside something.
 */
function laidFields(def: EntityDef, laid: { place: string; cell: { x: number; y: number } } | undefined, relations: readonly RelationInstance[] | undefined): JsonObject {
  if (!laid || (relations ?? []).some((r) => r.type === "in")) return def.fields;
  return { ...def.fields, place: laid.place, x: laid.cell.x, y: laid.cell.y };
}

/**
 * What an Upgrade to `to` would change in this chat: every entity new to it, gone from the
 * revision or changed, part by part, with whether play touched each part, and the tracks whose
 * stage the revision dropped. The preview lists it; the fold applies it with the picks.
 */
export function planUpgrade(state: Readonly<WorldState>, env: MarkerEnv, to: RevisionId): UpgradePlan {
  const from = definitionsLag(state) ?? state.revision;
  const before = revisionDoc(env, from);
  const inForce = revisionDoc(env, state.revision);
  const after = revisionDoc(env, to);
  const oldRel = startRelations(env.types, before);
  const newRel = startRelations(env.types, after);
  const oldLaid = new Map(placedItems(before).map((item) => [item.id, item]));
  const newLaid = new Map(placedItems(after).map((item) => [item.id, item]));
  // An entity gone from the revision decides its own relations, and one new to the chat brings its own.
  const leaving = (id: string): boolean => own(before.entities, id) !== undefined && own(after.entities, id) === undefined && own(state.entities, id) !== undefined;
  const arriving = (id: string): boolean => own(after.entities, id) !== undefined && own(state.entities, id) === undefined;
  const entities: EntityDiff[] = [];
  const ids = [...new Set([...Object.keys(before.entities), ...Object.keys(after.entities)])].filter(safeKey).sort();
  for (const id of ids) {
    const was = own(before.entities, id);
    const next = own(after.entities, id);
    const now = own(state.entities, id);
    if (!now) {
      // An entity left out of an earlier Upgrade comes up again only once its definition changes.
      if (!next || (was && same(was, next))) continue;
      const relations = (newRel[id] ?? []).map((r) => structuredClone(r));
      const links: { holder: EntityId; relation: RelationInstance }[] = [];
      for (const holder of Object.keys(state.entities).sort()) {
        if (own(after.entities, holder)) {
          for (const r of own(newRel, holder) ?? []) if (r.to === id) links.push({ holder, relation: structuredClone(r) });
          continue;
        }
        // An entity the revision no longer defines gets the other side of a pair as a chat's first state would give it.
        for (const r of relations) {
          const back = counterpartOf(env.types, after, r.type);
          if (r.to === holder && back) links.push({ holder, relation: { type: back, to: id, ...(r.fields ? { fields: structuredClone(r.fields) } : {}), ...(r.until !== undefined ? { until: r.until } : {}) } });
        }
      }
      entities.push({ id, status: "new", def: next, aspects: {}, fields: {}, relations: [], start: { relations, links } });
      continue;
    }
    if (!next) {
      if (was) entities.push({ id, status: "removed", def: was, aspects: {}, fields: {}, relations: [] });
      continue;
    }
    const base = was ?? heldDef(id, now);
    // Play created it: every part of it is play's.
    const whole = touchedAspect(state, id, "spawned");
    const aspects: Partial<Record<UpgradeAspect, PartDiff>> = {};
    const part = (aspect: UpgradeAspect, earlier: unknown, later: unknown, held: unknown, touched: boolean): void => {
      if (!same(earlier, later)) aspects[aspect] = { now: held, next: later, touched: whole || touched };
    };
    part("kind", base.kind, next.kind, now.kind, false);
    part("name", base.name, next.name, now.name, false);
    part("tier", base.tier, next.tier, now.tier, touchedAspect(state, id, "tier"));
    part("agent", was ? agentOf(before, was) : now.agent, agentOf(after, next), now.agent, touchedAspect(state, id, "agent"));
    part("levels", clampLevels(base.levels ?? {}), clampLevels(next.levels ?? {}), now.levels, touchedAspect(state, id, "levels"));
    part("life", base.life ?? ALIVE, next.life ?? ALIVE, now.life ?? ALIVE, touchedAspect(state, id, "life"));
    // Classes and tags are read live from the revision in force, so the chat's are those, unless it
    // holds its own (spawned, kept through an Upgrade, or set by a GM edit, which counts as play's).
    const held = now.class !== undefined || now.tags !== undefined ? classesOf(now) : classesOf(own(inForce.entities, id) ?? base);
    part("class", held, classesOf(next), held, touchedAspect(state, id, "class"));
    // Fields as a chat starting on each revision holds them, so where a map lays a thing counts.
    const earlier = was ? laidFields(was, oldLaid.get(id), own(oldRel, id)) : base.fields;
    const later = laidFields(next, newLaid.get(id), own(newRel, id));
    const fields: Record<FieldId, PartDiff<JsonValue | undefined>> = {};
    for (const f of [...new Set([...Object.keys(earlier), ...Object.keys(later)])].filter((f) => safeKey(f) && !PLACEMENT_FIELDS.includes(f)).sort()) {
      const value = own(later, f);
      if (same(own(earlier, f), value)) continue;
      // A balance that moved in play holds the opening it started from, so a new opening is play's call too.
      const touched = whole || touchedField(state, id, f) || (f === OPENING && touchedAspect(state, id, "posted"));
      fields[f] = { now: own(now.fields, f), next: value, touched };
    }
    // Its place and cell are one part: a move in play keeps all of it, and taking any of it takes the
    // revision's place and cell together, so a cell never lands in another place than its own. Play
    // putting it into something or taking it out (`in`) moved it too.
    if (PLACEMENT_FIELDS.some((f) => !same(own(earlier, f), own(later, f)))) {
      const touched = whole || PLACEMENT_FIELDS.some((f) => touchedField(state, id, f)) || touchedAnyRelation(state, id, "in");
      for (const f of PLACEMENT_FIELDS) if (!same(own(now.fields, f), own(later, f))) fields[f] = { now: own(now.fields, f), next: own(later, f), touched };
    }
    const olds = byKey(was ? (own(oldRel, id) ?? []) : now.relations);
    const nexts = byKey(own(newRel, id) ?? []);
    const chats = byKey(now.relations);
    const relations: RelationDiff[] = [];
    for (const key of [...new Set([...olds.keys(), ...nexts.keys()])].sort()) {
      const o = olds.get(key) ?? null;
      const n = nexts.get(key) ?? null;
      const r = n ?? o;
      if (!r || (o && n && same(o, n)) || leaving(r.to) || arriving(r.to)) continue;
      const back = counterpartOf(env.types, n ? after : before, r.type);
      const paired = back !== null && own(state.entities, r.to) !== undefined && !(back === r.type && r.to === id);
      relations.push({ rel: r.type, to: r.to, now: chats.get(key) ?? null, next: n, touched: whole || touchedRelation(state, id, r.type, r.to), partner: paired && back ? { holder: r.to, rel: back } : null });
    }
    if (Object.keys(aspects).length > 0 || Object.keys(fields).length > 0 || relations.length > 0) entities.push({ id, status: "changed", def: next, aspects, fields, relations });
  }
  const tracks: UpgradePlan["tracks"] = [];
  for (const id of Object.keys(state.tracks).sort()) {
    const t = own(after.tracks, id);
    const at = own(state.tracks, id);
    if (t && at && !own(t.stages, at.stage) && own(t.stages, t.start)) tracks.push({ track: id, stage: at.stage, start: t.start });
  }
  return { from, to, entities, tracks };
}

/** Whether a part is taken: its own pick, else its entity's, else take when play never touched it. */
function takes(entity: EntityPicks | undefined, pick: UpgradePick | undefined, touched: boolean): boolean {
  const whole = entity?.entity === "take" || entity?.entity === "keep" ? entity.entity : undefined;
  return (pick ?? whole ?? (touched ? "keep" : "take")) === "take";
}

/** A relation's pick, by its holder's picks. */
function relationPick(entity: EntityPicks | undefined, rel: RelationTypeId, to: string): UpgradePick | undefined {
  const targets = entity?.relations ? own(entity.relations, rel) : undefined;
  return targets ? own(targets, to) : undefined;
}

/** Puts a relation in place of the holder's one of the same type and target. */
function upsert(holder: EntityState, r: RelationInstance): void {
  holder.relations = holder.relations.filter((x) => !(x.type === r.type && x.to === r.to));
  holder.relations.push(structuredClone(r));
}

/**
 * Out of the world, as a GM's Remove takes it: its relations go, and everyone's relations to it but
 * what is inside it; taken out of a container, it keeps the place it was at, so Restore brings it back there.
 */
function removeEntity(state: WorldState, id: EntityId): void {
  const e = own(state.entities, id);
  if (!e) return;
  const where = placeOfEntity(state, id);
  if (where && typeof e.fields.place !== "string" && e.relations.some((r) => r.type === "in")) e.fields.place = where;
  e.relations = [];
  for (const other of Object.keys(state.entities).sort()) {
    const o = own(state.entities, other);
    if (o && other !== id) o.relations = o.relations.filter((r) => r.to !== id || r.type === "in");
  }
  e.fields[GONE_FIELD] = true;
}

/** Applies ready-made events in order, all or none, each validated against the state it will see. */
function applyAll(types: UpgradeTypes, world: WorldDoc, state: WorldState, events: readonly LedgerEvent[]): boolean {
  const scratch = structuredClone(state);
  for (const ev of events) {
    const def = types.get(ev.type);
    const ctx = types.context(world, scratch);
    if (!def || def.validate(ev, ctx)) return false;
    def.apply(ev, scratch, ctx);
  }
  Object.assign(state, scratch);
  return true;
}

/** Applies a plan with the owner's picks; returns its Journal notes. */
function applyUpgrade(state: WorldState, plan: UpgradePlan, picks: UpgradePicks, env: MarkerEnv): string[] {
  const after = revisionDoc(env, plan.to);
  const inForce = revisionDoc(env, state.revision);
  const notes: string[] = [];
  const pickOf = (id: EntityId): EntityPicks | undefined => own(picks, id);
  const created: EntityDiff[] = [];
  const agents: EntityId[] = [];
  const openings: { account: EntityId; cents: number }[] = [];
  const minor = (v: JsonValue | undefined): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

  // New entities, as a chat's first state holds them.
  for (const d of plan.entities) {
    if (d.status !== "new" || pickOf(d.id)?.entity === "keep") continue;
    const def = d.def;
    const agent = agentOf(after, { id: d.id, tier: def.tier, agent: def.agent });
    state.entities[d.id] = { kind: def.kind, name: def.name, tier: def.tier, fields: structuredClone(def.fields), relations: structuredClone(d.start?.relations ?? []), levels: clampLevels(def.levels ?? {}), agent, ...(def.life && def.life !== ALIVE ? { life: def.life } : {}) };
    created.push(d);
    if (agent) agents.push(d.id);
    if (minor(own(def.fields, OPENING)) !== 0) openings.push({ account: d.id, cents: minor(own(def.fields, OPENING)) });
  }
  // Once all are in: a link to a revision entity the chat doesn't have (one left out) is dropped, and
  // the other sides of the new ones' links land on the entities already in the chat.
  for (const d of created) {
    const e = own(state.entities, d.id);
    if (!e) continue;
    e.relations = e.relations.filter((r) => !(own(after.entities, r.to) && !own(state.entities, r.to)));
    for (const link of d.start?.links ?? []) {
      const holder = own(state.entities, link.holder);
      if (holder) upsert(holder, link.relation);
    }
  }
  // Things the revision's maps lay in cells start there, as in a chat's first state, unless they start inside something.
  for (const item of placedItems(after)) {
    const e = created.some((d) => d.id === item.id) ? own(state.entities, item.id) : undefined;
    if (e && !e.relations.some((r) => r.type === "in")) Object.assign(e.fields, { place: item.place, x: item.cell.x, y: item.cell.y });
  }

  // Changed entities: their parts, then their relations, a pair together, then where they are.
  const byId = new Map(plan.entities.map((d) => [d.id, d]));
  const decided = new Set<string>();
  const placements: { id: EntityId; fields: [FieldId, PartDiff<JsonValue | undefined>][] }[] = [];
  for (const d of plan.entities) {
    const e = own(state.entities, d.id);
    if (d.status !== "changed" || !e) continue;
    const p = pickOf(d.id);
    for (const aspect of UPGRADE_ASPECTS) {
      const diff = d.aspects[aspect];
      if (!diff) continue;
      if (!takes(p, p?.[aspect], diff.touched)) {
        // The world now reads the revision's classes and tags; keeping the chat's means holding them.
        if (aspect === "class" && e.class === undefined && e.tags === undefined) {
          const held = classesOf(own(inForce.entities, d.id));
          e.class = structuredClone(held.class);
          e.tags = [...held.tags];
        }
        continue;
      }
      if (aspect === "kind") e.kind = d.def.kind;
      else if (aspect === "name") e.name = d.def.name;
      else if (aspect === "tier") e.tier = d.def.tier;
      else if (aspect === "levels") e.levels = clampLevels(d.def.levels ?? {});
      else if (aspect === "agent") {
        const on = agentOf(after, d.def);
        if (on && !e.agent) agents.push(d.id);
        e.agent = on;
      } else if (aspect === "life") {
        if (d.def.life === undefined || d.def.life === ALIVE) delete e.life;
        else e.life = d.def.life;
      } else {
        delete e.class;
        delete e.tags;
      }
      if (aspect === "tier" || aspect === "agent" || aspect === "levels" || aspect === "class" || aspect === "life") forget(state, d.id, { aspect });
    }
    // The place and cell go together: taken only when every one of them that differs is taken, once
    // the relations are merged (below).
    const placement = PLACEMENT_FIELDS.flatMap((f): [FieldId, PartDiff<JsonValue | undefined>][] => {
      const diff = own(d.fields, f);
      return diff ? [[f, diff]] : [];
    });
    if (placement.length > 0 && placement.every(([f, diff]) => takes(p, p?.fields ? own(p.fields, f) : undefined, diff.touched))) placements.push({ id: d.id, fields: placement });
    for (const [f, diff] of Object.entries(d.fields)) {
      if (PLACEMENT_FIELDS.includes(f) || !takes(p, p?.fields ? own(p.fields, f) : undefined, diff.touched)) continue;
      if (diff.next === undefined) delete e.fields[f];
      else e.fields[f] = structuredClone(diff.next);
      forget(state, d.id, { field: f });
      if (f === OPENING) openings.push({ account: d.id, cents: minor(diff.next) - minor(diff.now) });
    }
  }
  for (const d of plan.entities) {
    for (const r of d.relations) {
      const key = `${d.id}\u0000${relationKey({ type: r.rel, to: r.to })}`;
      if (decided.has(key)) continue;
      const other = r.partner ? byId.get(r.partner.holder)?.relations.find((x) => x.rel === r.partner?.rel && x.to === d.id) : undefined;
      const members: [EntityId, RelationDiff][] = [[d.id, r]];
      if (r.partner && other) members.push([r.partner.holder, other]);
      const take = members.every(([holder, m]) => takes(pickOf(holder), relationPick(pickOf(holder), m.rel, m.to), m.touched));
      for (const [holder, m] of members) {
        decided.add(`${holder}\u0000${relationKey({ type: m.rel, to: m.to })}`);
        const e = own(state.entities, holder);
        if (!take || !e) continue;
        e.relations = e.relations.filter((x) => !(x.type === m.rel && x.to === m.to));
        if (m.next) e.relations.push(structuredClone(m.next));
        forget(state, holder, { rel: m.rel, to: m.to });
      }
    }
  }
  // A thing held inside something keeps its holder: a taken placement may clear its place and cell,
  // never give it one, so it stays in the hands or the chest it is in.
  for (const { id, fields } of placements) {
    const e = own(state.entities, id);
    if (!e) continue;
    const held = e.relations.some((r) => r.type === "in");
    for (const [f, diff] of fields) {
      if (diff.next === undefined) delete e.fields[f];
      else if (held) continue;
      else e.fields[f] = structuredClone(diff.next);
      forget(state, id, { field: f });
    }
  }

  // Entities gone from the revision: what was read from their definition is held in state now, as a
  // spawned entity's is (so a secret one stays secret); removed when picked.
  for (const d of plan.entities) {
    const e = own(state.entities, d.id);
    if (d.status !== "removed" || !e) continue;
    const def = own(inForce.entities, d.id) ?? d.def;
    if (e.class === undefined && e.tags === undefined) {
      if (def.class) e.class = structuredClone(def.class);
      if (def.tags) e.tags = [...def.tags];
    }
    if (def.visibility !== undefined && e.fields.visibility === undefined) e.fields.visibility = def.visibility;
    if (def.knownBy !== undefined && e.fields.knownBy === undefined) e.fields.knownBy = JSON.parse(JSON.stringify(def.knownBy)) as JsonValue;
    if (pickOf(d.id)?.entity === "remove" && e.fields[GONE_FIELD] !== true) removeEntity(state, d.id);
  }

  // Opening balances of accounts already open: the difference posts against the holder's outside
  // account. The posting is the Upgrade's, not play's, so it leaves the balance untouched.
  const reopen = optionalService(env.types.context(after, state), "economy.reopen");
  for (const { account, cents } of openings.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0))) {
    if (!reopen || cents === 0 || !own(state.entities, account)) continue;
    const posted = touchedAspect(state, account, "posted");
    if (applyAll(env.types, after, state, reopen(env.types.context(after, state), account, cents)) && !posted) forget(state, account, { aspect: "posted" });
  }

  for (const t of plan.tracks) {
    state.tracks[t.track] = { stage: t.start, since: state.clock };
    const def = own(after.tracks, t.track);
    // Only a public track's stages reach the player (`eventVisible`).
    if (def && visibilityOf(def.visibility) === "public") notes.push(`${def.label}: back to ${own(def.stages, t.start)?.label ?? "its start"}, since this revision of the world no longer has the stage it was at`);
  }

  // A new agent starts caught up: it never replays the slots from before it joined.
  const slot = slotIndexAt(calendarOf(after), state.clock);
  for (const id of agents) sliceRecord(state, PACK, "agents")[id] = slot;
  // A POV the revision doesn't place starts where the world says the story starts, as a chat's first state does.
  const pov = own(state.entities, after.pov);
  if (pov && placeOfEntity(state, after.pov) === null && own(after.places, after.start.place)) pov.fields.place = after.start.place;

  setLag(state, null);
  state.revision = plan.to;
  // A revision that turns the grid system on puts the POV on a cell of the grid it stands on, as a
  // chat's first state does (its own cell there, else where its place is entered), and it sees from there.
  if (pov && mapSettingsOf(after).grid.movement) {
    const here = placeOfEntity(state, after.pov);
    const stand = standingGrid(after, here);
    const { x, y } = pov.fields;
    const onCell = stand !== null && typeof x === "number" && typeof y === "number" && cellIndex(stand.grid, { x, y }) !== null;
    const entry = onCell || here === null ? null : arrivalCell(after, here);
    if (entry) Object.assign(pov.fields, { x: entry.cell.x, y: entry.cell.y });
    observeCells(state, after);
  }
  return notes;
}

/**
 * A `migrate` marker's step: with picks, the revision's definition changes merge into the state
 * (returning the Journal notes it makes); without, only the revision switches, and the state notes
 * which revision its definitions still come from.
 */
export function migrate(state: WorldState, body: Extract<MarkerBody, { kind: "migrate" }>, env: MarkerEnv): string[] {
  if (body.merge) return applyUpgrade(state, planUpgrade(state, env, body.to), body.merge, env);
  const lag = definitionsLag(state);
  if (lag === null && body.to !== state.revision) setLag(state, state.revision);
  else if (lag === body.to) setLag(state, null);
  state.revision = body.to;
  return [];
}
