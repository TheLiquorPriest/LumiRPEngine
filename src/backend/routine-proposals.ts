// Propose routines from lore (DESIGN §13): the helper reads the world's lore, the people's and
// groups' sheets and the places, a few people or groups a call, and proposes their routine blocks
// (habits: meals with the household, worship, a club night, regular company) and schedules (shifts,
// school and class timetables, services). Each rests on a lore entry or a sheet field it quotes word
// for word. Nothing without one is proposed, and someone the text gives no routine gets none.
//
// Every proposal is checked against the draft (`checkRoutineReply`): its owner, places and company
// exist and are the job's to read; its times can be; company has a tie to the owner or the cited
// text's word behind it; a label names no one but its owner. A reply with problems the helper can fix
// is asked once more, listing them. Then `finishRoutines` dedupes deterministically and points out
// what would clash: with the owner's schedules and routine, with another proposal, or with where the
// story starts them. A clash is never resolved by overriding what the world holds: the proposal
// carries the problem and starts unticked.
//
// Secrecy (DESIGN §7, §5.4): what the job proposes becomes world data the player's views read (Cast's
// day, a block's label and its source), so it reads only what a step whose output reaches the player
// may. Lore goes by the lore readers' rules for such a step, on the state a chat starts from. Sheets,
// fields and places are read only when public, and secret people are no one's company. A proposal
// that still carries a secret's words is dropped.

import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { neutralizeMacros } from "../shared/macros";
import type { JobProposal, RoutineJobInput } from "../shared/protocol";
import { blockShapeProblems, isOff, ROUTINE_BLOCK_KINDS, type RoutineBlock, type RoutineCompany, type RoutineDays, type RoutineDef, type RoutinePlace, type WorldRoutineSource } from "../shared/routines";
import { ACTIVITY_SPAN_OF, type PlaceDef, type Recurrence, type ScheduleDef, type WorldDoc } from "../shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOfText, formatStamp, MINUTES_PER_DAY, parseHHMM, recursOn, weekdayName, type Calendar } from "../engine/calendar";
import { acts } from "../engine/life";
import { loreReadable, loreSearch } from "../engine/lore";
import { own } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { fieldDef, isGone, kindIs, placeOfEntity, placeWithin } from "../engine/scope";
import { isGroup, isMemberOf, membersOf } from "../engine/selector";
import type { WorldState } from "../engine/state";
import { entityVisibility, findLeaks, loreGateReader, namesAny, unrevealedSecrets, unseenPlaceNames, visibilityOf } from "../engine/visibility";
import { initialState, minutesBetween } from "../engine/world-state";
import { blockOnDay, routineIssues } from "../packs/castlife/core/routines";
import { tokensOf } from "./book";
import { IMPORT_MAX_CALLS, snake, type DropCounts } from "./proposals";
import { limitOf, type Limit } from "../shared/minds";

/** People and groups one call reads, at most: fewer when their lore together passes one person's allowance. */
export const ROUTINE_OWNERS_PER_CALL = 3;
/** Calls a pass makes, repairs included: Import's. */
export const ROUTINE_MAX_CALLS = IMPORT_MAX_CALLS;
/** Items a reply may hold; the rest are left out. */
export const ROUTINE_ITEMS_PER_CALL = 24;
/** People and groups a job may be asked for by name; a request naming more is refused. */
export const ROUTINE_OWNERS_MAX = 500;

/**
 * Who the job reads lore as. Its proposals reach the player as extraction's do (a block's label
 * and source in Cast's day, the narrator's sections), so it reads by the rules for a step whose output
 * reaches the player, as an effects template: no secret entry whose gate doesn't hold, whatever its
 * audience (DESIGN §5.4).
 */
const LORE_PURPOSE = "extract";
/** A quote is a short one: one longer than this is cut at a word. */
const QUOTE_MAX = 240;
/** The places the prompt lists by name, those the batch's people use first. */
const PLACES_LISTED = 80;
/** Days the clash check walks from the story's start: two weeks show every weekly pattern twice. */
const CHECK_DAYS = 14;
/** A proposal with problems starts unticked: its confidence stays under the review's 70%, as Describe a map's does. */
const FLAGGED_CONFIDENCE = 0.4;

/** Fields that say where someone is or what they do now, not who they are: the engine's own state. */
const STATE_FIELDS: Record<string, true> = { place: true, activity: true, x: true, y: true, needs: true, holds: true, known_places: true, visibility: true, knownBy: true, [ACTIVITY_SPAN_OF]: true };
/** Relations that tie no one to anyone socially: placement, gear and enmity. Membership is told apart. */
const NOT_TIES: Record<string, true> = { in: true, worn_by: true, equipped: true, hostile: true, member_of: true };
/** The ids of the meals and sleep every day has (`BASIC_BLOCKS`): a block takes one only to replace it every day. */
const BASIC_IDS: Record<string, true> = { sleep: true, breakfast: true, lunch: true, dinner: true };
/** The places a block may name by role, as `RoutinePlace` reads them. */
const PLACE_ROLES: Record<string, Extract<RoutinePlace, string>> = { home: "home", work: "work", here: "here", with: "with" };
const RECURRENCES: Record<Recurrence["every"], true> = { day: true, week: true, month: true, year: true };

// ---------------------------------------------------------------- what the job reads

export interface RoutineScope {
  reg: Registry;
  /** The draft the job proposes for. */
  world: WorldDoc;
  /** The state a chat starts from. */
  state: WorldState;
  ctx: ReadContext;
  cal: Calendar;
  /** The clock the story starts at; null when the world's start doesn't read. */
  start: number | null;
  /** The lore entries the job may read. */
  lore: ReadonlySet<string>;
  /** People and groups it may read: not secret, still in the world; people in a life state that acts. */
  people: ReadonlySet<EntityId>;
  groups: ReadonlySet<EntityId>;
  /** Places it may name: public ones inside public ones. */
  places: ReadonlySet<PlaceId>;
  /** What a player view must never carry as the story starts (the leak check, DESIGN §7). */
  secrets: readonly string[];
  /** The names of the places the POV can't see as the story starts: a label says none of them. */
  unseen: readonly string[];
}

/** A place that is public, inside places that are too: one the player may be told of. */
function publicPlace(world: WorldDoc, id: PlaceId): boolean {
  let at: PlaceId | undefined = id;
  for (let depth = 0; at !== undefined && depth < 32; depth++) {
    const place: PlaceDef | undefined = own(world.places, at);
    if (!place || (place.visibility !== undefined && place.visibility !== "public")) return false;
    at = place.parent;
    if (at === undefined) return true;
  }
  return false;
}

/** What the job may read of a draft: its lore by the readers' rules, its public people, groups and places, on the state a chat starts from. */
export function routineScope(reg: Registry, world: WorldDoc): RoutineScope {
  const state = initialState(world, "routines", reg);
  const open = loreGateReader(reg, world, state);
  const lore = new Set(
    Object.keys(world.lore).filter((id) => {
      const entry = own(world.lore, id);
      return entry !== undefined && loreReadable(reg, world, state, entry, LORE_PURPOSE, true, open);
    }),
  );
  const people = new Set<EntityId>();
  const groups = new Set<EntityId>();
  for (const id of Object.keys(world.entities)) {
    const e = own(state.entities, id);
    if (!e || isGone(state, id) || entityVisibility(world, state, id) === "secret") continue;
    if (isGroup(reg, world, state, id)) groups.add(id);
    else if (kindIs(reg, world, e.kind, "person") && acts(world, state, id)) people.add(id);
  }
  let start: number | null;
  try {
    start = minutesBetween(world.calendar.epoch, world.start.at);
  } catch {
    start = null;
  }
  return {
    reg,
    world,
    state,
    ctx: reg.context(world, state),
    cal: calendarOf(world),
    start,
    lore,
    people,
    groups,
    places: new Set(Object.keys(world.places).filter((id) => publicPlace(world, id))),
    secrets: unrevealedSecrets(reg, world, state),
    unseen: unseenPlaceNames(reg, world, state, world.pov),
  };
}

