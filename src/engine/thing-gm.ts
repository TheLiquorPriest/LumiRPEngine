// GM → Things (ITEMS-SPEC §10.2, §6.2): what the GM's pages read of things beyond Build's
// (`thing-view.ts`), from a chat's head and the events on its path (`PathEvent`, which the backend
// lists from the chat's records): why the one who has a thing has it, where it rests and where Put
// it away takes it, its history in the chat, the loans Hand to… offers, and the things and places
// the chat made in play, with the draft patch that keeps them in the world under their own ids, so
// an Upgrade then follows its keep and take picks. Pure.

import { ownersIn } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { pointerOf } from "../shared/json-patch";
import type { LedgerEvent } from "../shared/ledger";
import type { JsonPatchOp } from "../shared/protocol";
import type { GmThingExtras, GmThingsList, HistorySource, KeepResult, LoanChoice, MadePlaceView, MadeThingView, RestView, ThingHistoryEntry, TidyFinding } from "../shared/thing-gm";
import type { Spot } from "../shared/things";
import { gotOf, grantBasisOf, type GotHow } from "../shared/things";
import type { EntityDef, RelationInstance, WorldDoc } from "../shared/world";
import { listWords } from "../shared/words";
import { calendarOf, formatClock } from "./calendar";
import { own } from "./pack-kit";
import { baseWorld, keptPlace, madePlaces, type MadePlace } from "./places-in-play";
import { authorLines } from "./player-events";
import { readPass } from "./read-pass";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { GONE_FIELD, isGone, kindIs, placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { thingIndex } from "./thing-index";
import { spotSteps, thingVisibility, whereOf } from "./thing-view";
import { holderOf, isThing, possessorOf, restOf, spotOf, whoseOf } from "./things";
import { knows } from "./visibility";

/**
 * One event on the chat's path, in order: the turn it came with (the player's messages before it),
 * what made it (`HistorySource`), and the unit it came in (a record's phase, one fix or answered
 * chip), within which a change's `group` ties its events together.
 */
export interface PathEvent {
  turn: number;
  origin: HistorySource;
  unit: string;
  event: LedgerEvent;
}

/** The path's events with a materialization's own events after it, as they applied. */
export function* flatPath(path: Iterable<PathEvent>): Generator<PathEvent> {
  for (const p of path) {
    yield p;
    if (p.event.type === "materialize") yield* flatPath(p.event.events.map((event) => ({ ...p, event })));
  }
}

const nameOf = (ctx: Pick<ReadContext, "world" | "state">, id: string): string => own(ctx.state.entities, id)?.name ?? own(ctx.world.places, id)?.name ?? id;

// ---------------------------------------------------------------- why someone has it

/** How someone came to have a thing (`got.how`), as its page says it; `from` is whom from, `owners` whose it is. */
function gotWords(how: GotHow, from: string | null, owners: string | null): string {
  switch (how) {
    case "bought":
      return "Bought it";
    case "given":
      return from ? `Given it by ${from}` : "Given it";
    case "holding":
      return owners ? `Holding it for ${owners}` : "Holding it for its owner";
    case "loan":
      return from ? `Borrowing it from ${from}` : "Borrowing it";
    case "found":
      return "Found it";
    case "took":
      return "Took it, with no right to it";
    case "fetched":
      return "Fetched it";
    case "put_away":
      return "Put away on them";
    case "made":
      return "Had it since it was made";
  }
}

/**
 * Why the one who has a thing has it (ITEMS-SPEC §3.3), in words: what its `got` says (with the
 * story's why), else their own (stated or presumed), else what a grant to them says. Null when
 * nobody has it.
 */
export function thingWhy(ctx: ReadContext, id: EntityId): string | null {
  const who = possessorOf(ctx, id);
  if (who === null) return null;
  const whose = whoseOf(ctx, id);
  const owners = whose.owners.length > 0 ? listWords(whose.owners.map((o) => nameOf(ctx, o))) : null;
  const got = gotOf(own(ctx.state.entities, id)?.fields.got);
  if (got) {
    const words = gotWords(got.how, got.from !== undefined ? nameOf(ctx, got.from) : null, owners);
    return got.why ? `${words}: ${got.why}` : words;
  }
  if (whose.owners.includes(who)) return whose.presumed === undefined ? "Theirs" : "Theirs, presumed: nobody says otherwise";
  const grant = own(ctx.state.entities, who)?.relations.find((r) => r.type === "uses" && r.to === id);
  if (grant) {
    const basis = grantBasisOf(grant.fields, grant.until);
    return basis === "hold" ? (owners ? `Holding it for ${owners}` : "Holding it for its owner") : basis === "loan" ? "Borrowing it" : "May use it";
  }
  return owners ? `Has it; it is ${owners}'s` : "Has it";
}

// ---------------------------------------------------------------- where it rests

/** Where a thing rests (ITEMS-SPEC §4.3), as its page shows it; null when nothing says. */
export function restView(ctx: ReadContext, id: EntityId): RestView | null {
  const { rest, from } = restOf(ctx, id);
  if (rest === null || from === "none") return null;
  return { owner: rest === "owner", where: rest === "owner" ? [] : spotSteps(ctx, rest), from };
}

/**
 * Where Put it away takes a thing: its rest, and for one that rests on its owner, into its owner
 * when that is a person in the world. Null when it is there already (and nowhere else), or its rest
 * is nowhere a move reaches.
 */
export function putAwaySpot(ctx: ReadContext, id: EntityId): Spot | null {
  const { rest } = restOf(ctx, id);
  if (rest === null) return null;
  let to: Spot | null = null;
  if (rest === "owner") {
    const owner = ownersIn(own(ctx.state.entities, id)?.fields ?? {})
      .map((o) => o.party)
      .find((p) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, p)?.kind ?? "", "person") && !isGone(ctx.state, p));
    to = owner !== undefined ? { in: owner } : null;
  } else to = rest;
  if (to === null) return null;
  const e = own(ctx.state.entities, id);
  const split = typeof e?.fields.place === "string" && e.fields.place !== "" && holderOf(ctx.state, id) !== null;
  const at = spotOf(ctx.state, id);
  const there = at !== null && ("place" in at ? "place" in to && at.place === to.place : "in" in to && at.in === to.in);
  return there && !split ? null : to;
}

