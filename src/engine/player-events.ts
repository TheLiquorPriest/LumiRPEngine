// Player-facing event lines (DESIGN §7, D8): what a chip, the Journal or a Montage may
// say about an event. An event shows only when the POV may see it and everything it refers to:
// its own visibility (`eventVisible`, every field it writes included), every entity it names
// (visible and met), every place (visible) and every track (public, or revealed). Bookkeeping
// events and off-screen NPC↔NPC events never show. Lines use names and labels, never ids, and
// never carry unrevealed truth.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { ENGINE_EVENTS, readEngineSlice } from "./engine-pack";
import type { Registry } from "./registry-impl";
import { bandOf, fieldDef, GONE_FIELD, kindIs } from "./scope";
import type { WorldState } from "./state";
import { optionalQuery, own } from "./pack-kit";
import { canSeeEntity, canSeePlace, eventVisible, findLeaks, knows, namesAny, secretLoreTitles, trackKnown, unrevealedSecrets, unseenPlaceNames, visibilityOf } from "./visibility";

/** Event types that are engine or pack bookkeeping: never player-facing lines. */
const BOOKKEEPING = new Set<string>([
  "clock",
  "timelapse",
  "materialize",
  ENGINE_EVENTS.fired,
  ENGINE_EVENTS.caught,
  ENGINE_EVENTS.cursor,
  ENGINE_EVENTS.choice,
  ENGINE_EVENTS.attempt,
  ENGINE_EVENTS.pause,
  ENGINE_EVENTS.beat,
  ENGINE_EVENTS.observed,
  // The roll chip and the Outcome slot tell how a check was decided.
  ENGINE_EVENTS.adjudged,
  "castlife.decision",
  "castlife.override",
  "economy.price",
  // The POV's transaction history mirrors its `post` events, which carry the line.
  "economy.txn",
  "story.flag",
  // A fight's turn order, economy and recorded picks; what anyone did is `combat.act`.
  "combat.turn",
  "combat.spend",
  "combat.decision",
]);

/** A posting as the POV sees it: the memo with what moved between its own accounts. */
function postLine(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, memo: string, lines: readonly { account: string; amount: number }[]): string | null {
  const mine = lines.filter((l) => own(state.entities, l.account)?.fields.owner === pov);
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
  if (mine.length === 1 && only) return `${label}: ${only.amount < 0 ? "−" : "+"}${money(only.amount)} (${name(only.account)})`;
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
  if (e.fields.owner === pov || knows(state, pov, id)) return true;
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

/** Whether a track may be named to the POV: public, revealed, or `known_by` and known (`trackKnown`). */
function trackShown(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string): boolean {
  const t = own(world.tracks, id);
  if (!t) return false;
  const visibility = visibilityOf(t.visibility);
  if (visibility === "public") return true;
  if ((own(readEngineSlice(state).revealed, id) ?? []).length > 0) return true;
  return visibility === "known_by" && trackKnown(reg, world, state, pov, t);
}

/**
 * Whether a track still keeps something from the POV: a stage truth not yet revealed, or the track
 * itself, which may not be named to it (`trackShown`). Its cue is a hint the narrator may play while
 * this holds (DESIGN §6.6); after that there is nothing left for the cue to hint at.
 */
export function trackKeepsSecret(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string): boolean {
  const t = own(world.tracks, id);
  if (!t) return false;
  const revealed = own(readEngineSlice(state).revealed, id) ?? [];
  return Object.entries(t.stages).some(([stage, s]) => !!s.truth && !revealed.includes(stage)) || !trackShown(reg, world, state, pov, id);
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
  if (BOOKKEEPING.has(e.type)) return false;
  if (!eventVisible(reg, world, state, pov, e)) return false;
  if ("data" in e && isRecord(e.data)) {
    // Off-screen NPC↔NPC changes (an encounter's regard) are nobody's news.
    if (e.data.npc === true) return false;
    if (POV_ONLY.has(e.type) && (e.data.agent ?? e.data.entity ?? e.data.who) !== pov) return false;
  }
  if (e.type === "stage" && !trackShown(reg, world, state, pov, e.track)) return false;
  for (const r of refsOf(world, state, e)) {
    if (r.kind === "entity" && !playerKnows(reg, world, state, pov, r.id)) return false;
    if (r.kind === "place" && !canSeePlace(reg, world, state, pov, r.id)) return false;
    if (r.kind === "track" && !trackShown(reg, world, state, pov, r.id)) return false;
  }
  return true;
}

function nameOf(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string): string {
  if (id === pov) return "You";
  return own(state.entities, id)?.name ?? own(world.places, id)?.name ?? own(world.tracks, id)?.label ?? id;
}

function humanize(field: string): string {
  return field.replace(/_/g, " ");
}

function valueText(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, kind: string, field: string, v: JsonValue): string | null {
  if (v === null) return "cleared";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") {
    if (hasOwn(state.entities, v) || hasOwn(world.places, v)) return nameOf(world, state, pov, v);
    // An enum value or a code-like word (`needs_service`) reads as words ("needs service").
    if (fieldDef(reg, world, kind, field)?.type === "enum" || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(v)) return humanize(v);
    return v.length > 80 ? `${v.slice(0, 79)}…` : v;
  }
  if (typeof v === "number") {
    const def = fieldDef(reg, world, kind, field);
    if (def?.type === "money") return formatMoney(v, world.currency);
    const band = def?.bands ? bandOf(def.bands, v) : null;
    return band ? band.label : String(Math.round(v * 100) / 100);
  }
  return null;
}