function nameOf(scope: RoutineScope, id: string): string {
  return own(scope.state.entities, id)?.name ?? own(scope.world.places, id)?.name ?? id;
}

/** Whether an id names something the job may read: a person or group it reads, or a public place. */
function readable(scope: RoutineScope, id: string): boolean {
  return scope.people.has(id) || scope.groups.has(id) || scope.places.has(id);
}

/**
 * A sheet field as the prompt shows it, and as a quote of it must read: text as it is, a reference
 * with its name, a list joined, a list of items by their labels. Null for what says nothing of a day
 * (numbers, money, flags) and for a value naming something the job may not read.
 */
function fieldText(scope: RoutineScope, value: JsonValue | undefined): string | null {
  const one = (v: JsonValue): string | null => {
    if (typeof v === "string") {
      if (readable(scope, v)) return `${v} (${nameOf(scope, v)})`;
      // A value naming someone or somewhere the job may not read (a secret person, a hidden place) keeps the whole field out.
      return hasOwn(scope.state.entities, v) || hasOwn(scope.world.places, v) ? null : v;
    }
    if (isRecord(v) && typeof v.label === "string") return v.label;
    return null;
  };
  if (typeof value === "string") return one(value);
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map(one);
  if (parts.some((p) => p === null)) return null;
  return parts.join(Array.isArray(value) && value.every((v) => typeof v === "string") ? ", " : "; ");
}

