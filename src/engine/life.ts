// Life states (DESIGN §8): whether someone is alive, dying, dead or in a state the world defines
// (`WorldDoc.lifeStates`), whether they still act in it, and who knows it. The state is the
// entity's own (`EntityState.life`, absent while alive), written only by `engine.life`, which
// declares it touched, so an Upgrade keeps it.
//
// Knowledge is the engine slice's `life`: for each subject whose state changed in play, what
// everyone took it to be before (`base`) and what each person who has learned of it since last
// learned (`by`). A subject without an entry never changed in play, so everyone takes it as it is.
// It is written inside event apply, so both folds keep it alike and an old chat rebuilds it on
// replay: a change teaches everyone in the subject's place (the witnesses), `engine.told` teaches
// whom it names, and an event that moves someone teaches everyone it leaves in a place with a
// subject (`knowing`): someone walking in on a body, or a body carried in. People learn; things don't.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import { ALIVE, isLifeState, lifeStateOf, lifeStatesOf, type LifeStateDef, type LifeStateId, type WorldDoc } from "../shared/world";
// Read only inside functions: `engine-pack` imports this module, so its constants aren't there while both load.
import { ENGINE_EVENTS } from "./engine-pack";
import { labelOf, own } from "./pack-kit";
import type { EventTypeDef, ProposalChannelDef, ReadContext, Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { isGone, kindIs, placeOfEntity } from "./scope";
import { movesSomeone } from "./seen";
import { selectEntities } from "./selector";
import type { EntityState, WorldState } from "./state";
import { knownBySelector } from "./visibility";

const PACK = "engine";
const SLICE = "life";

type Entities = { entities: Record<EntityId, EntityState> };

/** An entity's life state: its own, else alive. */
export function lifeOf(state: Entities, id: EntityId): LifeStateId {
  return own(state.entities, id)?.life ?? ALIVE;
}

/** Whether someone still acts in the state they're in: follows schedules and day plans, chooses and takes combat turns (DESIGN §8). */
export function acts(world: Pick<WorldDoc, "lifeStates">, state: Entities, id: EntityId): boolean {
  return lifeStateOf(world, lifeOf(state, id)).acts;
}

/** A subject's knowledge entry, or null when its state never changed in play. */
function entryOf(state: Readonly<WorldState>, subject: EntityId): { base: LifeStateId; by: JsonObject } | null {
  const all = state.packs[PACK]?.[SLICE];
  const entry = isRecord(all) ? own(all, subject) : undefined;
  return isRecord(entry) && typeof entry.base === "string" && isRecord(entry.by) ? { base: entry.base, by: entry.by as JsonObject } : null;
}

/**
 * What `knower` takes `subject`'s life state to be: the truth for the subject itself and while the
 * state never changed in play; else the last they learned of it, or what everyone took it to be before.
 */
export function lifeKnownTo(state: Readonly<WorldState>, subject: EntityId, knower: EntityId): LifeStateId {
  const entry = knower === subject ? null : entryOf(state, subject);
  if (!entry) return lifeOf(state, subject);
  const learned = own(entry.by, knower);
  return typeof learned === "string" ? learned : entry.base;
}

/** The life state the POV takes someone to be in, when that isn't alive: all Play and the narrator show of it (DESIGN §7). */
export function povLife(world: WorldDoc, state: Readonly<WorldState>, subject: EntityId): (LifeStateDef & { id: LifeStateId }) | null {
  const id = lifeKnownTo(state, subject, world.pov);
  return id === ALIVE ? null : { id, ...lifeStateOf(world, id) };
}

function isPerson(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  const e = own(state.entities, id);
  return !!e && kindIs(reg, world, e.kind, "person") && !isGone(state, id);
}

/**
 * Who knows a subject's life state as it is (the GM view): everyone but `unaware` while nobody's
 * word of it is older than its change, else only `aware`. People only, the subject left out.
 */
export function lifeAwareness(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, subject: EntityId): { everyone: boolean; aware: EntityId[]; unaware: EntityId[] } {
  const entry = entryOf(state, subject);
  if (!entry) return { everyone: true, aware: [], unaware: [] };
  const truth = lifeOf(state, subject);
  const everyone = entry.base === truth;
  const people = Object.keys(state.entities)
    .sort()
    .filter((id) => id !== subject && isPerson(reg, world, state, id));
  const aware = people.filter((id) => lifeKnownTo(state, subject, id) === truth);
  return { everyone, aware: everyone ? [] : aware, unaware: everyone ? people.filter((id) => !aware.includes(id)) : [] };
}

/** The `by` record of a subject's entry, made with `base` when it has none. */
function learners(state: WorldState, subject: EntityId, base: LifeStateId): JsonObject {
  const slice = state.packs[PACK] ?? {};
  state.packs[PACK] = slice;
  const all: JsonObject = isRecord(slice[SLICE]) ? (slice[SLICE] as JsonObject) : {};
  slice[SLICE] = all;
  const found = own(all, subject);
  if (isRecord(found) && typeof found.base === "string" && isRecord(found.by)) return found.by as JsonObject;
  const by: JsonObject = {};
  all[subject] = { base, by };
  return by;
}

/** People in a place, in id order: who learns what they find there. */
function peopleAt(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, place: PlaceId): EntityId[] {
  return Object.keys(state.entities)
    .sort()
    .filter((id) => placeOfEntity(state, id) === place && isPerson(reg, world, state, id));
}

/** The people with a subject as its state changes: who see it change. */
function witnessesOf(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, subject: EntityId): EntityId[] {
  const place = placeOfEntity(state, subject);
  return place === null ? [] : peopleAt(reg, world, state, place).filter((id) => id !== subject);
}

/**
 * `engine.life`'s apply: the subject's new state, learned by those who saw it change (`witnesses`,
 * recorded as it resolved); an event recorded before witnesses were teaches whoever is with it.
 */
export function applyLife(state: WorldState, ctx: ReadContext, subject: EntityId, to: LifeStateId, witnesses: readonly EntityId[] | null): void {
  const e = own(state.entities, subject);
  if (!e) return;
  const by = learners(state, subject, lifeOf(state, subject));
  const seen = witnesses ?? witnessesOf(ctx.registry, ctx.world, state, subject);
  if (to === ALIVE) delete e.life;
  else e.life = to;
  for (const id of seen) if (id !== subject && own(state.entities, id)) by[id] = to;
}

/**
 * A chat's first state: someone whose world names who knows the life state they start in
 * (`lifeKnownBy`) is known so by those alone; everyone else takes them for alive until they see or hear.
 */
export function seedLife(world: WorldDoc, state: WorldState): void {
  for (const [id, def] of Object.entries(world.entities)) {
    const start = lifeOf(state, id);
    if (!def.lifeKnownBy?.length || start === ALIVE) continue;
    const by = learners(state, id, ALIVE);
    for (const knower of def.lifeKnownBy) if (knower !== id && own(state.entities, knower)) by[knower] = start;
  }
}

/** `engine.told`'s apply: those named learn the subject's state as it is. While it never changed in play, everyone knows it already. */
export function tellLife(state: WorldState, subject: EntityId, who: readonly EntityId[]): void {
  const entry = entryOf(state, subject);
  if (!entry) return;
  const truth = lifeOf(state, subject);
  const by = learners(state, subject, entry.base);
  for (const id of who) if (id !== subject && own(state.entities, id)) by[id] = truth;
}

/** Teaches everyone in `place` what became of every subject there whose state changed in play. */
function learnIn(reg: Registry, world: WorldDoc, state: WorldState, place: PlaceId): void {
  const all = state.packs[PACK]?.[SLICE];
  if (!isRecord(all)) return;
  const subjects = Object.keys(all).filter((s) => placeOfEntity(state, s) === place);
  if (subjects.length === 0) return;
  const people = peopleAt(reg, world, state, place);
  for (const s of subjects) {
    const truth = lifeOf(state, s);
    const stale = people.filter((id) => id !== s && lifeKnownTo(state, s, id) !== truth);
    if (stale.length === 0) continue;
    const by = learners(state, s, truth);
    for (const id of stale) by[id] = truth;
  }
}

/** The entity an event that moves someone moves (with whatever it holds). */
function movedBy(e: LedgerEvent): EntityId | null {
  if (e.type === "set") return e.entity;
  if (e.type === "link" || e.type === "unlink") return e.from;
  return e.type === "spawn" ? e.entity.id : null;
}

/** A core event type whose apply also teaches whoever it leaves in a place with a subject what became of them. */
export function knowing(def: EventTypeDef): EventTypeDef {
  if (def.type !== "set" && def.type !== "link" && def.type !== "unlink" && def.type !== "spawn") return def;
  return {
    ...def,
    apply: (e, state, ctx) => {
      def.apply(e, state, ctx);
      const moved = movesSomeone(e) ? movedBy(e) : null;
      const place = moved === null ? null : placeOfEntity(state, moved);
      if (place !== null) learnIn(ctx.registry, ctx.world, state, place);
    },
  };
}

/** Who a `tell` names: an entity id, a list of them, or a selector. */
function listeners(ctx: ReadContext, raw: JsonValue | undefined): EntityId[] | Rejection {
  if (raw === undefined || raw === null || raw === "") return [];
  if (isRecord(raw)) {
    const selector = knownBySelector(raw);
    return selector ? selectEntities(ctx.registry, ctx.world, ctx.state, selector) : { code: "bad_args", reason: "tell names people by id or a selector" };
  }
  const ids = (Array.isArray(raw) ? raw : [raw]).map((v) => (typeof v === "string" ? v : ""));
  const missing = ids.find((id) => !own(ctx.state.entities, id));
  return missing === undefined ? ids : { code: "missing_entity", reason: `there's no ${labelOf(ctx, missing)} to tell` };
}

/**
 * The `life` effect (DESIGN §8): sets an entity's life state (`to`), tells people what it is
 * (`tell`: an id, a list or a selector), or both; everyone with it as it changes learns it anyway.
 * Nothing to do is no events, so a rule that kills someone already dead changes nothing. The POV's
 * lesson is an event of its own: a Journal line names only people the player knows, and the
 * others told may be strangers.
 */
export function lifeEffect(args: Record<string, JsonValue>, ctx: ReadContext): LedgerEvent[] | Rejection {
  const subject = typeof args.entity === "string" ? args.entity : "";
  if (!own(ctx.state.entities, subject)) return { code: "missing_entity", reason: `there's no ${labelOf(ctx, subject)}` };
  if (isGone(ctx.state, subject)) return { code: "gone", reason: `${labelOf(ctx, subject)} has been removed` };
  const given = args.to;
  if (given !== undefined && given !== null && typeof given !== "string") return { code: "bad_args", reason: "a life state is named by its id" };
  const to = typeof given === "string" && given !== "" ? given : null;
  if (to !== null && !isLifeState(ctx.world, to)) return { code: "bad_life", reason: `there's no life state ${to}` };
  const who = listeners(ctx, args.tell);
  if (!Array.isArray(who)) return who;
  if (to === null && who.length === 0) return { code: "bad_args", reason: "a life change needs a state to set or someone to tell" };
  const now = lifeOf(ctx.state, subject);
  const out: LedgerEvent[] = to !== null && to !== now ? [{ type: ENGINE_EVENTS.life, data: { entity: subject, to, witnesses: witnessesOf(ctx.registry, ctx.world, ctx.state, subject) } }] : [];
  const after = to ?? now;
  const told = who.filter((id) => id !== subject && (out.length > 0 || lifeKnownTo(ctx.state, subject, id) !== after));
  const pov = told.filter((id) => id === ctx.world.pov);
  const others = told.filter((id) => id !== ctx.world.pov);
  for (const group of [pov, others]) if (group.length > 0) out.push({ type: ENGINE_EVENTS.told, data: { entity: subject, who: group } });
  return out;
}

/** A life state a reply names, by id or label in any case. */
function stateNamed(world: WorldDoc, said: JsonValue | undefined): LifeStateId | null {
  const s = typeof said === "string" ? said.trim().toLowerCase() : "";
  return lifeStatesOf(world).find(([id, def]) => id === s || def.label.toLowerCase() === s)?.[0] ?? null;
}

/**
 * The `life` narration channel (DESIGN §9.4): a reply says someone died, is dying, collapsed or came
 * round. The player was told, so the POV learns it; when it is already so (a death the player hadn't
 * heard of), only that. Judged by what the player knows: a state they know of is nothing new, and
 * one they don't is never given away by a refusal.
 */
export const lifeChannel: ProposalChannelDef = {
  type: "life",
  boundField: "life",
  validate(p, ctx) {
    const subject = typeof p.entity === "string" ? p.entity : "";
    const e = own(ctx.state.entities, subject);
    if (!e || isGone(ctx.state, subject)) return { code: "missing_entity", reason: "there's no one by that name" };
    if (!kindIs(ctx.registry, ctx.world, e.kind, "person")) return { code: "not_a_character", reason: "only people live and die" };
    const to = stateNamed(ctx.world, p.state);
    if (to === null) return { code: "bad_life", reason: `there's no life state ${typeof p.state === "string" ? p.state : ""}`.trim() };
    if (lifeKnownTo(ctx.state, subject, ctx.world.pov) === to) return { code: "already", reason: `${e.name} already ${lifeStateOf(ctx.world, to).reads}` };
    return null;
  },
  toEffects(p, ctx) {
    return [{ type: "life", args: { entity: typeof p.entity === "string" ? p.entity : "", to: stateNamed(ctx.world, p.state) ?? ALIVE, tell: [ctx.world.pov] } }];
  },
};