// ---------------------------------------------------------------- its history

/** Whether an event changes a thing: its own fields, where it is, who wears it, a grant to it, its making. */
function touches(e: LedgerEvent, id: EntityId): boolean {
  switch (e.type) {
    case "set":
    case "add":
      return e.entity === id;
    case "link":
    case "unlink":
      return e.from === id || (e.rel === "uses" && e.to === id);
    case "spawn":
      return e.entity.id === id;
    case "post":
    case "stage":
    case "clock":
    case "materialize":
    case "timelapse":
      return false;
    default:
      return "data" in e && isRecord(e.data) && (e.data.entity === id || e.data.item === id);
  }
}

/**
 * A thing's History strip (ITEMS-SPEC §10.2): the units on the chat's path that changed it, newest
 * first, at most `max`, each worded as the GM view words an edit (`authorLines`, its names as they
 * are now), with its turn and who made it.
 */
export function thingHistory(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, path: readonly PathEvent[], id: EntityId, max: number): ThingHistoryEntry[] {
  const units = new Map<string, { turn: number; source: HistorySource; events: LedgerEvent[] }>();
  for (const p of flatPath(path)) {
    if (!touches(p.event, id)) continue;
    const unit = units.get(p.unit);
    if (unit) unit.events.push(p.event);
    else units.set(p.unit, { turn: p.turn, source: p.origin, events: [p.event] });
  }
  const out: ThingHistoryEntry[] = [];
  for (const u of [...units.values()].reverse()) {
    if (out.length >= max) break;
    const lines = authorLines(registry, world, state, u.events, 4);
    if (lines.length > 0) out.push({ turn: u.turn, source: u.source, lines });
  }
  return out;
}