/** The fields of someone's sheet the job may read, as the prompt shows them: public ones only, without the engine's own state. */
function sheetFields(scope: RoutineScope, who: EntityId): { field: string; text: string }[] {
  const e = own(scope.state.entities, who);
  if (!e) return [];
  const out: { field: string; text: string }[] = [];
  for (const field of Object.keys(e.fields).sort()) {
    if (hasOwn(STATE_FIELDS, field) || visibilityOf(fieldDef(scope.reg, scope.world, e.kind, field)?.visibility) !== "public") continue;
    const text = fieldText(scope, e.fields[field]);
    if (text !== null && text.trim() !== "") out.push({ field, text: text.replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** The people and groups `who` is tied to (a relation either way, but placement, gear, enmity and membership), with how. */
function tiesOf(scope: RoutineScope, who: EntityId): Map<EntityId, string[]> {
  const ties = new Map<EntityId, string[]>();
  const add = (other: EntityId, type: string): void => {
    if (other === who || hasOwn(NOT_TIES, type) || !(scope.people.has(other) || scope.groups.has(other))) return;
    const label = scope.reg.relations.get(type)?.label ?? own(scope.world.relations, type)?.label ?? type;
    const list = ties.get(other) ?? [];
    if (!list.includes(label)) list.push(label);
    ties.set(other, list);
  };
  for (const r of own(scope.state.entities, who)?.relations ?? []) add(r.to, r.type);
  for (const [id, e] of Object.entries(scope.state.entities)) for (const r of e.relations) if (r.to === who) add(id, r.type);
  return ties;
}

/** The groups the job reads that `who` belongs to, directly or through a member group. */
function groupsOf(scope: RoutineScope, who: EntityId): EntityId[] {
  return [...scope.groups].filter((g) => g !== who && isMemberOf(scope.state, who, g)).sort();
}

/** A group's members the job reads. */
function membersRead(scope: RoutineScope, group: EntityId): EntityId[] {
  return membersOf(scope.reg, scope.world, scope.state, group).filter((m) => scope.people.has(m));
}

function placeOf(scope: RoutineScope, who: EntityId, field: "home" | "employer"): PlaceId | null {
  const v = own(scope.state.entities, who)?.fields[field];
  if (typeof v !== "string") return null;
  if (hasOwn(scope.world.places, v)) return v;
  return field === "employer" ? placeOfEntity(scope.state, v) : null;
}

// ---------------------------------------------------------------- the pass and its calls

export interface RoutineBatch {
  owners: EntityId[];
  /** The lore entries it is given, whole: each owner's, best first, each entry once. */
  lore: string[];
  /** Those entries' tokens, as the allowance counts them. */
  tokens: number;
}

/** Someone whose lore didn't all fit the allowance: how many of their entries were read, of how many found. */
export interface LoreCut {
  owner: EntityId;
  read: number;
  of: number;
}

export interface RoutinePass {
  /** The calls' people and groups, a batch each, in id order. */
  batches: RoutineBatch[];
  /** Everyone the pass reaches, in order, those with nothing to go on included: where a second pass continues. */
  owners: EntityId[];
  /** Of those, the ones with no sheet field or lore entry to go on, so no call reads them. */
  bare: EntityId[];
  /** Named in the input but not people or groups the job may read. */
  unread: string[];
  /** Those whose lore the allowance cut: the job says so, and where to raise it. */
  cut: LoreCut[];
}

/** A job's input as the job reads it: whom it proposes for, and where a second pass starts. */
export function readRoutineInput(input: JsonObject): RoutineJobInput {
  const owners = Array.isArray(input.owners) ? input.owners.filter((o): o is string => typeof o === "string") : undefined;
  return { ...(owners ? { owners } : {}), ...(typeof input.after === "string" && input.after !== "" ? { after: input.after } : {}) };
}

/**
 * The lore entries about someone, best first, by the engine's search: those linked to them, their
 * home, workplace and groups (a group: its members' homes), those titled or keyed by one of those
 * names, and those whose text says their name. Every match: the allowance decides how many go in.
 */
function loreAbout(scope: RoutineScope, who: EntityId): string[] {
  const group = scope.groups.has(who);
  const places = group ? membersRead(scope, who).map((m) => placeOf(scope, m, "home")) : [placeOf(scope, who, "home"), placeOf(scope, who, "employer")];
  const employer = own(scope.state.entities, who)?.fields.employer;
  const links = [...new Set([who, ...places.filter((p): p is PlaceId => p !== null), ...(typeof employer === "string" ? [employer] : []), ...(group ? [] : groupsOf(scope, who))])];
  const result = loreSearch(
    { reg: scope.reg, world: scope.world, state: scope.state, tokens: tokensOf },
    { query: nameOf(scope, who), terms: links.map((id) => nameOf(scope, id)), links, purpose: LORE_PURPOSE, effects: true, limit: Number.POSITIVE_INFINITY, tokenBudget: Number.POSITIVE_INFINITY },
  );
  return result.hits.map((h) => h.id).filter((id) => scope.lore.has(id));
}

/** A lore entry as a call gives it, whole: its title, the id it is cited by, and all its text. */
function entryText(scope: RoutineScope, id: string): string {
  const entry = own(scope.world.lore, id);
  return entry ? `### ${entry.title || id} (lore: ${id})\n${entry.content}` : "";
}

/**
 * A pass over the people and groups the input names (else everyone the job reads, the POV aside),
 * after `after`, in id order. Each brings their lore whole within `loreTokens` (Settings → Steps and
 * connections → Build jobs): entries best first until the next would pass it, none ever cut, all of
 * them under "none". People with nothing to go on are passed over without a call. The rest go up to
 * `ROUTINE_OWNERS_PER_CALL` to a call while their lore together fits one allowance, so someone whose
 * lore fills it has a call of their own.
 */
export function routinePass(scope: RoutineScope, input: RoutineJobInput, loreTokens: Limit): RoutinePass {
  const allowance = limitOf(loreTokens);
  const everyone = [...scope.groups, ...scope.people].filter((id) => id !== scope.world.pov).sort();
  const named = input.owners ? [...new Set(input.owners)] : null;
  const unread = named ? named.filter((id) => !everyone.includes(id)) : [];
  const owners = (named ? everyone.filter((id) => named.includes(id)) : everyone).filter((id) => input.after === undefined || id > input.after);
  const costs = new Map<string, number>();
  const costOf = (e: string): number => {
    const known = costs.get(e);
    if (known !== undefined) return known;
    const counted = tokensOf(entryText(scope, e));
    costs.set(e, counted);
    return counted;
  };
  const lore = new Map<EntityId, { ids: string[]; of: number }>();
  for (const id of owners) {
    const found = loreAbout(scope, id);
    const ids: string[] = [];
    let used = 0;
    for (const e of found) {
      if (used + costOf(e) > allowance) break;
      ids.push(e);
      used += costOf(e);
    }
    lore.set(id, { ids, of: found.length });
  }
  const nothing = (id: EntityId): boolean => (lore.get(id)?.ids.length ?? 0) === 0 && sheetFields(scope, id).length === 0;
  // Someone whose lore didn't fit at all is told of as cut, not as having none.
  const bare = owners.filter((id) => nothing(id) && (lore.get(id)?.of ?? 0) === 0);
  const batches: RoutineBatch[] = [];
  for (const id of owners.filter((o) => !nothing(o))) {
    const mine = lore.get(id)?.ids ?? [];
    const extra = (b: RoutineBatch): number => mine.filter((e) => !b.lore.includes(e)).reduce((n, e) => n + costOf(e), 0);
    const last = batches.at(-1);
    const batch = last !== undefined && last.owners.length < ROUTINE_OWNERS_PER_CALL && last.tokens + extra(last) <= allowance ? last : { owners: [], lore: [], tokens: 0 };
    if (batch !== last) batches.push(batch);
    batch.tokens += extra(batch);
    batch.owners.push(id);
    for (const e of mine) if (!batch.lore.includes(e)) batch.lore.push(e);
  }
  const cut = owners.flatMap((id) => {
    const l = lore.get(id);
    return l && l.ids.length < l.of ? [{ owner: id, read: l.ids.length, of: l.of }] : [];
  });
  return { batches, owners, bare, unread, cut };
}

/** What the allowance left out of people's lore, and where to raise it; null when nothing was. */
export function loreCutMessage(scope: RoutineScope, cut: readonly LoreCut[], loreTokens: Limit): string | null {
  if (cut.length === 0) return null;
  const named = cut.slice(0, 12).map((c) => `${nameOf(scope, c.owner)} (${c.read} of ${c.of} entries)`);
  const more = cut.length > 12 ? ` and ${cut.length - 12} more` : "";
  return `Lore past ${limitOf(loreTokens).toLocaleString("en-US")} tokens each was left out for ${named.join(", ")}${more}: raise "Lore each person or group reads" in Settings → Steps and connections → Build jobs, or turn on "all of it".`;
}

/** A schedule's days and slots in a line: "Mon–Fri 07:00–12:00 alder_automotive". */
function scheduleLine(scope: RoutineScope, s: ScheduleDef): string {
  const r = s.recurrence;
  const days = r.every === "week" && r.weekdays && r.weekdays.length > 0 ? r.weekdays.map((d) => weekdayName(scope.cal, d).slice(0, 3)).join(", ") : r.every === "month" && r.days ? `days ${r.days.join(", ")} of the month` : `every ${r.every}`;
  const slots = s.slots.map((slot) => `${slot.start}–${slot.end}${typeof slot.value === "string" ? ` ${slot.value}` : ""}`).join("; ");
  return `${s.id} (${s.target}): ${days}${r.from ? ` from ${r.from}` : ""}${r.until ? ` until ${r.until}` : ""}: ${slots}`;
}

/** A routine block in a line, as the prompt lists what someone's routine already holds. */
function blockLine(b: RoutineBlock): string {
  const when = b.kind === "fixed" ? `at ${b.at ?? "?"}` : `${b.window?.from ?? "?"}–${b.window?.to ?? "?"}`;
  const days = b.days?.weekdays ? ` on ${b.days.weekdays.join(",")}` : b.days?.off ? ` ${b.days.off === "only" ? "on days off" : "on working days"}` : "";
  return `${b.id}: ${b.label} (${b.kind}, ${when}, ${b.minutes} min${b.perWeek ? `, ${b.perWeek}× a week` : ""}${days})`;
}

/** Someone's schedules (theirs and their groups') and routine blocks (their own), as the world already has them. */
function heldLines(scope: RoutineScope, who: EntityId): string[] {
  const owners = new Set([who, ...groupsOf(scope, who)]);
  const schedules = Object.keys(scope.world.schedules)
    .sort()
    .flatMap((id) => {
      const s = own(scope.world.schedules, id);
      return s && typeof s.owner === "string" && owners.has(s.owner) ? [`schedule ${scheduleLine(scope, s)}${s.owner === who ? "" : ` (${nameOf(scope, s.owner)}'s)`}`] : [];
    });
  const blocks = Object.keys(scope.world.routines ?? {})
    .sort()
    .flatMap((id) => {
      const r = own(scope.world.routines ?? {}, id);
      return r && r.owner === who ? r.blocks.flatMap((b) => (isOff(b) ? [`routine ${r.id}: turns off ${b.id}`] : [`routine ${r.id}: ${blockLine(b)}`])) : [];
    });
  return [...schedules, ...blocks];
}

/** One person or group as the call reads them. */
function ownerText(scope: RoutineScope, who: EntityId): string {
  const e = own(scope.state.entities, who);
  const group = scope.groups.has(who);
  const lines = [`### ${nameOf(scope, who)} (${who}; ${group ? "a group" : "a person"}, ${e?.kind ?? "?"})`];
  const at = group ? null : placeOfEntity(scope.state, who);
  if (at !== null && scope.places.has(at)) lines.push(`Where the story starts them: ${nameOf(scope, at)} (${at}).`);
  const fields = sheetFields(scope, who);
  if (fields.length > 0) lines.push(`Sheet:\n${fields.map((f) => `- ${f.field}: ${f.text}`).join("\n")}`);
  if (group) {
    const members = membersRead(scope, who);
    if (members.length > 0) lines.push(`Members: ${members.map((m) => `${nameOf(scope, m)} (${m})`).join(", ")}.`);
  } else {
    const groups = groupsOf(scope, who);
    if (groups.length > 0) lines.push(`Groups: ${groups.map((g) => `${nameOf(scope, g)} (${g})`).join(", ")}.`);
  }
  const ties = [...tiesOf(scope, who)].sort(([a], [b]) => (a < b ? -1 : 1));
  if (ties.length > 0) lines.push(`Tied to: ${ties.map(([id, how]) => `${nameOf(scope, id)} (${id}: ${how.join(", ")})`).join("; ")}.`);
  const held = heldLines(scope, who);
  lines.push(held.length > 0 ? `Already in the world:\n${held.map((l) => `- ${l}`).join("\n")}` : "Already in the world: no schedules or routine.");
  return lines.join("\n");
}

/** The places a call names: those its people use and its lore links first, then the rest the job may name, `PLACES_LISTED` in all. */
function placesText(scope: RoutineScope, batch: RoutineBatch): string {
  const used = new Set<PlaceId>();
  for (const who of batch.owners) {
    for (const p of [placeOf(scope, who, "home"), placeOf(scope, who, "employer"), placeOfEntity(scope.state, who)]) if (p !== null && scope.places.has(p)) used.add(p);
    for (const m of scope.groups.has(who) ? membersRead(scope, who) : []) {
      const home = placeOf(scope, m, "home");
      if (home !== null && scope.places.has(home)) used.add(home);
    }
  }
  for (const id of batch.lore) for (const link of own(scope.world.lore, id)?.links ?? []) if (scope.places.has(link)) used.add(link);
  const rest = [...scope.places].filter((p) => !used.has(p)).sort();
  const listed = [...[...used].sort(), ...rest].slice(0, PLACES_LISTED);
  const more = scope.places.size - listed.length;
  return `Places (id: name):\n${listed.map((p) => `${p}: ${nameOf(scope, p)}`).join("\n")}${more > 0 ? `\n(and ${more} more)` : ""}`;
}

/** The text one call reads: whom to propose for, the lore about them whole, and the places. */
export function routineCallText(scope: RoutineScope, batch: RoutineBatch): string {
  const lore = batch.lore.map((id) => entryText(scope, id)).filter((text) => text !== "");
  return [`Propose for:\n\n${batch.owners.map((id) => ownerText(scope, id)).join("\n\n")}`, lore.length > 0 ? `Lore:\n\n${lore.join("\n\n")}` : "Lore: none about them.", placesText(scope, batch)].join("\n\n");
}

/** The reply's shape, in the prompt and the repair call. */
const OUTPUT =
  '{"routines":[{"owner","id","label","activity","kind":"fixed"|"flexible"|"optional","at"?:"HH:MM","window"?:{"from","to"},"minutes","perWeek"?,"chance"?,"priority"?,"days"?:{"weekdays"?,"off"?:"only"|"never","holidays"?,"except"?},"place"?,"company"?:{"ids"?,"group"?,"invite"?},"source","confidence","note"?}],"schedules":[{"owner","id","label","activity","place","recurrence":{"every":"day"|"week"|"month"|"year","weekdays"?,"days"?,"from"?:"YYYY-MM-DD","until"?:"YYYY-MM-DD","except"?},"start":"HH:MM","end":"HH:MM","source","confidence","note"?}]}';

/** The system prompt: the task, what each kind of item is, the rules that keep it to what the text says, and the shape. */
export function routineSystem(scope: RoutineScope): string {
  const parts = scope.cal.def.dayParts.map((p, i, all) => `${p.label.toLowerCase()} ${p.start}–${all[(i + 1) % all.length]?.start ?? p.start}`).join(", ");
  const partHours = parts === "" ? "" : `, or for a part of the day it names, that part's hours (${parts})`;
  const holidays = scope.cal.def.holidays.slice(0, 20).map((h) => `${h.id} (${h.label})`);
  const start = scope.start === null ? "" : ` The story starts ${formatStamp(scope.cal, scope.start)}, a ${weekdayName(scope.cal, dateAt(scope.cal, scope.start).weekday)}.`;
  return [
    `You read a roleplay world's lore and its people's sheets and propose their routines for a simulation engine: how the people and groups below spend their days and weeks, as the text says.${start}`,
    "Two kinds of item:",
    '- "schedules": shifts, school and class timetables, services: what someone is committed to at set times on set days, at a set place. A business\'s opening hours are the shifts of the people who work there.',
    '- "routines": habits, each a block of their day: meals with their household, worship, a club night, regular company, the gym. "fixed" is at a set time on its days ("dinner at six"); "flexible" is for a while somewhere in a window, on every day it is on or perWeek of them ("most mornings", "three times a week"); "optional" is as flexible but only sometimes, with a chance ("now and then", "when the shop can spare him"). A habit the text states loosely is flexible or optional, never fixed.',
    "Rules:",
    "- Propose only what an entry or a sheet below states. Leave out anyone the text gives no routine; never invent a habit, a time, a place or a friend.",
    '- Every item cites the one source it rests on with a short quote copied word for word from it: a lore entry {"lore": "<the id after lore:>", "quote": "..."} or a sheet field {"sheet": "<entity id>", "field": "<field>", "quote": "..."}. An item without one is dropped.',
    '- The owner is one of the people or groups under "Propose for", by id. A habit a household, family or club shares is the group\'s item, once, not each member\'s.',
    '- A routine\'s place is "home", "work" (their workplace), "with" (the home of its company) or a place id from the list; a schedule\'s is a place id.',
    '- Company is only people listed with an id who are tied to the owner, or whom the cited text names with them: {"ids": [...]}, or a group the owner belongs to: {"group": "<id>"}. "invite": true only when the text says one asks the other along.',
    `- Times are 24-hour HH:MM: the times the text gives${partHours}. A fixed block has "at" and "minutes"; a flexible or optional one a "window" and "minutes"; a schedule "start" and "end".`,
    `- Weekdays are 0 (Sunday) to 6; "off": "only" for days off, "never" for working days.${holidays.length > 0 ? ` Holidays: ${holidays.join(", ")}.` : ""}`,
    '- A label says what they do, never with whom ("Dinner at home", not "Dinner with Ada"): its company says who. The activity is a word or two ("work", "school", "dinner", "worship", "socialize"); a shift\'s says work, a class\'s school.',
    '- A meal they have every day takes the meal\'s id ("breakfast", "lunch", "dinner") and replaces the usual one; anything narrower takes its own id ("sunday_dinner").',
    "- Never propose anything that takes someone from where the text or their sheet places them: someone confined, away, bedridden or who never leaves a place, or away from where the story starts them when it starts.",
    "- Nothing contradicts the schedules and routine they already have (listed with them), and nothing repeats them.",
    `- confidence is 0..1: 0.9 and up only when the text states the time and the days outright; add a short note when unsure. At most ${ROUTINE_ITEMS_PER_CALL} items; ids are lowercase snake_case.`,
    `Output JSON only: ${OUTPUT}. If nothing below gives anyone a routine, reply {"routines":[],"schedules":[]}.`,
  ].join("\n");
}

// ---------------------------------------------------------------- reading and checking a reply

/** A reply in the routines shape: lists of routines and schedules (either may be absent). */
function itemsOf(reply: JsonValue | null): { type: "routine" | "schedule"; index: number; raw: JsonValue }[] | null {
  if (!isRecord(reply)) return null;
  const routines = reply.routines;
  const schedules = reply.schedules;
  if (!Array.isArray(routines) && !Array.isArray(schedules)) return null;
  return [...(Array.isArray(routines) ? routines.map((raw, index) => ({ type: "routine" as const, index, raw })) : []), ...(Array.isArray(schedules) ? schedules.map((raw, index) => ({ type: "schedule" as const, index, raw })) : [])].slice(0, ROUTINE_ITEMS_PER_CALL);
}

/** Text as a quote is matched against it: letters and digits, case, accents, punctuation and spacing aside. */
function plainText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A source the check found: what it rests on, the key the review names it by, its name, its whole text and the ids it refers to. */
export interface CheckedSource {
  source: Extract<WorldRoutineSource, { type: "lore" | "sheet" }>;
  key: string;
  name: string;
  text: string;
  refs: string[];
}

/** A quote as the source keeps it: cut to a short one at a word, and never a host macro (it lands in world data the player's views read). */
function shortQuote(quote: string): string {
  const q = neutralizeMacros(quote).replace(/\s+/g, " ").trim();
  if (q.length <= QUOTE_MAX) return q;
  const cut = q.slice(0, QUOTE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
}

/** A cited source checked against what the job reads: an entry or a field it may read, holding the quote. Why not, when it isn't. */
function checkSource(scope: RoutineScope, raw: JsonValue | undefined): CheckedSource | string {
  if (!isRecord(raw)) return "it cites no source";
  const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
  if (plainText(quote) === "") return "its source has no quote";
  const entry = typeof raw.lore === "string" ? raw.lore : raw.type === "lore" && typeof raw.entry === "string" ? raw.entry : null;
  if (entry !== null) {
    const def = own(scope.world.lore, entry);
    if (!def || !scope.lore.has(entry)) return `its source "${entry}" isn't a lore entry it may cite`;
    const text = `${def.title}\n${def.content}`;
    if (!plainText(text).includes(plainText(quote))) return `its quote isn't in ${entry}: copy it word for word`;
    return { source: { type: "lore", entry, quote: shortQuote(quote) }, key: entry, name: def.title || entry, text, refs: [...def.links] };
  }
  const entity = typeof raw.sheet === "string" ? raw.sheet : raw.type === "sheet" && typeof raw.entity === "string" ? raw.entity : null;
  const field = typeof raw.field === "string" ? raw.field : "";
  if (entity === null) return 'its source is neither {"lore"} nor {"sheet", "field"}';
  if (!(scope.people.has(entity) || scope.groups.has(entity))) return `its source "${entity}" isn't a person or group whose sheet it may cite`;
  const shown = sheetFields(scope, entity).find((f) => f.field === field);
  if (!shown) return `${nameOf(scope, entity)}'s sheet has no field "${field}" to cite`;
  if (!plainText(shown.text).includes(plainText(quote))) return `its quote isn't in ${nameOf(scope, entity)}'s ${field}: copy it word for word`;
  const value = own(scope.state.entities, entity)?.fields[field];
  const refs = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && readable(scope, v));
  return { source: { type: "sheet", entity, field, quote: shortQuote(quote) }, key: `${entity}.${field}`, name: `${nameOf(scope, entity)} · ${field}`, text: shown.text, refs };
}

/** A proposed schedule as read, before it is split into its activity and place schedules. */
export interface ScheduleDraft {
  id: string;
  label: string;
  activity: string;
  place: PlaceId | null;
  recurrence: Recurrence;
  start: string;
  end: string;
}

/** One item of a reply, checked: a routine block or a schedule, with what's wrong with it. */
export interface RoutineCandidate {
  type: "routine" | "schedule";
  owner: EntityId;
  /** Where in the reply it was ("routines[2]"), for the repair call. */
  at: string;
  label: string;
  confidence: number;
  notes: string[];
  sources: CheckedSource[];
  /** What keeps it from being proposed at all: no owner it was about, nothing it rests on, a shape that doesn't read. */
  fatal: string[];
  /** What it is proposed with, unticked: a place the player may not be told of, company with no ground, a label naming someone. */
  problems: string[];
  /** What Build's lint says of it as a routine (`routineIssues`): an unknown place, holiday or company, a window it can't keep. */
  lint: string[];
  /** It still carries the words of a secret: never proposed. */
  leak: boolean;
  block?: RoutineBlock;
  schedule?: ScheduleDraft;
}

/** What checking one reply found. */
export interface RoutineCheck {
  /** Why the reply can't be used at all, or null: empty or not JSON, another shape, or nothing in it readable. */
  problem: string | null;
  candidates: RoutineCandidate[];
  /** The problems the helper can fix, each naming its item: the repair call lists them. */
  fixable: string[];
}

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");
const ints = (v: JsonValue | undefined, lo: number, hi: number): number[] | null => (Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi) ? [...new Set(v as number[])].sort((a, b) => a - b) : null);
const strings = (v: JsonValue | undefined): string[] | null => (Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null);

/** A time as world data writes it: "7:00" is "07:00", and "24:00", the end of the day, "00:00". Anything else stays as written, for the shape check to name. */
function hhmm(v: JsonValue | undefined): string {
  const t = str(v);
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  return `${m[1] === "24" && m[2] === "00" ? "00" : (m[1] ?? "").padStart(2, "0")}:${m[2] ?? ""}`;
}

/** Whether `company` has a ground with `owner`: a tie either way, a group both belong to (or, for a group, membership), or a cited source that names or links them. */
function grounded(scope: RoutineScope, owner: EntityId, company: EntityId, sources: readonly CheckedSource[]): boolean {
  if (tiesOf(scope, owner).has(company)) return true;
  if (scope.groups.has(owner) ? isMemberOf(scope.state, company, owner) : groupsOf(scope, owner).some((g) => isMemberOf(scope.state, company, g))) return true;
  const name = nameOf(scope, company);
  return sources.some((s) => s.refs.includes(company) || namesAny(s.text, [name]));
}

/** Whether a label names someone (a person or group the job reads, but its owner and, for a group, its members) or a place the player can't see yet: what the player reads of a block. */
function labelProblem(scope: RoutineScope, owner: EntityId, label: string): string | null {
  const mine = new Set([nameOf(scope, owner), ...(scope.groups.has(owner) ? membersRead(scope, owner).map((m) => nameOf(scope, m)) : [])]);
  const people = [...scope.people].map((id) => nameOf(scope, id)).filter((n) => !mine.has(n));
  const groups = [...scope.groups].map((id) => nameOf(scope, id)).filter((n) => !mine.has(n));
  if (namesAny(label, people, groups, [...mine].join(" "))) return `its label "${label}" names someone: the player reads labels, so say who in its company`;
  if (namesAny(label, [], scope.unseen)) return `its label "${label}" names a place the player can't know yet`;
  return null;
}

/** A block's or schedule's place as given: a role, or a place the job may name. */
function readPlace(scope: RoutineScope, raw: JsonValue | undefined, problems: string[]): RoutinePlace | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const id = typeof raw === "string" ? raw : isRecord(raw) && typeof raw.place === "string" ? raw.place : null;
  if (id === null) {
    problems.push('its place is "home", "work", "with" or a place id');
    return undefined;
  }
  if (hasOwn(PLACE_ROLES, id)) return PLACE_ROLES[id];
  if (scope.places.has(id)) return { place: id };
  // A place the world doesn't have is the lint's to name (`routineIssues`); one it has but may not tell of is the job's.
  if (hasOwn(scope.world.places, id)) problems.push(`its place ${id} isn't one the player may be told of`);
  return { place: id };
}

/** One reply item checked against the draft, as one of `batch`'s owners' routine blocks or schedules. */
function checkItem(scope: RoutineScope, batch: RoutineBatch, item: { type: "routine" | "schedule"; index: number; raw: JsonValue }): RoutineCandidate | null {
  if (!isRecord(item.raw)) return null;
  const raw = item.raw;
  const owner = str(raw.owner);
  const label = neutralizeMacros(str(raw.label)).replace(/\s+/g, " ").slice(0, 80);
  const activity = neutralizeMacros(str(raw.activity)).replace(/\s+/g, " ").slice(0, 40);
  const c: RoutineCandidate = { type: item.type, owner, at: `${item.type === "routine" ? "routines" : "schedules"}[${item.index}]`, label: label || activity || "(no label)", confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0.5, notes: typeof raw.note === "string" && raw.note.trim() !== "" ? [neutralizeMacros(raw.note.trim()).slice(0, 300)] : [], sources: [], fatal: [], problems: [], lint: [], leak: false };
  if (!batch.owners.includes(owner)) c.fatal.push(`its owner ${owner === "" ? "is missing" : `"${owner}" isn't one of ${batch.owners.join(", ")}`}`);
  if (label === "") c.fatal.push("it has no label");
  if (activity === "") c.fatal.push("it has no activity");
  // Every cited source is checked; the first that holds is the one it rests on.
  const cited = Array.isArray(raw.sources) ? raw.sources : [raw.source];
  const why: string[] = [];
  for (const s of cited) {
    const checked = checkSource(scope, s);
    if (typeof checked === "string") why.push(checked);
    else if (!c.sources.some((x) => x.key === checked.key)) c.sources.push(checked);
  }
  if (c.sources.length === 0) c.fatal.push(why[0] ?? "it cites no source");
  else if (why.length > 0) c.notes.push(`a source left out: ${why.join("; ")}`);
  if (label !== "" && batch.owners.includes(owner)) {
    const named = labelProblem(scope, owner, label);
    if (named) c.problems.push(named);
  }
  const id = snake(str(raw.id) || label || activity);
  if (item.type === "routine") {
    const kind = ROUTINE_BLOCK_KINDS.find((k) => k === raw.kind);
    const place = readPlace(scope, raw.place, c.problems);
    // The days as given: their shape is the block shape check's, the holidays they name the lint's.
    const days = isRecord(raw.days) ? (JSON.parse(JSON.stringify(raw.days)) as RoutineDays) : undefined;
    const company = readCompany(scope, owner, raw.company, c);
    const block: RoutineBlock = {
      id: id || "block",
      label,
      activity,
      kind: kind ?? "flexible",
      ...(kind === "fixed" ? { at: hhmm(raw.at) } : { window: isRecord(raw.window) ? { from: hhmm(raw.window.from), to: hhmm(raw.window.to) } : { from: "", to: "" } }),
      minutes: typeof raw.minutes === "number" ? Math.round(raw.minutes) : 0,
      ...(kind !== "fixed" && typeof raw.perWeek === "number" ? { perWeek: raw.perWeek } : {}),
      ...(kind === "optional" && typeof raw.chance === "number" ? { chance: raw.chance } : {}),
      ...(typeof raw.priority === "number" ? { priority: raw.priority } : {}),
      ...(days ? { days } : {}),
      ...(place ? { place } : {}),
      ...(company ? { company } : {}),
      ...(c.sources[0] ? { source: c.sources[0].source } : {}),
    };
    if (!kind) c.fatal.push("its kind is fixed, flexible or optional");
    else for (const p of blockShapeProblems(block)) c.fatal.push(p);
    c.block = block;
    // What Build's lint will say of it as its own routine, for the repair call; `finishRoutines` asks again under its final id.
    if (c.fatal.length === 0) {
      const routineId = snake(`${owner} ${block.id}`);
      c.lint = routineIssues(scope.world, scope.reg, routineId, { id: routineId, label, owner, blocks: [block] }, scope.state).map((i) => i.message);
    }
  } else {
    let place: PlaceId | null = null;
    const given = str(raw.place);
    const resolved = given === "work" ? placeOf(scope, owner, "employer") : given === "home" ? placeOf(scope, owner, "home") : given;
    if (resolved && scope.places.has(resolved)) place = resolved;
    else if (given !== "") c.problems.push(resolved && hasOwn(scope.world.places, resolved) ? `its place ${resolved} isn't one the player may be told of` : `its place ${given} isn't in the world`);
    else c.problems.push("it names no place");
    const recurrence = readRecurrence(scope, raw.recurrence, c.fatal);
    const start = hhmm(raw.start);
    const end = hhmm(raw.end);
    for (const [what, t] of [["start", start], ["end", end]] as const) {
      try {
        parseHHMM(t);
      } catch {
        c.fatal.push(`its ${what} is an HH:MM time`);
      }
    }
    if (start !== "" && start === end) c.fatal.push("its start and end are the same time");
    c.schedule = { id: id || "schedule", label, activity, place, recurrence: recurrence ?? { every: "week" }, start, end };
  }
  c.leak = findLeaks(JSON.parse(JSON.stringify({ label, activity, quotes: c.sources.map((s) => s.source.quote ?? "") })) as JsonValue, scope.secrets).length > 0;
  return c;
}

/** A block's company as given, checked: people the job reads who have a ground with its owner, or a group its owner belongs to. */
function readCompany(scope: RoutineScope, owner: EntityId, raw: JsonValue | undefined, c: RoutineCandidate): RoutineCompany | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    c.problems.push('its company is {"ids"} or {"group"}');
    return undefined;
  }
  const invite = raw.invite === true ? { invite: true } : {};
  const ids = strings(raw.ids);
  if (ids && ids.length > 0) {
    const kept: EntityId[] = [];
    for (const id of [...new Set(ids)]) {
      if (id === owner) continue;
      // An id the draft has but the job may not read (a secret person) is the job's to refuse; one it doesn't have at all, the lint's.
      if (!scope.people.has(id) && (hasOwn(scope.state.entities, id) || hasOwn(scope.world.places, id))) c.problems.push(`its company "${id}" isn't a person in the world`);
      else if (scope.people.has(id) && !grounded(scope, owner, id, c.sources)) c.problems.push(`${nameOf(scope, id)} (${id}) in its company has no tie to ${nameOf(scope, owner)}, and the cited text doesn't name them together`);
      kept.push(id);
    }
    return kept.length > 0 ? { who: { ids: kept }, ...invite } : undefined;
  }
  const group = str(raw.group);
  if (group !== "") {
    if (!scope.groups.has(group)) c.problems.push(`its company "${group}" isn't a group in the world`);
    else if (group !== owner && !isMemberOf(scope.state, owner, group)) c.problems.push(`${nameOf(scope, owner)} doesn't belong to ${nameOf(scope, group)} (${group}), its company`);
    return { who: { memberOf: [group] }, ...invite };
  }
  c.problems.push('its company names no one: {"ids": [...]} or {"group": "<id>"}');
  return undefined;
}

/** A schedule's recurrence as given; what doesn't read goes to `fatal`. */
function readRecurrence(scope: RoutineScope, raw: JsonValue | undefined, fatal: string[]): Recurrence | null {
  if (!isRecord(raw) || typeof raw.every !== "string" || !hasOwn(RECURRENCES, raw.every)) {
    fatal.push('its recurrence is {"every": "day"|"week"|"month"|"year", …}');
    return null;
  }
  const r: Recurrence = { every: raw.every as Recurrence["every"] };
  if (raw.weekdays !== undefined) {
    const w = ints(raw.weekdays, 0, 6);
    if (w && w.length > 0) r.weekdays = w;
    else fatal.push("its weekdays are 0 (Sunday) to 6");
  }
  if (raw.days !== undefined) {
    const d = ints(raw.days, -31, 31);
    if (d && d.length > 0 && !d.includes(0)) r.days = d;
    else fatal.push("its days of the month are 1 to 31, or -1 to -31 from the end");
  }
  for (const key of ["from", "until"] as const) {
    const v = str(raw[key]);
    if (v === "") continue;
    try {
      dayIndexOfText(scope.cal, v);
      r[key] = v;
    } catch {
      fatal.push(`its ${key} is a YYYY-MM-DD date`);
    }
  }
  if (raw.except !== undefined) {
    const ids = strings(raw.except);
    const known = new Set(scope.cal.def.holidays.map((h) => h.id));
    if (ids && ids.every((id) => known.has(id))) {
      if (ids.length > 0) r.except = ids;
    } else fatal.push("its except names holidays the calendar doesn't have");
  }
  return r;
}

/**
 * A reply checked against the draft as `batch`'s routines and schedules: each item with what keeps
 * it out, what it is proposed with, and what the helper can fix; or why the reply can't be read at all.
 */
export function checkRoutineReply(scope: RoutineScope, batch: RoutineBatch, reply: JsonValue | null): RoutineCheck {
  if (reply === null) return { problem: "empty or not JSON", candidates: [], fixable: [] };
  const items = itemsOf(reply);
  if (!items) return { problem: "JSON in another shape", candidates: [], fixable: [] };
  const candidates = items.flatMap((item) => checkItem(scope, batch, item) ?? []);
  if (items.length > 0 && candidates.length === 0) return { problem: `none of its ${items.length} item(s) readable`, candidates: [], fixable: [] };
  const fixable = candidates.filter((c) => !c.leak).flatMap((c) => [...c.fatal, ...c.problems, ...c.lint].map((p) => `${c.at} (${nameOf(scope, c.owner)}, "${c.label}"): ${p}`));
  return { problem: null, candidates, fixable };
}

/** The repair call's request: the first request, what was wrong, and the answer it was wrong in. */
export function routineRepairText(request: string, reply: JsonValue | null, check: RoutineCheck): string {
  const what = check.problem !== null ? `Your answer couldn't be read (${check.problem}).` : `Your answer had these problems:\n${check.fixable.map((p) => `- ${p}`).join("\n")}`;
  return `${request}\n\n${what}\n\nYour answer was:\n${reply === null ? "(nothing usable)" : JSON.stringify(reply)}\n\nAnswer again with every item, the right ones as they were and the listed ones fixed; leave out any you can't ground in what's above. JSON only, in this shape: ${OUTPUT}.`;
}

/**
 * What a batch keeps after its repair call: the repair's answer, and what the first answer had right
 * that the repair left out (nothing the repair already has, by what makes two proposals the same).
 */
export function afterRepair(first: RoutineCheck, again: RoutineCheck): RoutineCheck {
  const have = new Set(again.candidates.map(sameKey));
  return { ...again, candidates: [...again.candidates, ...first.candidates.filter((c) => c.fatal.length === 0 && c.problems.length === 0 && !c.leak && !have.has(sameKey(c)))] };
}

// ---------------------------------------------------------------- clashes, dedupe and the proposals

/** A span of clock minutes, [start, end). */
type Span = [number, number];

/** The day indexes the clash check walks: the story's first `CHECK_DAYS`. */
function checkDays(scope: RoutineScope): number[] {
  const first = dateAt(scope.cal, scope.start ?? 0).dayIndex;
  return Array.from({ length: CHECK_DAYS }, (_, i) => first + i);
}

/** A start and length of the day as clock spans: an end at or before the start runs past midnight. */
function span(scope: RoutineScope, day: number, from: string, minutes: number): Span {
  const start = clockAt(scope.cal, day, parseHHMM(from));
  return [start, start + minutes];
}

/** Minutes from one HH:MM to another, past midnight when the second is at or before the first. */
function windowLength(from: string, to: string): number {
  const a = parseHHMM(from);
  const b = parseHHMM(to);
  return b > a ? b - a : b + MINUTES_PER_DAY - a;
}

/** A schedule's slots on the checked days, as spans. */
function scheduleSpans(scope: RoutineScope, recurrence: Recurrence, slots: readonly { start: string; end: string }[]): Span[] {
  const out: Span[] = [];
  for (const day of checkDays(scope)) {
    if (!recursOn(scope.cal, recurrence, day)) continue;
    for (const slot of slots) {
      try {
        out.push(span(scope, day, slot.start, windowLength(slot.start, slot.end)));
      } catch {
        // A slot whose times don't read clashes with nothing (lint names it).
      }
    }
  }
  return out;
}

/**
 * A block's runs on the checked days for `who`, on the days the planner lays it (`blockOnDay`: its
 * days, its weekly count and its chance): a fixed one's from its start for its minutes; with `reach`,
 * a flexible or optional one's whole reach, from its window's start to its latest start's end.
 */
function blockSpans(scope: RoutineScope, who: EntityId, b: RoutineBlock, reach = false): Span[] {
  if (b.kind !== "fixed" && !reach) return [];
  const from = b.kind === "fixed" ? b.at : b.window?.from;
  if (from === undefined) return [];
  const minutes = b.kind === "fixed" || !b.window ? b.minutes : windowLength(b.window.from, b.window.to) + b.minutes;
  try {
    return checkDays(scope).flatMap((day) => (blockOnDay(scope.ctx, who, b, day) ? [span(scope, day, from, minutes)] : []));
  } catch {
    return [];
  }
}

const meets = (a: Span, b: Span): boolean => a[0] < b[1] && b[0] < a[1];

/** Whether a flexible block finds room somewhere: on some day it's on for `who`, a gap in its reach as long as it, between `busy` spans. */
function findsRoom(scope: RoutineScope, who: EntityId, b: RoutineBlock, busy: readonly Span[]): boolean {
  if (b.kind === "fixed") return true;
  for (const [from, to] of blockSpans(scope, who, b, true)) {
    let at = from;
    for (const [s, e] of busy.filter((x) => x[1] > from && x[0] < to).sort((x, y) => x[0] - y[0])) {
      if (s - at >= b.minutes) return true;
      at = Math.max(at, e);
    }
    if (to - at >= b.minutes) return true;
  }
  return false;
}

/** The place a block or schedule has someone at: the place it names, their home or workplace, or (for "with") the first of its company's home. */
function placeFor(scope: RoutineScope, who: EntityId, place: RoutinePlace | PlaceId | null | undefined, company?: RoutineCompany): PlaceId | null {
  if (place === null || place === undefined || place === "home") return placeOf(scope, who, "home");
  if (place === "work") return placeOf(scope, who, "employer") ?? placeOf(scope, who, "home");
  if (place === "here") return null;
  if (place === "with") {
    const first = company?.who.ids?.[0];
    return first ? placeOf(scope, first, "home") : null;
  }
  if (typeof place === "string") return place;
  return "place" in place ? place.place : null;
}

/**
 * One run of what an owner's days hold, named for the review: a schedule's slot, setting an activity
 * or a place; a fixed routine block's run; or a flexible block's reach (`floating`), which clashes
 * with nothing but is repeated by a block of its activity. A run of an earlier proposal (`proposed`)
 * clashes as the world's do, but nothing repeats it: two proposals alike are the dedupe's.
 */
interface HeldRun {
  what: string;
  span: Span;
  activity?: string;
  place?: PlaceId | null;
  floating?: boolean;
  proposed?: boolean;
}

/** What an owner's own schedules and routine blocks hold over the checked days (another target than place or activity contends with no block). */
function heldRuns(scope: RoutineScope, owner: EntityId): HeldRun[] {
  const out: HeldRun[] = [];
  for (const id of Object.keys(scope.world.schedules).sort()) {
    const s = own(scope.world.schedules, id);
    if (!s || s.owner !== owner || (s.target !== "activity" && s.target !== "place")) continue;
    for (const slot of s.slots) {
      if (typeof slot.value !== "string") continue;
      const value = slot.value;
      for (const run of scheduleSpans(scope, s.recurrence, [slot])) out.push({ what: `the schedule ${id}`, span: run, ...(s.target === "activity" ? { activity: value } : { place: value }) });
    }
  }
  for (const id of Object.keys(scope.world.routines ?? {}).sort()) {
    const r = own(scope.world.routines ?? {}, id);
    if (!r || r.owner !== owner) continue;
    for (const b of r.blocks) {
      if (isOff(b)) continue;
      const what = `the block ${b.id} of the routine ${id}`;
      const place = placeFor(scope, owner, b.place, b.company);
      for (const run of blockSpans(scope, owner, b, true)) out.push({ what, span: run, activity: b.activity, place, ...(b.kind === "fixed" ? {} : { floating: true }) });
    }
  }
  return out;
}

/** What a proposal does, for the clash check: its runs (fixed ones; a flexible one's reach is only for repeats), what it sets, where. */
interface ProposedRuns {
  fixed: Span[];
  reach: Span[];
  activity: string;
  place: PlaceId | null;
}

/**
 * How a proposal stands against what the owner's days hold: `repeat`, when it is already there at
 * those times (every fixed run covered by runs of its activity, or by place runs at its place; a
 * flexible one's reach meeting a run of its activity); otherwise the runs it clashes with (another
 * activity, or another place, at a fixed run's time).
 */
function standing(scope: RoutineScope, p: ProposedRuns, held: readonly HeldRun[]): { repeat: string | null; clashes: string[] } {
  const doing = (h: HeldRun): boolean => h.activity !== undefined && plainText(h.activity) === plainText(p.activity);
  const there = (h: HeldRun): boolean => h.activity === undefined && !!h.place && !!p.place && (h.place === p.place || placeWithin(scope.world, p.place, h.place) || placeWithin(scope.world, h.place, p.place));
  if (p.fixed.length > 0) {
    for (const agrees of [doing, there]) {
      const runs = held.filter((h) => agrees(h) && !h.floating && !h.proposed).sort((x, y) => x.span[0] - y.span[0]);
      const covered = p.fixed.every(([s, e]) => {
        let at = s;
        for (const h of runs) if (h.span[0] <= at && h.span[1] > at) at = h.span[1];
        return at >= e;
      });
      const by = runs.find((h) => p.fixed.some((r) => meets(h.span, r)));
      if (covered && by) return { repeat: by.what, clashes: [] };
    }
  } else {
    const by = held.find((h) => doing(h) && !h.proposed && p.reach.some((r) => meets(h.span, r)));
    if (by) return { repeat: by.what, clashes: [] };
  }
  const clashes = new Set<string>();
  for (const h of held) {
    if (h.floating || !p.fixed.some((r) => meets(h.span, r))) continue;
    if (h.activity !== undefined ? !doing(h) : !!h.place && !!p.place && !there(h)) clashes.add(h.what);
  }
  return { repeat: null, clashes: [...clashes] };
}

/**
 * Whether a fixed block or slot would take someone from where the story starts them, as it starts:
 * it runs at the start's minute somewhere else. For a group, any of its members.
 */
function pullsAway(scope: RoutineScope, owner: EntityId, spans: readonly Span[], place: (who: EntityId) => PlaceId | null): string | null {
  const start = scope.start;
  if (start === null || !spans.some(([s, e]) => s <= start && start < e)) return null;
  for (const who of scope.groups.has(owner) ? membersRead(scope, owner) : [owner]) {
    const at = placeOfEntity(scope.state, who);
    const there = place(who);
    if (at === null || there === null || placeWithin(scope.world, at, there) || placeWithin(scope.world, there, at)) continue;
    return `it would take ${nameOf(scope, who)} from ${scope.places.has(at) ? nameOf(scope, at) : "where the story starts them"} as the story starts`;
  }
  return null;
}

/** A routine's id, a block's id or a schedule's not yet taken, from `base`: `base`, else `base_2`, `base_3`… */
function freeId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/** What makes two proposals the same, for dedupe: whose, what kind, what they do, where, when and on which days. */
function sameKey(c: RoutineCandidate): string {
  if (c.block) {
    const b = c.block;
    return JSON.stringify(["routine", c.owner, b.kind, plainText(b.activity), b.place ?? "home", b.at ?? b.window, b.perWeek ?? 7, b.days ?? {}]);
  }
  const s = c.schedule;
  return JSON.stringify(["schedule", c.owner, plainText(s?.activity ?? ""), s?.place, s?.recurrence, s?.start, s?.end]);
}

/**
 * The candidates as proposals: the fatal and the leaking dropped (counted in `drops`), repeats of
 * each other and of the world dropped (the most confident of a kind kept, ties to the first), ids made
 * free, then each checked for clashes with the owner's schedules and routine, with the proposals
 * before it and with where the story starts them. A routine block is one routine of its own, so each
 * applies alone; a schedule is its activity schedule and, at a place, its place schedule, which the
 * review takes together. A proposal with problems keeps them, unticked.
 */
export function finishRoutines(scope: RoutineScope, candidates: readonly RoutineCandidate[], drops: DropCounts = new Map()): JobProposal[] {
  const drop = (why: string): void => void drops.set(why, (drops.get(why) ?? 0) + 1);
  const best = new Map<string, RoutineCandidate>();
  for (const c of candidates) {
    if (c.leak) {
      drop("carried a secret's words");
      continue;
    }
    if (c.fatal.length > 0) {
      drop(c.sources.length === 0 ? "cited nothing they rest on" : "didn't read as a routine or a schedule");
      continue;
    }
    const key = sameKey(c);
    const prior = best.get(key);
    if (!prior || c.confidence > prior.confidence) best.set(key, c);
    if (prior) drop("repeated another proposal");
  }
  const routines = scope.world.routines ?? {};
  const takenRoutines = new Set<string>();
  const takenSchedules = new Set<string>();
  const takenBlocks = new Map<EntityId, Set<string>>();
  // Each owner's runs: what the world holds, then each proposal kept before this one.
  const runs = new Map<EntityId, HeldRun[]>();
  const proposals: JobProposal[] = [];
  for (const c of [...best.values()].sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0))) {
    let held = runs.get(c.owner);
    if (!held) {
      held = heldRuns(scope, c.owner);
      runs.set(c.owner, held);
    }
    const problems = [...c.problems];
    const notes = [...c.notes];
    const sourceNames = Object.fromEntries(c.sources.map((s) => [s.key, s.name]));
    if (c.block) {
      const block = c.block;
      const place = placeFor(scope, c.owner, block.place, block.company);
      const p: ProposedRuns = { fixed: blockSpans(scope, c.owner, block), reach: blockSpans(scope, c.owner, block, true), activity: block.activity, place };
      const { repeat, clashes } = standing(scope, p, held);
      if (repeat) {
        drop("repeated what the world already has");
        continue;
      }
      for (const what of clashes) problems.push(`it clashes with ${what}`);
      const busy = held.filter((h) => !h.floating).map((h) => h.span);
      if (!findsRoom(scope, c.owner, block, busy)) problems.push(`it never has room in its window: ${[...new Set(held.filter((h) => !h.floating && p.reach.some((r) => meets(h.span, r))).map((h) => h.what))].join(", ")} fill it`);
      const away = pullsAway(scope, c.owner, p.fixed, (who) => placeFor(scope, who, block.place, block.company));
      if (away) problems.push(away);
      // A meal or sleep's id replaces it on every day: a block on fewer days, or not every time, takes its own.
      const narrow = block.days !== undefined || block.perWeek !== undefined || block.kind === "optional";
      const named = snake(block.label);
      let id = hasOwn(BASIC_IDS, block.id) && narrow ? (named !== "" && !hasOwn(BASIC_IDS, named) ? named : `${block.id}_${block.kind}`) : block.id;
      let mine = takenBlocks.get(c.owner);
      if (!mine) {
        mine = new Set(Object.values(routines).flatMap((r: RoutineDef) => (r.owner === c.owner ? r.blocks.map((b) => b.id) : [])));
        takenBlocks.set(c.owner, mine);
      }
      if (mine.has(id)) {
        const taken = mine;
        const free = freeId(id, (x) => taken.has(x));
        notes.push(`its id is ${free}: ${id} is taken in ${nameOf(scope, c.owner)}'s routine`);
        id = free;
      }
      mine.add(id);
      held.push(...p.reach.map((r) => ({ what: `the proposed block ${id}`, span: r, activity: block.activity, place, proposed: true, ...(block.kind === "fixed" ? {} : { floating: true }) })));
      const routineId = freeId(snake(`${c.owner} ${id}`), (x) => hasOwn(routines, x) || takenRoutines.has(x));
      takenRoutines.add(routineId);
      const value: RoutineDef = { id: routineId, label: block.label, owner: c.owner, blocks: [{ ...block, id }] };
      // The lint's word for the routine as it will be saved, so the review says what Build's Problems will.
      for (const issue of routineIssues(scope.world, scope.reg, routineId, value, scope.state)) problems.push(issue.message);
      proposals.push(proposalOf("routines", routineId, value as unknown as JsonValue, c, problems, notes, sourceNames));
      continue;
    }
    const s = c.schedule;
    if (!s) continue;
    const fixed = scheduleSpans(scope, s.recurrence, [s]);
    const { repeat, clashes } = standing(scope, { fixed, reach: fixed, activity: s.activity, place: s.place }, held);
    if (repeat) {
      drop("repeated what the world already has");
      continue;
    }
    for (const what of clashes) problems.push(`it clashes with ${what}`);
    const away = pullsAway(scope, c.owner, fixed, () => s.place);
    if (away) problems.push(away);
    const base = freeId(snake(`${c.owner} ${s.id}`), (x) => [`${x}_activity`, `${x}_place`].some((y) => hasOwn(scope.world.schedules, y) || takenSchedules.has(y)));
    held.push(...fixed.map((r) => ({ what: `the proposed schedule ${base}`, span: r, activity: s.activity, place: s.place, proposed: true })));
    const source = c.sources[0]?.source;
    const twins = [{ target: "activity", value: s.activity }, ...(s.place ? [{ target: "place", value: s.place }] : [])];
    for (const t of twins) {
      const id = `${base}_${t.target}`;
      takenSchedules.add(id);
      const value: ScheduleDef = { id, owner: c.owner, target: t.target, recurrence: s.recurrence, slots: [{ start: s.start, end: s.end, value: t.value }], pack: "castlife", ...(source ? { source } : {}) };
      const twin = twins.length > 1 ? [`goes with schedules.${base}_${t.target === "activity" ? "place" : "activity"}: apply both`] : [];
      proposals.push(proposalOf("schedules", id, value as unknown as JsonValue, c, problems, [...notes, ...twin], sourceNames));
    }
  }
  return proposals;
}

function proposalOf(collection: "routines" | "schedules", key: string, value: JsonValue, c: RoutineCandidate, problems: readonly string[], notes: readonly string[], sourceNames: Record<string, string>): JobProposal {
  return {
    id: `${collection}:${key}`,
    collection,
    key,
    value,
    source: c.sources[0]?.key ?? "",
    confidence: problems.length > 0 ? Math.min(c.confidence, FLAGGED_CONFIDENCE) : c.confidence,
    pack: "castlife",
    owner: c.owner,
    sourceNames,
    ...(problems.length > 0 ? { problems: [...problems] } : {}),
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}