function relationLine(rel: string, from: string, to: string, linked: boolean): string {
  switch (rel) {
    case "knows":
      return linked ? `${from} now know ${to}` : `${from} no longer know ${to}`;
    case "in":
      return linked ? `${from} → ${to}` : `${from} out of ${to}`;
    case "uses":
      return linked ? `${from} borrows ${to}` : `${from} gives back ${to}`;
    case "owns":
      return linked ? `${from} owns ${to}` : `${from} no longer owns ${to}`;
    default:
      return linked ? `${from} ${humanize(rel)} ${to}` : `${from} no longer ${humanize(rel)} ${to}`;
  }
}

/** Replaces each referenced id in a pack describer's line with its name or label. */
function relabel(line: string, refs: readonly Ref[], world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string {
  let out = line;
  const ids = [...new Set(refs.map((r) => r.id))].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const name = nameOf(world, state, pov, id);
    if (name.toLowerCase() === id.toLowerCase()) continue;
    out = out.replace(new RegExp(`(?<![\\w.])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), name);
  }
  return out;
}

/** Labels only the GM may see: hidden tracks' labels and their stage labels of six characters or more. */
export function hiddenTrackLabels(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string[] {
  const out: string[] = [];
  for (const [id, t] of Object.entries(world.tracks)) {
    if (trackShown(reg, world, state, pov, id)) continue;
    out.push(t.label);
    for (const s of Object.values(t.stages)) if (s.label.length >= 6) out.push(s.label);
  }
  return out;
}

/**
 * The names of the people and the things the POV can't see, apart: a person is named by any word of
 * their name, a thing only by its whole name (`namesAny`).
 */
export function hiddenEntityNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): { people: string[]; things: string[] } {
  const out: { people: string[]; things: string[] } = { people: [], things: [] };
  for (const [id, e] of Object.entries(state.entities)) if (!canSeeEntity(reg, world, state, pov, id)) (kindIs(reg, world, e.kind, "person") ? out.people : out.things).push(e.name);
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
 * in order. The names are gathered once, so one check reads many texts.
 */
export function hiddenNameCheck(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): (text: string) => boolean {
  const hidden = hiddenEntityNames(reg, world, state, pov);
  const labels = [...hidden.things, ...unseenPlaceNames(reg, world, state, pov), ...hiddenTrackLabels(reg, world, state, pov), ...secretLoreTitles(reg, world, state)];
  return (text) => namesAny(text, hidden.people, labels);
}

/** Whether text the player reads names anything the world's POV can't see (`hiddenNameCheck`). */
export function namesHidden(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string): boolean {
  return hiddenNameCheck(reg, world, state, world.pov)(text);
}

/** An event's line, worded for `pov` when it is a player's (`player`), else for the GM or the author. */
function rawLine(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent, player: boolean): string | null {
  const name = (id: string): string => nameOf(world, state, pov, id);
  switch (e.type) {
    case "set": {
      if (INTERNAL_FIELD.test(e.field)) return null;
      // A GM's Remove and Restore read as such, never as a field.
      if (e.field === GONE_FIELD) return `${name(e.entity)} ${e.value === true ? "is gone" : "is back"}`;
      const kind = own(state.entities, e.entity)?.kind ?? "";
      if (e.field === "place" && typeof e.value === "string") return `${name(e.entity)} → ${name(e.value)}`;
      // A player's line words an activity as the castlife pack does for the player (an agenda's step
      // the player may not know of reads "busy", `castlife.activity`).
      const ctx = player && e.field === "activity" && typeof e.value === "string" ? reg.context(world, state) : null;
      const shownActivity = ctx ? optionalQuery(ctx, "castlife.activity") : null;
      const value = ctx && shownActivity && typeof e.value === "string" ? shownActivity(ctx, e.entity, e.value) : e.value;
      const v = valueText(reg, world, state, pov, kind, e.field, value);
      if (v === null) return null;
      if (e.field === "activity") return `${name(e.entity)}: ${v}`;
      return `${name(e.entity)}: ${fieldDef(reg, world, kind, e.field)?.label ?? humanize(e.field)} ${v}`;
    }
    case "add": {
      if (INTERNAL_FIELD.test(e.field)) return null;
      const kind = own(state.entities, e.entity)?.kind ?? "";
      const def = fieldDef(reg, world, kind, e.field);
      const amount = def?.type === "money" ? formatMoney(Math.abs(e.delta), world.currency) : String(Math.round(Math.abs(e.delta) * 100) / 100);
      return `${name(e.entity)}: ${def?.label ?? humanize(e.field)} ${e.delta < 0 ? "−" : "+"}${amount}`;
    }
    case "link":
    case "unlink":
      return relationLine(e.rel, name(e.from), name(e.to), e.type === "link");
    case "spawn":
      return `${e.entity.name} appears`;
    case "stage": {
      const t = own(world.tracks, e.track);
      return t ? `${t.label}: ${own(t.stages, e.to)?.label ?? e.to}` : null;
    }
    case "post":
      return postLine(world, state, pov, e.memo, e.lines);
    default: {
      const def = reg.get(e.type);
      if (!def) return null;
      try {
        const line = def.describe(e, reg.context(world, state), player ? pov : undefined);
        return line ? relabel(line, refsOf(world, state, e), world, state, pov) : null;
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
 * How much a line matters when there are more than fit: money, quest stages and signals (a payday,
 * a statement, an invitation) first; routine (activities, other people's moves, needs) last.
 */
function lineRank(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): number {
  if (e.type === "post" || e.type === "stage" || e.type === ENGINE_EVENTS.signal || e.type.startsWith("economy.")) return 0;
  if ((e.type === "set" || e.type === "add") && fieldDef(reg, world, own(state.entities, e.entity)?.kind ?? "", e.field)?.type === "money") return 0;
  if (e.type === "set" && (e.field === "activity" || (e.field === "place" && e.entity !== pov))) return 2;
  if (e.type.startsWith("castlife.")) return 2;
  return 1;
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

function wordedLines(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, events: readonly LedgerEvent[], max: number, player: boolean): string[] {
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
    if (BOOKKEEPING.has(e.type)) continue;
    if (player && !playerEventVisible(reg, world, state, pov, e)) continue;
    const banded = ctx && hpLine ? hpLine(ctx, e) : undefined;
    const text = banded === undefined ? rawLine(reg, world, state, pov, e, player) : banded;
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