// ---------------------------------------------------------------- the page and the list

/** The loans Hand to… offers: ending a day, three days and a week from now, each with when in words. */
export function loanChoices(ctx: ReadContext): LoanChoice[] {
  const cal = calendarOf(ctx.world);
  const now = ctx.state.clock;
  return [
    { days: 1, words: "For a day" },
    { days: 3, words: "For three days" },
    { days: 7, words: "For a week" },
  ].map(({ days, words }) => ({ label: `${words}, until ${formatClock(cal, now + days * 1440)}`, until: now + days * 1440 }));
}

/** What GM → Things adds to a thing's page (ITEMS-SPEC §10.2); `findings` are Tidy up's on it. */
export function gmThingExtras(registry: Registry, ctx: ReadContext, path: readonly PathEvent[], id: EntityId, findings: readonly TidyFinding[], historyMax: number): GmThingExtras {
  return readPass(() => ({
    rest: restView(ctx, id),
    putAway: putAwaySpot(ctx, id),
    why: thingWhy(ctx, id),
    made: !own(ctx.world.entities, id),
    history: thingHistory(registry, ctx.world, ctx.state, path, id, historyMax),
    findings: findings.filter((f) => f.things.includes(id)),
    loans: loanChoices(ctx),
    pov: ctx.world.pov,
    found: knows(ctx.state, ctx.world.pov, id),
  }));
}

/** What GM → Things' list adds to Build's: where the player character is, and why each thing someone has is theirs to have. */
export function gmThingsList(ctx: ReadContext): GmThingsList {
  return readPass(() => {
    const why: Record<EntityId, string> = {};
    for (const id of thingIndex(ctx).things) {
      if (isGone(ctx.state, id)) continue;
      const words = thingWhy(ctx, id);
      if (words !== null) why[id] = words;
    }
    return { here: placeOfEntity(ctx.state, ctx.world.pov), why };
  });
}

// ---------------------------------------------------------------- Keep in the world

