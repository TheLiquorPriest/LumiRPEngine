// Player-facing event lines (DESIGN §7, D8): what a chip, the Journal or a Montage may
// say about an event. An event shows only when the POV may see it and everything it refers to:
// its own visibility (`eventVisible`, every field it writes included), every entity it names
// (visible and met), every place (visible) and every track (public, or revealed). Bookkeeping
// events and off-screen NPC↔NPC events never show. Lines use names and labels, never ids, and
// never carry unrevealed truth.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId } from "../shared/ids";
import { heldBy } from "../shared/finance";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { formatMoney, formatTemperature } from "../shared/world";
import { fieldNoun, listWords, possessive } from "../shared/words";
import { ENGINE_EVENTS } from "./engine-pack";
import { passMemo } from "./read-pass";
import type { Registry } from "./registry-impl";
import { bandOf, fieldDef, GONE_FIELD, kindIs, placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { optionalQuery, own } from "./pack-kit";
import { canSeeEntity, canSeePlace, couldSeeEntity, eventVisible, findLeaks, knows, namesAny, secretLoreTitles, trackShown, unrevealedSecrets, unseenPlaceNames } from "./visibility";

/**
 * Event types that are engine or pack bookkeeping: never player-facing lines. Built on first use:
 * the engine pack's own channels read who the POV may know from this module, so it can load before
 * the engine pack has named its events.
 */
let bookkeepingTypes: Readonly<Record<string, true>> | null = null;
function bookkeeping(type: string): boolean {
  bookkeepingTypes ??= {
    clock: true,
    timelapse: true,
    materialize: true,
    [ENGINE_EVENTS.fired]: true,
    [ENGINE_EVENTS.caught]: true,
    [ENGINE_EVENTS.cursor]: true,
    [ENGINE_EVENTS.choice]: true,
    [ENGINE_EVENTS.attempt]: true,
    // The receipt's chip for the player's own opening of a hint names it; the event is the count.
    [ENGINE_EVENTS.hint]: true,
    [ENGINE_EVENTS.pause]: true,
    [ENGINE_EVENTS.beat]: true,
    [ENGINE_EVENTS.observed]: true,
    // A fix of the time words how it moved the clock as a whole, never this event alone.
    [ENGINE_EVENTS.rewind]: true,
    // The roll chip and the Outcome slot tell how a check was decided.
    [ENGINE_EVENTS.adjudged]: true,
    "castlife.decision": true,
    "castlife.override": true,
    "economy.price": true,
    // The POV's transaction history mirrors its `post` events, which carry the line.
    "economy.txn": true,
    // A flow's run carries its schedule state; its posting and its payer's note carry the line, so
    // nobody else's bills, takings or living costs reach the player.
    "economy.flow_run": true,
    // The work module's books (DESIGN §26.4): sales, remittances, invoices paid, payouts, payslips,
    // commission and estimated tax. Their postings and the payer's notes carry the lines.
    "economy.sale": true,
    "economy.remit": true,
    "economy.invoice_paid": true,
    "economy.payout": true,
    "economy.payslip": true,
    "economy.commission": true,
    "economy.estimated_tax": true,
    // The holdings module's books (DESIGN §27.11): marks, contracts listed, lots, income and gains
    // records, and routes. What anyone hears of a trade, a payout or a sale is its posting.
    "economy.quote": true,
    "economy.mint": true,
    "economy.lots": true,
    "economy.income": true,
    "economy.exercise": true,
    "economy.dispose": true,
    "economy.acquire": true,
    "economy.stake_route": true,
    "story.flag": true,
    // A fight's turn order, economy and recorded picks; what anyone did is `combat.act`.
    "combat.turn": true,
    "combat.spend": true,
    "combat.decision": true,
  };
  return hasOwn(bookkeepingTypes, type);
}

/**
 * A posting as a line: the memo with what moved, between the POV's own accounts on a player's line,
 * and between any accounts in the world on the GM's or the author's (`player` false), so a GM's
 * correction to someone else's account says how much and where.
 */
function postLine(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, memo: string, lines: readonly { account: string; amount: number }[], player: boolean): string | null {
  const mine = lines.filter((l) => (player ? heldBy(state.entities, l.account, pov) : hasOwn(state.entities, l.account)));
  const label = memo !== "" ? memo : "Money moved";
  if (mine.length === 0) return memo !== "" ? memo : null;
  const money = (cents: number): string => formatMoney(Math.abs(cents), world.currency);
  const name = (id: string): string => own(state.entities, id)?.name ?? id;
  const out = mine.filter((l) => l.amount < 0);
  const into = mine.filter((l) => l.amount > 0);
  const from = out[0];
  const to = into[0];
  if (out.length === 1 && into.length === 1 && from && to) return `${label}: ${money(to.amount)} from ${name(from.account)} to ${name(to.account)}`;
  const only = mine[0];
  if (mine.length === 1 && only) return `${label}: ${money(only.amount)} ${only.amount < 0 ? "out of" : "into"} ${name(only.account)}`;
  const net = mine.reduce((a, l) => a + l.amount, 0);
  return net === 0 ? label : `${label}: ${net < 0 ? "−" : "+"}${money(net)}`;
}

/** Pack events about one person's private bookkeeping: shown for the POV only. */
const POV_ONLY = new Set<string>(["castlife.need", "economy.anchor"]);

/** Number fields holding clock readings or cursors: internal, never a line. */
const INTERNAL_FIELD = /(^_|_until$|_at$|_since$|_seed$|_cursor$)/;

/** How deep a holder chain is followed when deciding whether the POV has something. */
const HOLD_DEPTH = 8;

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/**
 * Whether the POV has met `id`: itself; something it owns or holds; anyone it has a relation with,
 * either way (knows, regard, uses, …); or anyone where it is now.
 */
export function metBy(state: Readonly<WorldState>, pov: EntityId, id: EntityId): boolean {
  if (id === pov) return true;
  const e = hasOwn(state.entities, id) ? own(state.entities, id) : undefined;
  const p = own(state.entities, pov);
  if (!e || !p) return false;
  if (heldBy(state.entities, id, pov) || knows(state, pov, id)) return true;
  let holder: string | undefined = id;
  for (let i = 0; holder && i < HOLD_DEPTH; i++) {
    holder = own(state.entities, holder)?.relations.find((r) => r.type === "in")?.to;
    if (holder === pov) return true;
  }
  if (p.relations.some((r) => r.to === id) || e.relations.some((r) => r.to === pov)) return true;
  return typeof e.fields.place === "string" && e.fields.place === p.fields.place;
}

/** The regions the POV is in: its place's `region`, then each parent place's. */
function povRegions(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string[] {
  const out: string[] = [];
  const start = own(state.entities, pov)?.fields.place;
  let place: string | undefined = typeof start === "string" ? start : undefined;
  for (let i = 0; place !== undefined && i < HOLD_DEPTH; i++) {
    const def: WorldDoc["places"][string] | undefined = own(world.places, place);
    if (!def) break;
    if (typeof def.fields.region === "string") out.push(def.fields.region);
    place = def.parent;
  }
  return out;
}

/** Whether the POV may see and has met an entity; the region it stands in (its weather) counts. */
export function playerKnows(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId): boolean {
  if (!canSeeEntity(reg, world, state, pov, id)) return false;
  return metBy(state, pov, id) || povRegions(world, state, pov).includes(id);
}

/**
 * Whether the POV may be told about an entity: itself, someone it has met, its own thing, or someone
 * it can see where it stands (an extraction chip must never name a stranger). A world
 * that doesn't place the POV can't tell who is present: every entity it can see counts.
 */
export function povMayKnow(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  const pov = world.pov;
  if (id === pov || playerKnows(reg, world, state, pov, id)) return true;
  if (!canSeeEntity(reg, world, state, pov, id)) return false;
  if (heldBy(state.entities, id, pov)) return true;
  const here = placeOfEntity(state, pov);
  return here === undefined || placeOfEntity(state, id) === here;
}

type Ref = { kind: "entity" | "place" | "track"; id: string };

/** The entities, places and tracks an event refers to. Pack events are scanned value by value. */
function refsOf(world: WorldDoc, state: Readonly<WorldState>, e: LedgerEvent): Ref[] {
  const out: Ref[] = [];
  const add = (v: unknown): void => {
    if (typeof v !== "string" || v === "") return;
    if (hasOwn(state.entities, v)) out.push({ kind: "entity", id: v });
    else if (hasOwn(world.places, v)) out.push({ kind: "place", id: v });
    else if (hasOwn(world.tracks, v)) out.push({ kind: "track", id: v });
  };
  const visit = (v: JsonValue | undefined, depth: number): void => {
    if (depth > 4) return;
    if (typeof v === "string") add(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (isRecord(v)) Object.values(v).forEach((x) => visit(x as JsonValue, depth + 1));
  };
  switch (e.type) {
    case "set":
      add(e.entity);
      visit(e.value, 0);
      break;
    case "add":
      add(e.entity);
      break;
    case "link":
    case "unlink":
      add(e.from);
      add(e.to);
      break;
    case "spawn":
      add(e.entity.id);
      add(e.entity.fields.place);
      break;
    case "stage":
      add(e.track);
      break;
    case "post":
      break;
    default:
      if ("data" in e) visit(e.data, 0);
  }
  return out;
}

/** Whether the POV may see this event in a chip, the Journal or a Montage. */
export function playerEventVisible(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): boolean {
  if (bookkeeping(e.type)) return false;
  if (!eventVisible(reg, world, state, pov, e)) return false;
  if ("data" in e && isRecord(e.data)) {
    // Off-screen NPC↔NPC changes (an encounter's regard) are nobody's news.
    if (e.data.npc === true) return false;
    if (POV_ONLY.has(e.type) && (e.data.agent ?? e.data.entity ?? e.data.who) !== pov) return false;
  }
  // Someone else's routine (where they go, what they're doing, and any field a schedule sets) is what
  // a death the POV didn't see quietly ends. The Journal is read later, against what the POV knows by
  // then, so it can't tell which of those changes the POV saw: it words none of them, and Scene and
  // People say who is here.
  if (e.type === "set" && e.entity !== pov && (e.field === "place" || e.field === "activity" || [...Object.values(world.schedules), ...reg.schedules].some((s) => s.target === e.field)) && kindIs(reg, world, own(state.entities, e.entity)?.kind ?? "", "person")) return false;
  if (e.type === "stage" && !trackShown(reg, world, state, pov, e.track)) return false;
  for (const r of refsOf(world, state, e)) {
    if (r.kind === "entity" && !playerKnows(reg, world, state, pov, r.id)) return false;
    if (r.kind === "place" && !canSeePlace(reg, world, state, pov, r.id)) return false;
    if (r.kind === "track" && !trackShown(reg, world, state, pov, r.id)) return false;
  }
  return true;
}

/** An entity's, place's or track's name; the POV is `you` ("You" on a player's line). */
function nameOf(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string, you = "You"): string {
  if (id === pov) return you;
  return own(state.entities, id)?.name ?? own(world.places, id)?.name ?? own(world.tracks, id)?.label ?? id;
}

function humanize(field: string): string {
  return field.replace(/_/g, " ");
}

/** Whether a line's subject takes a plural verb: the POV, named "You" or "you". */
function plural(name: string): boolean {
  return name === "You" || name === "you";
}

/**
 * How a line names what a value points at. A place by name with the places around it, outermost
 * first ("Alder Automotive (Lakeshore County › Port Alder)"); a thing by name with where it is
 * ("Camper van (at Alder Automotive)", "Toolbox (carried by Danny Okafor)"); anyone else by name.
 * On a player's line only the places and holders the POV may know are named.
 */
interface Words {
  /** The subject, by name; the POV as the line's `you`. */
  name(id: string): string;
  /** The same, mid-sentence: the POV as "you" rather than "You". */
  object(id: string): string;
  place(id: string): string;
  thing(id: string): string;
  isPerson(id: string): boolean;
}

function wordsFor(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, player: boolean, you: string): Words {
  const name = (id: string): string => nameOf(world, state, pov, id, you);
  const object = (id: string): string => (id === pov && you === "You" ? "you" : name(id));
  const placeShown = (id: string): boolean => !player || canSeePlace(reg, world, state, pov, id);
  const place = (id: string): string => {
    const p = own(world.places, id);
    if (!p) return object(id);
    const around: string[] = [];
    for (let cur = p.parent, guard = 0; cur !== undefined && guard < HOLD_DEPTH * 4; guard++) {
      const up: WorldDoc["places"][string] | undefined = own(world.places, cur);
      if (!up) break;
      if (placeShown(cur)) around.unshift(up.name);
      cur = up.parent;
    }
    return around.length > 0 ? `${p.name} (${around.join(" › ")})` : p.name;
  };
  const isPerson = (id: string): boolean => id === pov || kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person");
  const thing = (id: string): string => {
    const e = own(state.entities, id);
    if (!e || isPerson(id)) return object(id);
    const holder = e.relations.find((r) => r.type === "in")?.to;
    if (holder !== undefined && hasOwn(state.entities, holder) && (!player || playerKnows(reg, world, state, pov, holder))) return `${e.name} (${isPerson(holder) ? "carried by" : "in"} ${object(holder)})`;
    const at = typeof e.fields.place === "string" ? e.fields.place : null;
    return at !== null && hasOwn(world.places, at) && placeShown(at) ? `${e.name} (at ${own(world.places, at)?.name ?? at})` : e.name;
  };
  return { name, object, place, thing, isPerson };
}

/** A value in words: a place or a thing as `Words` names them, an enum or a code-like word as words, a number by its band, as money or with its unit. */
function valueText(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, words: Words, kind: string, field: string, v: JsonValue): string | null {
  if (typeof v === "string") {
    if (hasOwn(world.places, v)) return words.place(v);
    if (hasOwn(state.entities, v)) return words.thing(v);
    // An enum value or a code-like word (`needs_service`) reads as words ("needs service").
    if (fieldDef(reg, world, kind, field)?.type === "enum" || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(v)) return humanize(v);
    return v.length > 80 ? `${v.slice(0, 79)}…` : v;
  }
  if (typeof v === "number") {
    const def = fieldDef(reg, world, kind, field);
    if (def?.type === "money") return formatMoney(v, world.currency);
    const band = def?.bands ? bandOf(def.bands, v) : null;
    return band ? band.label : `${Math.round(v * 100) / 100}${fieldNoun(def?.label, field).unit}`;
  }
  return null;
}

/**
 * A field's change in a sentence (DESIGN §7, Player-facing wording): who, what the field is and the
 * value in words, never the form's label glued to a value. A place and a bed, a home and an owner
 * read as what they mean ("Danny Okafor now sleeps at Alder Automotive (Lakeshore County › Port
 * Alder)"); any other field as itself ("Festival clipboard's condition is now worn"); a cap
 * (`atMost`) as the most it can be ("Your HP is now at most 15"), true wherever it was replayed.
 */
function setLine(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, words: Words, entity: EntityId, field: string, value: JsonValue, atMost: boolean): string | null {
  const who = words.name(entity);
  const many = plural(who);
  const ref = (v: string): string => (hasOwn(world.places, v) ? words.place(v) : words.thing(v));
  const target = typeof value === "string" && (hasOwn(world.places, value) || hasOwn(state.entities, value)) ? value : null;
  switch (field) {
    case "place":
      if (target !== null) return `${who} ${many ? "are" : "is"} now at ${words.place(target)}`;
      break;
    case "bed": {
      // No bed is sleeping at home (DESIGN §8); a thing that holds things (a van, a tent) is slept in, any other on.
      if (value === null) return `${who} now ${many ? "sleep" : "sleeps"} at home`;
      if (target === null) break;
      const bedKind = own(state.entities, target)?.kind ?? "";
      const at = hasOwn(world.places, target) ? "at" : kindIs(reg, world, bedKind, "container") || kindIs(reg, world, bedKind, "vehicle") ? "in" : "on";
      return `${who} now ${many ? "sleep" : "sleeps"} ${at} ${ref(target)}`;
    }
    case "home":
      if (value === null) return `${who} no longer ${many ? "have" : "has"} a home`;
      if (target !== null) return `${who} now ${many ? "live" : "lives"} ${hasOwn(world.places, target) ? "at" : "in"} ${ref(target)}`;
      break;
    case "owner":
      if (value === null) return `${who} no longer ${many ? "belong" : "belongs"} to anyone`;
      if (target !== null) return `${who} now ${many ? "belong" : "belongs"} to ${words.object(target)}`;
      break;
  }
  const kind = own(state.entities, entity)?.kind ?? "";
  const def = fieldDef(reg, world, kind, field);
  const { noun } = fieldNoun(def?.label, field);
  const whose = possessive(who);
  if (value === null) return `${whose} ${noun} is no longer set`;
  if (typeof value === "boolean") return `${who} ${many ? "are" : "is"} ${value ? "now" : "no longer"} marked “${noun}”`;
  if (Array.isArray(value)) {
    const items = value.map((x) => (typeof x === "string" ? (hasOwn(world.places, x) || hasOwn(state.entities, x) ? ref(x) : humanize(x)) : typeof x === "number" ? String(x) : null));
    if (items.some((x) => x === null)) return `${whose} ${noun} changed`;
    const shown = items.filter((x): x is string => x !== null);
    return shown.length === 0 ? `${whose} ${noun} are now none` : `${whose} ${noun} are now ${listWords(shown)}`;
  }
  const v = field === "temp_c" && typeof value === "number" ? formatTemperature(value) : valueText(reg, world, state, words, kind, field, value);
  return v === null ? null : `${whose} ${noun} is now ${atMost ? "at most " : ""}${v}`;
}

/** A relation's change in a sentence: who now knows, carries, holds, owns, wears or belongs to whom. */
function relationLine(reg: Registry, world: WorldDoc, words: Words, rel: string, fromId: string, toId: string, linked: boolean): string {
  const from = words.name(fromId);
  // Someone may know a place (`knows` to a place): it reads with the places around it.
  const to = hasOwn(world.places, toId) ? words.place(toId) : words.object(toId);
  const many = plural(from);
  const is = many ? "are" : "is";
  const now = linked ? "now" : "no longer";
  switch (rel) {
    case "knows":
      return `${from} ${now} ${many ? "know" : "knows"} ${to}`;
    case "in":
      return words.isPerson(toId) ? `${from} ${is} ${now} carried by ${to}` : `${from} ${is} ${now} in ${to}`;
    case "uses":
      return linked ? `${from} now ${many ? "borrow" : "borrows"} ${to}` : `${from} gave back ${to}`;
    case "owns":
      return `${from} ${now} ${many ? "own" : "owns"} ${to}`;
    case "worn_by":
      return `${from} ${is} ${now} worn by ${to}`;
    case "equipped":
      return `${from} ${is} ${now} equipped by ${to}`;
    case "member_of":
      return `${from} ${is} ${now} a member of ${to}`;
    case "regard":
      return linked ? `${possessive(from)} regard for ${to} changed` : `${from} no longer ${many ? "hold" : "holds"} any regard for ${to}`;
    default: {
      const label = (own(world.relations, rel) ?? reg.relations.get(rel))?.label ?? humanize(rel);
      return `${from} ${linked ? "now" : "no longer"} ${many ? "have" : "has"} a “${fieldNoun(label, rel).noun}” link to ${to}`;
    }
  }
}

/** Replaces each referenced id in a pack describer's line with its name or label. */
function relabel(line: string, refs: readonly Ref[], world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, you: string): string {
  let out = line;
  const ids = [...new Set(refs.map((r) => r.id))].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const name = nameOf(world, state, pov, id, you);
    if (name.toLowerCase() === id.toLowerCase()) continue;
    out = out.replace(new RegExp(`(?<![\\w.])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), name);
  }
  return out;
}

/** Labels only the GM may see: hidden tracks' labels and, with `stages`, their stage labels of six characters or more. */
export function hiddenTrackLabels(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, stages = true): string[] {
  const out: string[] = [];
  for (const [id, t] of Object.entries(world.tracks)) {
    if (trackShown(reg, world, state, pov, id)) continue;
    out.push(t.label);
    if (stages) for (const s of Object.values(t.stages)) if (s.label.length >= 6) out.push(s.label);
  }
  return out;
}

/**
 * The names of the people and the things the POV can't see, apart: a person is named by any word of
 * their name, a thing only by its whole name (`namesAny`). One gone from the world that the POV
 * could see (`couldSeeEntity`: a coffee drunk, a bill stopped) isn't hidden, so its name stays.
 */
export function hiddenEntityNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): { people: string[]; things: string[] } {
  const out: { people: string[]; things: string[] } = { people: [], things: [] };
  for (const [id, e] of Object.entries(state.entities)) if (!couldSeeEntity(reg, world, state, pov, id)) (kindIs(reg, world, e.kind, "person") ? out.people : out.things).push(e.name);
  return out;
}

/** Names only the GM may see: hidden tracks' labels and stage labels, and the names of people and things the POV can't see. */
export function hiddenNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string[] {
  const { people, things } = hiddenEntityNames(reg, world, state, pov);
  return [...hiddenTrackLabels(reg, world, state, pov), ...people, ...things];
}

/**
 * A check for text the player or the narrator reads (DESIGN §7, `namesAny`): whether it names
 * someone or something `pov` can't see, or a secret lore entry. A hidden person counts by any word of
 * their name ("Vex is watching" names Vex Morrow, while a hidden Dan doesn't make "dangerous" a
 * leak); a hidden place or thing, a track's label and a secret entry's title only by all their words
 * in order. A word or name `heard` says too doesn't count: whoever reads the text has seen it said
 * (the player's own message, for what the player reads). With `stages` false a hidden track counts
 * by its own label only, for a step that never reads a track's stages, where a stage's everyday
 * words ("Whispers", "Take a breath") name nothing. The names are gathered once, so one check reads
 * many texts, and once per read pass (DESIGN §9.6), where every section checks its lines.
 */
export function hiddenNameCheck(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, opts: { stages?: boolean } = {}): (text: string, heard?: string) => boolean {
  const stages = opts.stages ?? true;
  return passMemo([state, world, reg], `visibility.hidden_names\u0000${pov}\u0000${stages}`, () => {
    const hidden = hiddenEntityNames(reg, world, state, pov);
    const labels = [...hidden.things, ...unseenPlaceNames(reg, world, state, pov), ...hiddenTrackLabels(reg, world, state, pov, stages), ...secretLoreTitles(reg, world, state)];
    return (text: string, heard = "") => namesAny(text, hidden.people, labels, heard);
  });
}

/** Whether text names anything the world's POV can't see that `heard` doesn't say too (`hiddenNameCheck`). */
export function namesHidden(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string, heard = ""): boolean {
  return hiddenNameCheck(reg, world, state, world.pov)(text, heard);
}

/** An event's line, worded for `pov` when it is a player's (`player`), else for the GM or the author; the POV is named `you`. */
function rawLine(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent, player: boolean, you: string): string | null {
  const words = wordsFor(reg, world, state, pov, player, you);
  switch (e.type) {
    case "set": {
      if (INTERNAL_FIELD.test(e.field)) return null;
      // A GM's Remove and Restore read as such, never as a field.
      if (e.field === GONE_FIELD) return `${words.name(e.entity)} ${e.value === true ? "is gone" : "is back"}`;
      // A player's line words an activity as the castlife pack does for the player (an agenda's step
      // the player may not know of reads "busy", `castlife.activity`).
      const ctx = player && e.field === "activity" && typeof e.value === "string" ? reg.context(world, state) : null;
      const shownActivity = ctx ? optionalQuery(ctx, "castlife.activity") : null;
      const value = ctx && shownActivity && typeof e.value === "string" ? shownActivity(ctx, e.entity, e.value) : e.value;
      return setLine(reg, world, state, words, e.entity, e.field, value, e.atMost === true);
    }
    case "add": {
      if (INTERNAL_FIELD.test(e.field)) return null;
      const def = fieldDef(reg, world, own(state.entities, e.entity)?.kind ?? "", e.field);
      const { noun, unit } = fieldNoun(def?.label, e.field);
      const amount = def?.type === "money" ? formatMoney(Math.abs(e.delta), world.currency) : `${Math.round(Math.abs(e.delta) * 100) / 100}${unit}`;
      return `${possessive(words.name(e.entity))} ${noun} went ${e.delta < 0 ? "down" : "up"} by ${amount}`;
    }
    case "link":
    case "unlink":
      return relationLine(reg, world, words, e.rel, e.from, e.to, e.type === "link");
    case "spawn":
      return `${e.entity.name} appears`;
    case "stage": {
      const t = own(world.tracks, e.track);
      return t ? `${t.label} is now at “${own(t.stages, e.to)?.label ?? e.to}”` : null;
    }
    case "post":
      return postLine(world, state, pov, e.memo, e.lines, player);
    default: {
      const def = reg.get(e.type);
      if (!def) return null;
      try {
        const line = def.describe(e, reg.context(world, state), player ? pov : undefined);
        return line ? relabel(line, refsOf(world, state, e), world, state, pov, you) : null;
      } catch {
        // A describer that can't word this event against this state is skipped.
        return null;
      }
    }
  }
}

/** A player-facing line for an event, or null when the POV may not see it or there is nothing to say. */
export function playerLine(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): string | null {
  return playerLines(reg, world, state, pov, [e], 1)[0] ?? null;
}

/**
 * How much a line matters when there are more than fit: money and quest stages first (a payday, a
 * statement); then signals (an invitation, a need); routine (activities, other people's moves) last.
 */
function lineRank(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): number {
  if (e.type === "post" || e.type === "stage" || e.type.startsWith("economy.")) return 0;
  if ((e.type === "set" || e.type === "add") && fieldDef(reg, world, own(state.entities, e.entity)?.kind ?? "", e.field)?.type === "money") return 0;
  // The economy's notes (a bill paid or declined, a payday) are money lines too.
  if (e.type === ENGINE_EVENTS.signal) return "data" in e && (e.data.class === "bill" || e.data.class === "decline") ? 0 : 1;
  if (e.type === "set" && (e.field === "activity" || (e.field === "place" && e.entity !== pov))) return 3;
  if (e.type.startsWith("castlife.")) return 3;
  return 2;
}

/**
 * Player-facing lines for events, in order, deduplicated, at most `max`. A field set several times
 * (hourly temperatures, a day of moves) reads once, at its latest value. When there are more lines
 * than `max`, money, quest and signal lines are kept ahead of routine ones.
 */
export function playerLines(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, events: readonly LedgerEvent[], max = 8): string[] {
  return wordedLines(reg, world, state, pov, events, max, true);
}

/**
 * The author's lines for events (Check world): worded like `playerLines`, with names, but for every
 * event, whoever it is about and whatever the POV knows, secrets included; only bookkeeping is left out.
 */
export function authorLines(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[], max: number): string[] {
  return wordedLines(reg, world, state, world.pov, events, max, false);
}

/** Whose change an event is: the entity a field or relation changes on, the one spawned, the track whose stage moved; a pack event's `entity`, `agent` or `who`. */
function subjectOf(e: LedgerEvent): string | null {
  switch (e.type) {
    case "set":
    case "add":
      return e.entity;
    case "link":
    case "unlink":
      return e.from;
    case "spawn":
      return e.entity.id;
    case "stage":
      return e.track;
    case "post":
      return null;
    default: {
      if (!("data" in e) || !isRecord(e.data)) return null;
      const who = e.data.entity ?? e.data.agent ?? e.data.who;
      return typeof who === "string" ? who : null;
    }
  }
}

/**
 * Who the events are about, by name, in order, as far as the POV knows them: the people and things it
 * knows and the tracks it is shown, the POV as `you`. Never what a change set (a place someone went
 * to, a value) and nothing the POV doesn't know of: how a change it didn't see is named on a player
 * surface (a GM edit's chip).
 */
export function knownSubjects(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, events: readonly LedgerEvent[], you = "you"): string[] {
  const secrets = [...unrevealedSecrets(reg, world, state), ...hiddenNames(reg, world, state, pov)];
  const names: string[] = [];
  for (const e of events) {
    const id = bookkeeping(e.type) ? null : subjectOf(e);
    if (id === null) continue;
    const known = hasOwn(state.entities, id) ? playerKnows(reg, world, state, pov, id) : hasOwn(world.tracks, id) && trackShown(reg, world, state, pov, id);
    const name = nameOf(world, state, pov, id, you);
    if (known && !names.includes(name) && findLeaks(name, secrets).length === 0) names.push(name);
  }
  return names;
}

/** What anyone in the POV's scene sees of its events: people coming and going and what they do, things taken, handed over or lent, and someone appearing. */
function witnessed(e: LedgerEvent): boolean {
  if (e.type === "set") return e.field === "place" || e.field === "activity";
  if (e.type === "link" || e.type === "unlink") return e.rel === "in" || e.rel === "uses" || e.rel === "owns";
  return e.type === "spawn";
}

/**
 * The lines someone in the POV's scene saw of its events (a mind's witness log, DESIGN §24.4): only
 * what anyone there could see, filtered and screened as `playerLines` does, with the POV named "the
 * player character", never "you". The POV's own matters (its accounts, needs, what it learns or
 * uncovers, invitations to it) are none of an onlooker's.
 */
export function witnessLines(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, events: readonly LedgerEvent[], max: number): string[] {
  return wordedLines(reg, world, state, pov, events.filter(witnessed), max, true, "the player character");
}

function wordedLines(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, events: readonly LedgerEvent[], max: number, player: boolean, you = "You"): string[] {
  const lines: { at: number; rank: number; text: string }[] = [];
  let secrets: string[] | null = null;
  const lastSet = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.type === "set") lastSet.set(`${e.entity}\u0000${e.field}`, i);
  });
  // A change to someone else's HP that the POV sees as a wound band reads as one, never as a number
  // (the combat pack's `combat.hp_line`, DESIGN §11).
  const ctx = player ? reg.context(world, state) : null;
  const hpLine = ctx ? optionalQuery(ctx, "combat.hp_line") : null;
  for (const [i, e] of events.entries()) {
    if (e.type === "set" && lastSet.get(`${e.entity}\u0000${e.field}`) !== i) continue;
    if (bookkeeping(e.type)) continue;
    if (player && !playerEventVisible(reg, world, state, pov, e)) continue;
    const banded = ctx && hpLine ? hpLine(ctx, e) : undefined;
    const text = banded === undefined ? rawLine(reg, world, state, pov, e, player, you) : banded;
    if (!text || lines.some((l) => l.text === text)) continue;
    if (player) {
      // Text that must never reach a player line: unrevealed truths and gated secret lore, and hidden names.
      secrets ??= [...unrevealedSecrets(reg, world, state), ...hiddenNames(reg, world, state, pov)];
      if (findLeaks(text, secrets).length > 0) continue;
    }
    lines.push({ at: i, rank: lineRank(reg, world, state, pov, e), text });
  }
  const kept = lines.length <= max ? lines : [...lines].sort((a, b) => a.rank - b.rank || a.at - b.at).slice(0, Math.max(0, max)).sort((a, b) => a.at - b.at);
  return kept.map((l) => l.text);
}

/** The line shown for a change the player may not see. */
export const UNSEEN_DROP = "A change no longer applies";

export interface PlayerDrop {
  /** What the player sees: the event's player line, or {@link UNSEEN_DROP}. */
  text: string;
  /** Whether the POV may see the event (so `text` is its line). */
  visible: boolean;
  /** The validator's raw reason (ids, names, amounts): for the GM view only. */
  gm: string;
}

/**
 * A dropped or failed event worded for the player: its player line when the POV may
 * see it, else "A change no longer applies". A validator's reason names ids, people and amounts the
 * POV may not know, so it is kept for the GM view and never shown to the player. `event` is absent
 * when the drop is a marker or the event can't be found; that reads as the neutral line too.
 */
export function playerDrop(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, event: LedgerEvent | null | undefined, reason: string): PlayerDrop {
  const line = event ? playerLine(reg, world, state, pov, event) : null;
  return line ? { text: line, visible: true, gm: reason } : { text: UNSEEN_DROP, visible: false, gm: reason };
}