/** Things made in play still in the world (spawned, not in the world document), by name, each saying whether `draft` has it already. */
export function madeThings(ctx: ReadContext, draft: Pick<WorldDoc, "entities"> | null): MadeThingView[] {
  return readPass(() =>
    thingIndex(ctx)
      .things.filter((id) => !own(ctx.world.entities, id) && !isGone(ctx.state, id))
      .map((id) => ({ id, name: nameOf(ctx, id), where: whereOf(ctx, id), inDraft: draft !== null && own(draft.entities, id) !== undefined }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  );
}

/** A made thing's fields that are the chat's bookkeeping, never the world's: how it was had and made, what Tidy up weighed, a merge, a player's claim, a loan's lateness. */
const PLAY_FIELDS: readonly string[] = ["got", "made", "maybe_same_as", "merged_into", "claimed", "overdue", GONE_FIELD];

/** The visibilities an entity definition takes. */
const VISIBILITIES: readonly string[] = ["public", "known_by", "secret", "discoverable"];

/**
 * The draft patch that keeps things made in play in the world (ITEMS-SPEC §6.2 Kept in the world),
 * each under its own id, as it is now: its kind, name, tier, classes and tags, and its fields but
 * the chat's bookkeeping (`PLAY_FIELDS`); hidden as it is hidden. What it names must be in the
 * draft, or kept with it (`places` the places kept alongside): in a holder the draft lacks, it lies
 * where that holder is; at a place the draft lacks, at the nearest place around it the draft has; an
 * owner or rest the draft lacks is dropped, and a relation to someone it lacks; each said in
 * `notes`. One the draft has already, or that isn't a thing made in play, is skipped with why.
 */
export function keepThings(ctx: ReadContext, ids: readonly EntityId[], draft: Pick<WorldDoc, "entities" | "places">, places: ReadonlySet<PlaceId> = new Set()): { ops: JsonPatchOp[]; result: Omit<KeepResult, "places"> } {
  const result: Omit<KeepResult, "places"> = { things: [], skipped: [], notes: [] };
  const wanted = [...new Set(ids)].sort();
  const keeping = new Set<EntityId>();
  for (const id of wanted) {
    const reason = !own(ctx.state.entities, id) || !isThing(ctx, id) ? "it isn't a thing in this chat" : isGone(ctx.state, id) ? "it is out of the world" : own(ctx.world.entities, id) ? "the world has it already" : own(draft.entities, id) ? "the world's draft has it already" : null;
    if (reason) result.skipped.push({ id, reason: `${nameOf(ctx, id)}: ${reason}` });
    else keeping.add(id);
  }
  const has = (id: string): boolean => own(draft.entities, id) !== undefined || keeping.has(id);
  const placeOk = (id: string): boolean => own(draft.places, id) !== undefined || places.has(id);
  /** The nearest place at or around `place` the draft has (or keeps); null for none. */
  const reachable = (place: PlaceId | null): PlaceId | null => {
    const seen = new Set<string>();
    for (let at: string | undefined = place ?? undefined; at && !seen.has(at); at = own(ctx.world.places, at)?.parent) {
      if (placeOk(at)) return at;
      seen.add(at);
    }
    return null;
  };
  // Holders first, so a thing kept inside one kept with it goes in after it.
  const depth = (id: EntityId): number => {
    let n = 0;
    for (let at = holderOf(ctx.state, id); at && n < 32; at = holderOf(ctx.state, at)) n++;
    return n;
  };
  const ops: JsonPatchOp[] = [];
  for (const id of [...keeping].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    const e = own(ctx.state.entities, id);
    if (!e) continue;
    const name = e.name;
    const fields: JsonObject = {};
    for (const [key, value] of Object.entries(e.fields)) if (!PLAY_FIELDS.includes(key) && key !== "visibility") fields[key] = structuredClone(value);
    const owner = typeof fields.owner === "string" ? fields.owner : null;
    if (owner !== null && !has(owner)) {
      delete fields.owner;
      result.notes.push(`${name}: its owner ${nameOf(ctx, owner)} isn't in the world, so it is kept as nobody's.`);
    }
    if (typeof fields.home === "string" && fields.home !== "owner" && !has(fields.home) && !placeOk(fields.home)) {
      result.notes.push(`${name}: where it is kept, ${nameOf(ctx, fields.home)}, isn't in the world, so it rests where it is.`);
      delete fields.home;
    }
    const relations: RelationInstance[] = [];
    for (const r of e.relations) {
      if (r.type === "in") continue;
      if (has(r.to)) relations.push(structuredClone(r));
      else result.notes.push(`${name}: ${r.type.replace(/_/g, " ")} ${nameOf(ctx, r.to)} is left out: they aren't in the world.`);
    }
    const holder = holderOf(ctx.state, id);
    const lying = typeof fields.place === "string" && fields.place !== "" ? fields.place : null;
    if (lying !== null || holder === null || !has(holder)) {
      // Lying somewhere, or in a holder the world won't have: at the nearest place the draft has.
      const at = reachable(lying ?? placeOfEntity(ctx.state, id));
      if (lying === null && holder !== null) result.notes.push(`${name}: ${nameOf(ctx, holder)} isn't in the world, so it lies ${at !== null ? `at ${nameOf(ctx, at)}` : "nowhere"}.`);
      else if (lying !== null && at !== lying) result.notes.push(`${name}: ${nameOf(ctx, lying)} isn't in the world, so it lies ${at !== null ? `at ${nameOf(ctx, at)}` : "nowhere"}.`);
      if (at !== null) fields.place = at;
      else delete fields.place;
    } else relations.unshift({ type: "in", to: holder });
    const visibility = thingVisibility(ctx, id);
    const def: EntityDef = { id, kind: e.kind, name, tier: e.tier, fields, relations, ...(typeof visibility === "string" && VISIBILITIES.includes(visibility) && visibility !== "public" ? { visibility: visibility as NonNullable<EntityDef["visibility"]> } : {}), ...(e.class !== undefined ? { class: structuredClone(e.class) } : {}), ...(e.tags !== undefined ? { tags: [...e.tags] } : {}) };
    ops.push({ op: "add", path: pointerOf(["entities", id]), value: def as unknown as JsonValue });
    result.things.push(id);
  }
  return { ops, result };
}

/** Places made in play that the world doesn't have (ITEMS-SPEC §6.2), each with the places around it, saying whether `draft` has it already; by where they are, then by name. */
export function madePlaceViews(ctx: ReadContext, draft: Pick<WorldDoc, "places"> | null): MadePlaceView[] {
  const base = baseWorld(ctx.world);
  return madePlaces(ctx.state)
    .filter((p) => !hasOwn(base.places, p.id))
    .map((p) => {
      const view: MadePlaceView = { id: p.id, name: p.name, path: spotSteps(ctx, { place: p.parent }), as: p.made.as, inDraft: draft !== null && own(draft.places, p.id) !== undefined };
      return { view, key: [...view.path.map((s) => s.name), view.name].join("\u0000") };
    })
    .sort((a, b) => a.key.localeCompare(b.key) || a.view.id.localeCompare(b.view.id))
    .map((v) => v.view);
}

/**
 * The draft patch that keeps places made in play in the world (ITEMS-SPEC §6.2 Kept in the world),
 * each under its own id as the world keeps it (`keptPlace`: everything but what made it), the places
 * around one first. One must be in a place the draft has or one kept with it; else it is skipped with
 * why, as is one the world or its draft has already, or that play didn't make.
 */
export function keepPlaces(ctx: ReadContext, ids: readonly PlaceId[], draft: Pick<WorldDoc, "places">): { ops: JsonPatchOp[]; result: Pick<KeepResult, "places" | "skipped"> } {
  const result: Pick<KeepResult, "places" | "skipped"> = { places: [], skipped: [] };
  const base = baseWorld(ctx.world);
  const made = new Map(madePlaces(ctx.state).map((p) => [p.id, p] as const));
  const keeping = new Map<PlaceId, MadePlace>();
  for (const id of [...new Set(ids)].sort()) {
    const p = made.get(id);
    const reason = !p ? "it isn't a place made in this chat" : hasOwn(base.places, id) ? "the world has it already" : own(draft.places, id) ? "the world's draft has it already" : null;
    if (reason) result.skipped.push({ id, reason: `${nameOf(ctx, id)}: ${reason}` });
    else if (p) keeping.set(id, p);
  }
  // The places around one first: how many places made in play it is inside.
  const depth = (p: MadePlace): number => {
    let n = 0;
    for (let at = made.get(p.parent); at && n < 32; at = made.get(at.parent)) n++;
    return n;
  };
  const ops: JsonPatchOp[] = [];
  const kept = new Set<PlaceId>();
  for (const p of [...keeping.values()].sort((a, b) => depth(a) - depth(b) || a.id.localeCompare(b.id))) {
    if (own(draft.places, p.parent) === undefined && !kept.has(p.parent)) {
      const around = nameOf(ctx, p.parent);
      result.skipped.push({ id: p.id, reason: `${p.name}: it is in ${around}, which ${made.has(p.parent) && !hasOwn(base.places, p.parent) ? "was made in play too: keep it as well" : "the world's draft doesn't have"}` });
      continue;
    }
    ops.push({ op: "add", path: pointerOf(["places", p.id]), value: structuredClone(keptPlace(p)) as unknown as JsonValue });
    kept.add(p.id);
    result.places.push(p.id);
  }
  return { ops, result };
}
